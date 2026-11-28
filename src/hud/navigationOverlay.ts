import type { DirectorAdvice } from '../logic/flightDirector';
import * as THREE from 'three';
import { arrivalSeconds, compassPoint, steeringCue } from '../logic/navigation';
import { formatCountdown, formatDistance, formatSpeed } from '../logic/units';
import type { ScreenProjector } from './screenProjector';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const COMPASS_RADIUS = 30;
/** The compass sits to the lower right of the crosshair, close enough to read without looking away. */
const COMPASS_OFFSET = { x: 118, y: 44 } as const;
const STEER_RING = 40;
const ON_TARGET_COLOR = '#7dffb0';
const EARTH_COLOR = '#4fa3ff';

export interface NavigationObjective {
  label: string;
  /** Short name on the compass: PRIORITY, JOB, AEGIS... */
  tag: string;
  world: THREE.Vector3;
  velocity: THREE.Vector3;
  color: string;
  /** Show an approach guide and a speed limit when close (docking, berthing, towing). */
  approachSpeed: number | null;
  /** Approach guide shown inside this distance. */
  approachRange: number;
  /** Where to meet a moving target: where it will be when the ship arrives. */
  meet?: THREE.Vector3;
  /** Earth is in the way: steer for this point first, round the planet. */
  via?: THREE.Vector3;
  /** The flight director's advice for this trip. */
  director?: DirectorAdvice;
  /** One more line under the instruction: for a rock, when it lands and whether you can make it. */
  note?: { text: string; color: string };
  /** A drop zone around the objective: release a towed load inside it. */
  zone?: { center: THREE.Vector3; radius: number; state: string; text: string };
}

export interface NavigationFrame {
  objective: NavigationObjective;
  shipPosition: THREE.Vector3;
  shipVelocity: THREE.Vector3;
  shipQuaternion: THREE.Quaternion;
  /** The crosshair on screen. */
  aim: { x: number; y: number };
  /** The pilot picked the objective (G or N), rather than the game. */
  chosen: boolean;
  /** The approach autopilot is flying. */
  autopilot?: boolean;
}

const scratch = new THREE.Vector3();
const inverse = new THREE.Quaternion();

/** The ship-frame direction to a world point. */
function toLocal(frame: NavigationFrame, world: THREE.Vector3): THREE.Vector3 {
  inverse.copy(frame.shipQuaternion).invert();
  return world.clone().sub(frame.shipPosition).applyQuaternion(inverse);
}

/**
 * Finding the way: the target compass beside the crosshair (filled dot in
 * front, hollow behind, Earth's side marked in blue), the steering arrow
 * around the crosshair, the velocity marker showing where the ship will
 * really go relative to the objective, and approach chevrons near stations
 * and jobs.
 */
export function drawNavigation(context: CanvasRenderingContext2D, projector: ScreenProjector, frame: NavigationFrame, elapsed: number): void {
  const { objective } = frame;
  // Steer for the meeting point; distances and the approach guide use the target itself.
  const aim = objective.via ?? objective.meet ?? objective.world;
  const local = toLocal(frame, aim);
  const distance = toLocal(frame, objective.world).length();
  const point = compassPoint(local.toArray());
  context.save();
  context.font = `700 11px ${MONO}`;
  drawRoute(context, projector, frame, elapsed);
  drawZone(context, projector, frame, elapsed);
  drawApproach(context, projector, frame, distance, elapsed);
  drawVelocityMarker(context, projector, frame);
  drawSteering(context, frame, local, elapsed);
  drawCompass(context, frame, point, distance, local, elapsed);
  context.restore();
}

function drawCompass(
  context: CanvasRenderingContext2D,
  frame: NavigationFrame,
  point: ReturnType<typeof compassPoint>,
  distance: number,
  local: THREE.Vector3,
  elapsed: number,
): void {
  const { objective } = frame;
  const cx = frame.aim.x + COMPASS_OFFSET.x;
  const cy = frame.aim.y + COMPASS_OFFSET.y;
  const r = COMPASS_RADIUS;
  const color = point.onTarget ? ON_TARGET_COLOR : objective.color;

  context.fillStyle = 'rgba(4, 10, 18, 0.62)';
  context.beginPath();
  context.arc(cx, cy, r + 3, 0, Math.PI * 2);
  context.fill();

  // Earth's side of the sky: a blue arc on the rim and a small Earth dot.
  const earth = compassPoint(toLocal(frame, scratch.set(0, 0, 0)).toArray());
  const earthAngle = Math.atan2(earth.y, earth.x);
  context.strokeStyle = EARTH_COLOR;
  context.lineWidth = 3;
  context.globalAlpha = 0.55;
  context.beginPath();
  context.arc(cx, cy, r, earthAngle - 0.7, earthAngle + 0.7);
  context.stroke();
  context.globalAlpha = 1;
  context.lineWidth = 1.5;
  context.beginPath();
  context.arc(cx + earth.x * r, cy + earth.y * r, 3, 0, Math.PI * 2);
  if (earth.behind) {
    context.stroke();
  } else {
    context.fillStyle = EARTH_COLOR;
    context.fill();
  }

  // Rim, and the dashed ring where "beside you" turns into "behind you".
  context.strokeStyle = color;
  context.lineWidth = point.onTarget ? 2 : 1.2;
  context.beginPath();
  context.arc(cx, cy, r, 0, Math.PI * 2);
  context.stroke();
  context.setLineDash([2, 3]);
  context.globalAlpha = 0.5;
  context.beginPath();
  context.arc(cx, cy, r * 0.78, 0, Math.PI * 2);
  context.stroke();
  context.setLineDash([]);
  context.globalAlpha = 1;
  // Centre cross: the nose.
  context.beginPath();
  context.moveTo(cx - 4, cy);
  context.lineTo(cx + 4, cy);
  context.moveTo(cx, cy - 4);
  context.lineTo(cx, cy + 4);
  context.stroke();

  // The objective: filled in front, hollow (and pulsing) behind.
  const px = cx + point.x * r;
  const py = cy + point.y * r;
  context.globalAlpha = 0.35;
  context.beginPath();
  context.moveTo(cx, cy);
  context.lineTo(px, py);
  context.stroke();
  context.globalAlpha = 1;
  context.beginPath();
  context.arc(px, py, point.behind ? 4.5 + Math.sin(elapsed * 6) : 4.5, 0, Math.PI * 2);
  if (point.behind) {
    context.lineWidth = 2;
    context.stroke();
  } else {
    context.fillStyle = color;
    context.fill();
  }

  // Words: what it is, then how far to turn, how far away, when you arrive and how far above or below.
  context.textAlign = 'center';
  context.fillStyle = color;
  context.fillText(`${objective.tag}${frame.chosen ? ' (G)' : ''}`, cx, cy - r - 9);
  const degrees = Math.round(THREE.MathUtils.radToDeg(point.angle));
  const relative = frame.shipVelocity.clone().sub(objective.velocity);
  const closing = relative.dot(objective.world.clone().sub(frame.shipPosition).normalize());
  const eta = arrivalSeconds(distance, closing);
  const turn = point.onTarget ? 'ON TARGET' : point.behind ? `BEHIND · ${degrees}°` : `${degrees}°`;
  context.fillText(turn, cx, cy + r + 15);
  context.fillStyle = 'rgba(232, 241, 255, 0.92)';
  context.fillText(`${formatDistance(distance)}${eta !== null ? ` · ${formatCountdown(eta)}` : ''}`, cx, cy + r + 28);
  const height = local.y;
  let line = cy + r + 41;
  if (Math.abs(height) > 4) {
    context.fillStyle = 'rgba(232, 241, 255, 0.7)';
    context.fillText(`${height > 0 ? '▲' : '▼'} ${formatDistance(Math.abs(height))}`, cx, line);
    line += 15;
  }
  // The flight director: one instruction at a time.
  const advice = objective.director;
  if (advice) {
    const instruction = `${DIRECTOR_TEXT[advice.phase](advice)}${objective.via ? ' · ROUND EARTH' : ''}`;
    context.font = `800 12px ${MONO}`;
    const width = context.measureText(instruction).width + 14;
    context.fillStyle = 'rgba(4, 10, 18, 0.72)';
    context.fillRect(cx - width / 2, line - 11, width, 17);
    context.fillStyle = DIRECTOR_COLOR[advice.phase];
    context.fillText(instruction, cx, line + 2);
    line += 17;
    context.font = `700 11px ${MONO}`;
    if (objective.note) {
      context.fillStyle = objective.note.color;
      context.fillText(objective.note.text, cx, line);
      line += 14;
    }
    if (frame.autopilot) {
      context.font = `700 10px ${MONO}`;
      context.fillStyle = '#e48cff';
      context.fillText('AUTOPILOT · any control takes over', cx, line);
    }
  }
}

/** The drop zone: a ring as big as the zone really is, green when it is time to let go. */
function drawZone(context: CanvasRenderingContext2D, projector: ScreenProjector, frame: NavigationFrame, elapsed: number): void {
  const zone = frame.objective.zone;
  if (!zone) {
    return;
  }
  const point = projector.project(zone.center);
  if (!point.visible) {
    return;
  }
  const ready = zone.state === 'release' || zone.state === 'safe';
  const color = ready ? ON_TARGET_COLOR : zone.state === 'travel' ? frame.objective.color : '#ffb347';
  const radius = Math.max(18, projector.projectedRadius(zone.radius, point.depth));
  context.save();
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = ready ? 3 : 2;
  context.setLineDash(ready ? [] : [10, 7]);
  context.lineDashOffset = -elapsed * 14;
  context.globalAlpha = 0.9;
  context.beginPath();
  context.arc(point.x, point.y, radius, 0, Math.PI * 2);
  context.stroke();
  context.globalAlpha = ready ? 0.14 + 0.06 * Math.sin(elapsed * 6) : 0.06;
  context.fill();
  context.globalAlpha = 1;
  context.setLineDash([]);
  context.font = `800 12px ${MONO}`;
  context.textAlign = 'center';
  const width = context.measureText(zone.text).width + 14;
  context.fillStyle = 'rgba(4, 10, 18, 0.75)';
  context.fillRect(point.x - width / 2, point.y - radius - 26, width, 18);
  context.fillStyle = color;
  context.fillText(zone.text, point.x, point.y - radius - 13);
  context.restore();
}

const DIRECTOR_TEXT: Record<DirectorAdvice['phase'], (advice: DirectorAdvice) => string> = {
  turn: () => 'TURN TO THE DOT',
  burn: (advice) => `BURN (W) · reach ${formatSpeed(advice.targetSpeed)}`,
  coast: (advice) => (advice.brakeIn !== null ? `COAST · brake in ${formatCountdown(advice.brakeIn)}` : 'COAST'),
  brake: () => 'BRAKE NOW (S)',
  arrive: (advice) => `MATCH SPEED · under ${formatSpeed(advice.targetSpeed)}`,
  arrived: () => 'ARRIVED',
};

const DIRECTOR_COLOR: Record<DirectorAdvice['phase'], string> = {
  turn: '#ffd23f',
  burn: '#7dffb0',
  coast: '#8fd3ff',
  brake: '#ff6b5c',
  arrive: '#ffb347',
  arrived: '#7dffb0',
};

/**
 * Points along the route: straight to the meeting point, or to the corner
 * round the planet and then in an arc that stays as high as the corner.
 */
export function routePoints(ship: THREE.Vector3, via: THREE.Vector3 | null, meet: THREE.Vector3): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  if (!via) {
    for (let index = 1; index <= 24; index += 1) {
      points.push(ship.clone().lerp(meet, index / 24));
    }
    return points;
  }
  for (let index = 1; index <= 10; index += 1) {
    points.push(ship.clone().lerp(via, index / 10));
  }
  const height = via.length();
  for (let index = 1; index <= 20; index += 1) {
    const point = via.clone().lerp(meet, index / 20);
    if (point.length() < height) {
      point.setLength(height);
    }
    points.push(point);
  }
  return points;
}

/**
 * The route: a dashed line of light from the ship to the meeting point,
 * and a ghost marker there when it is away from where the target is now.
 */
function drawRoute(context: CanvasRenderingContext2D, projector: ScreenProjector, frame: NavigationFrame, elapsed: number): void {
  const { objective } = frame;
  const meet = objective.meet;
  if (!meet || meet.distanceTo(frame.shipPosition) < 8) {
    return;
  }
  context.save();
  context.strokeStyle = objective.color;
  context.lineWidth = 1.5;
  context.setLineDash([6, 8]);
  context.lineDashOffset = -elapsed * 30;
  context.globalAlpha = 0.45;
  context.beginPath();
  let started = false;
  for (const world of routePoints(frame.shipPosition, objective.via ?? null, meet)) {
    const point = projector.project(world);
    if (point.depth < 1) {
      started = false;
      continue;
    }
    if (started) {
      context.lineTo(point.x, point.y);
    } else {
      context.moveTo(point.x, point.y);
      started = true;
    }
  }
  context.stroke();
  context.setLineDash([]);
  context.globalAlpha = 1;
  if (meet.distanceTo(objective.world) > 6) {
    const ghost = projector.project(meet);
    if (ghost.visible) {
      context.beginPath();
      context.arc(ghost.x, ghost.y, 9, 0, Math.PI * 2);
      context.setLineDash([3, 3]);
      context.stroke();
      context.setLineDash([]);
      context.textAlign = 'center';
      context.fillStyle = objective.color;
      context.fillText('MEET HERE', ghost.x, ghost.y - 14);
    }
  }
  context.restore();
}

/** An arrow on a ring around the crosshair, pointing the way to turn; it shrinks as the nose comes round. */
function drawSteering(context: CanvasRenderingContext2D, frame: NavigationFrame, local: THREE.Vector3, elapsed: number): void {
  const cue = steeringCue(local.toArray());
  if (!cue) {
    return;
  }
  const { x, y } = frame.aim;
  context.save();
  context.translate(x, y);
  context.rotate(cue.direction);
  context.fillStyle = frame.objective.color;
  context.strokeStyle = frame.objective.color;
  context.globalAlpha = 0.55 + 0.45 * cue.strength * (0.75 + 0.25 * Math.sin(elapsed * 6));
  // An arc that grows with the turn still to make, ending in an arrow head.
  const sweep = 0.25 + cue.strength * 0.5;
  context.lineWidth = 2.5;
  context.beginPath();
  context.arc(0, 0, STEER_RING, -sweep, sweep);
  context.stroke();
  const head = STEER_RING + 6 + cue.strength * 10;
  context.beginPath();
  context.moveTo(head + 9, 0);
  context.lineTo(head - 3, -7);
  context.lineTo(head - 3, 7);
  context.closePath();
  context.fill();
  context.restore();
}

/** Where the ship is really heading relative to the objective: put this on the target to meet it. */
function drawVelocityMarker(context: CanvasRenderingContext2D, projector: ScreenProjector, frame: NavigationFrame): void {
  const relative = frame.shipVelocity.clone().sub(frame.objective.velocity);
  if (relative.length() < 0.8) {
    return;
  }
  const point = projector.project(frame.shipPosition.clone().addScaledVector(relative.normalize(), 40));
  if (!point.visible) {
    return;
  }
  context.strokeStyle = 'rgba(232, 255, 240, 0.85)';
  context.lineWidth = 1.5;
  context.beginPath();
  context.arc(point.x, point.y, 6, 0, Math.PI * 2);
  context.moveTo(point.x - 6, point.y);
  context.lineTo(point.x - 13, point.y);
  context.moveTo(point.x + 6, point.y);
  context.lineTo(point.x + 13, point.y);
  context.moveTo(point.x, point.y - 6);
  context.lineTo(point.x, point.y - 13);
  context.stroke();
}

/** Near a station or job, chevrons in space lead the way in, with the speed to arrive at. */
function drawApproach(context: CanvasRenderingContext2D, projector: ScreenProjector, frame: NavigationFrame, distance: number, elapsed: number): void {
  const { objective } = frame;
  if (objective.approachSpeed === null || distance > objective.approachRange || distance < 3) {
    return;
  }
  const from = frame.shipPosition;
  const to = objective.world;
  context.strokeStyle = objective.color;
  context.lineWidth = 2;
  const count = 6;
  for (let index = 0; index < count; index += 1) {
    const t = ((index + (elapsed * 0.8) % 1) / count) * 0.9 + 0.05;
    const here = projector.project(from.clone().lerp(to, t));
    const ahead = projector.project(from.clone().lerp(to, Math.min(1, t + 0.04)));
    if (!here.visible || here.depth < 2) {
      continue;
    }
    const angle = Math.atan2(ahead.y - here.y, ahead.x - here.x);
    context.globalAlpha = 0.25 + 0.6 * Math.sin(Math.PI * t);
    context.save();
    context.translate(here.x, here.y);
    context.rotate(angle);
    context.beginPath();
    context.moveTo(-5, -6);
    context.lineTo(3, 0);
    context.lineTo(-5, 6);
    context.stroke();
    context.restore();
  }
  context.globalAlpha = 1;
  const target = projector.project(to);
  const speed = frame.shipVelocity.clone().sub(objective.velocity).length();
  if (target.visible && distance < objective.approachRange * 0.6 && !objective.zone) {
    const tooFast = speed > objective.approachSpeed;
    context.textAlign = 'center';
    context.fillStyle = tooFast ? '#ffb347' : ON_TARGET_COLOR;
    context.fillText(
      tooFast ? `SLOW TO ${formatSpeed(objective.approachSpeed)} · BRAKE (S)` : `SPEED OK · ${formatSpeed(speed)}`,
      target.x,
      target.y - 26,
    );
  }
}
