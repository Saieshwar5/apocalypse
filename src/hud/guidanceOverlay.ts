import type * as THREE from 'three';
import type { Guidance } from '../game/guidance';
import type { Waypoint } from '../game/satelliteWork';
import type { InterceptVerdict } from '../logic/guidance';
import { formatCredits } from '../logic/contracts';
import { formatCountdown, formatDistance } from '../logic/units';
import type { Satellite } from '../satellites/satelliteFleet';
import type { ScreenProjector } from './screenProjector';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const PRIORITY_COLOR = '#ffd75e';
export const VERDICT_TEXT: Record<InterceptVerdict, string> = {
  'in-range': 'IN RANGE: FIRE',
  'in-time': 'YOU CAN MAKE IT',
  tight: 'HURRY: BOOST',
  'too-late': 'TOO LATE TO REACH',
};
export const VERDICT_COLOR: Record<InterceptVerdict, string> = {
  'in-range': '#7dffb0',
  'in-time': '#7dffb0',
  tight: '#ffb347',
  'too-late': '#ff5a4a',
};
/** Satellites are labelled inside this distance, so the sky is not covered in text. */
const SATELLITE_LABEL_RANGE = 130;

export interface GuidanceFrame {
  guidance: Guidance;
  satellites: readonly Satellite[];
  /** Quiet labels: satellites are named only when close or in the way. */
  quiet?: boolean;
  /** The target compass is showing the way: no extra off-screen arrows or text. */
  compass?: boolean;
  /** A load is being delivered: its drop zone marks the destination, so the job diamond is not drawn. */
  delivering?: boolean;
  shipPosition: THREE.Vector3;
  shipVelocity: THREE.Vector3;
  /** Flight assist off: show where the ship is really moving. */
  showDrift: boolean;
  /** Contract offer for the priority target, in credits; 0 when none. */
  priorityPay: number;
  /** True when the offer is an estimate because the rock is not scanned yet. */
  priorityEstimate: boolean;
  /** Where the current satellite job wants the ship to go. */
  waypoint: Waypoint | null;
  /** Nearby debris clouds. */
  debris: readonly { world: THREE.Vector3; text: string }[];
}

/**
 * Draws the guidance layer: the priority target with "reach" against
 * "impact" times, a turn arrow around the reticle when it is out of view,
 * satellite labels, and a drift marker showing the true direction of travel.
 */
export function drawGuidance(context: CanvasRenderingContext2D, projector: ScreenProjector, frame: GuidanceFrame, elapsed: number): void {
  context.save();
  context.font = `700 11px ${MONO}`;
  context.lineWidth = 1.5;
  drawSatellites(context, projector, frame);
  drawDebris(context, projector, frame);
  drawDrift(context, projector, frame);
  drawPriority(context, projector, frame, elapsed);
  drawWaypoint(context, projector, frame, elapsed);
  context.restore();
}

function drawPriority(context: CanvasRenderingContext2D, projector: ScreenProjector, frame: GuidanceFrame, elapsed: number): void {
  const priority = frame.guidance.priority;
  if (!priority) {
    return;
  }
  const point = projector.project(priority.item.mesh.position);
  const times = `REACH ${formatCountdown(priority.reachSeconds)} · IMPACT ${formatCountdown(priority.impactSeconds)}`;
  const verdict = VERDICT_TEXT[priority.verdict];
  const pay = frame.priorityPay > 0 ? ` · ${frame.priorityEstimate ? '~' : ''}${formatCredits(frame.priorityPay)}` : '';
  const centreX = projector.width / 2;
  const centreY = projector.height / 2;

  if (point.visible) {
    const size = Math.max(16, projector.projectedRadius(priority.item.radius, point.depth) * 1.5) + 2 * Math.sin(elapsed * 5);
    context.strokeStyle = PRIORITY_COLOR;
    context.beginPath();
    context.arc(point.x, point.y, size, 0, Math.PI * 2);
    context.stroke();
    // Tick marks at the four quarters make the ring read as a target, not a planet.
    context.beginPath();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      context.moveTo(point.x + dx * size, point.y + dy * size);
      context.lineTo(point.x + dx * (size + 7), point.y + dy * (size + 7));
    }
    context.stroke();
    context.textAlign = 'center';
    context.fillStyle = PRIORITY_COLOR;
    context.fillText(`PRIORITY${pay}`, point.x, point.y - size - 24);
    context.fillStyle = 'rgba(232, 241, 255, 0.9)';
    context.fillText(times, point.x, point.y - size - 11);
    context.fillStyle = VERDICT_COLOR[priority.verdict];
    context.fillText(verdict, point.x, point.y + size + 34);
    return;
  }

  // Out of view: the compass beside the crosshair shows the way and says what matters about it.
  if (frame.compass) {
    return;
  }
  const angle = Math.atan2(point.y - centreY, point.x - centreX);
  const ring = Math.min(projector.width, projector.height) * 0.2;
  const x = centreX + Math.cos(angle) * ring;
  const y = centreY + Math.sin(angle) * ring;
  context.save();
  context.translate(x, y);
  context.rotate(angle);
  context.globalAlpha = frame.compass ? 0 : 0.7 + 0.3 * Math.sin(elapsed * 6);
  context.fillStyle = PRIORITY_COLOR;
  context.beginPath();
  context.moveTo(20, 0);
  context.lineTo(-4, -11);
  context.lineTo(2, 0);
  context.lineTo(-4, 11);
  context.closePath();
  context.fill();
  context.restore();

  // The text sits under the reticle, where it never hides behind a panel.
  const textY = centreY + ring + 34;
  context.textAlign = 'center';
  context.fillStyle = PRIORITY_COLOR;
  context.fillText(frame.compass ? `PRIORITY${pay} · ${formatDistance(priority.distance)}` : `PRIORITY${pay} · TURN ${priority.cue} · ${formatDistance(priority.distance)}`, centreX, textY);
  context.fillStyle = 'rgba(232, 241, 255, 0.9)';
  context.fillText(times, centreX, textY + 13);
  context.fillStyle = VERDICT_COLOR[priority.verdict];
  context.fillText(verdict, centreX, textY + 26);
}

function drawSatellites(context: CanvasRenderingContext2D, projector: ScreenProjector, frame: GuidanceFrame): void {
  const ahead = frame.guidance.satelliteAhead?.satellite ?? null;
  context.textAlign = 'left';
  for (const satellite of frame.satellites) {
    if (!satellite.alive) {
      continue;
    }
    const distance = satellite.position.distanceTo(frame.shipPosition);
    const danger = satellite === ahead;
    if (distance > (frame.quiet ? SATELLITE_LABEL_RANGE / 3 : SATELLITE_LABEL_RANGE) && !danger) {
      continue;
    }
    const point = projector.project(satellite.position);
    if (!point.visible) {
      continue;
    }
    const color = danger ? '#ff5a4a' : '#aeb9c9';
    const size = Math.max(6, projector.projectedRadius(satellite.radius, point.depth));
    context.strokeStyle = color;
    context.fillStyle = color;
    context.globalAlpha = danger ? 1 : 0.8;
    // A diamond, so satellites never look like asteroid brackets.
    context.beginPath();
    context.moveTo(point.x, point.y - size);
    context.lineTo(point.x + size, point.y);
    context.lineTo(point.x, point.y + size);
    context.lineTo(point.x - size, point.y);
    context.closePath();
    context.stroke();
    const label = danger ? `${satellite.name} · STEER CLEAR` : `${satellite.name} ${formatDistance(distance)}`;
    context.fillText(label, point.x + size + 6, point.y + 4);
  }
  context.globalAlpha = 1;
}

/** A small circle with wings where the ship is actually heading. */
function drawDrift(context: CanvasRenderingContext2D, projector: ScreenProjector, frame: GuidanceFrame): void {
  const speed = frame.shipVelocity.length();
  if (!frame.showDrift || speed < 1) {
    return;
  }
  const ahead = frame.shipPosition.clone().addScaledVector(frame.shipVelocity, 200 / speed);
  const point = projector.project(ahead);
  if (!point.visible) {
    return;
  }
  context.strokeStyle = '#8fd3ff';
  context.fillStyle = '#8fd3ff';
  context.beginPath();
  context.arc(point.x, point.y, 6, 0, Math.PI * 2);
  context.moveTo(point.x - 14, point.y);
  context.lineTo(point.x - 6, point.y);
  context.moveTo(point.x + 6, point.y);
  context.lineTo(point.x + 14, point.y);
  context.moveTo(point.x, point.y - 6);
  context.lineTo(point.x, point.y - 12);
  context.stroke();
  context.textAlign = 'left';
  context.fillText('DRIFT', point.x + 18, point.y + 4);
}

const WAYPOINT_COLOR = '#8fd3ff';

/** The satellite job's next stop: a cyan diamond, or an arrow above the reticle when out of view. */
function drawWaypoint(context: CanvasRenderingContext2D, projector: ScreenProjector, frame: GuidanceFrame, elapsed: number): void {
  const waypoint = frame.waypoint;
  if (!waypoint || frame.delivering) {
    return;
  }
  const point = projector.project(waypoint.world);
  const distance = formatDistance(waypoint.world.distanceTo(frame.shipPosition));
  context.save();
  context.font = `700 11px ${MONO}`;
  context.strokeStyle = WAYPOINT_COLOR;
  context.fillStyle = WAYPOINT_COLOR;
  context.lineWidth = 2;
  if (point.visible) {
    const size = 11 + 2 * Math.sin(elapsed * 4);
    context.beginPath();
    context.moveTo(point.x, point.y - size);
    context.lineTo(point.x + size, point.y);
    context.lineTo(point.x, point.y + size);
    context.lineTo(point.x - size, point.y);
    context.closePath();
    context.stroke();
    context.textAlign = 'center';
    context.fillText(waypoint.label, point.x, point.y + size + 16);
    context.fillText(distance, point.x, point.y + size + 29);
    context.restore();
    return;
  }
  if (frame.compass) {
    context.restore();
    return;
  }
  const centreX = projector.width / 2;
  const centreY = projector.height / 2;
  const angle = Math.atan2(point.y - centreY, point.x - centreX);
  const ring = Math.min(projector.width, projector.height) * 0.2 + 14;
  context.globalAlpha = frame.compass ? 0 : 1;
  context.translate(centreX + Math.cos(angle) * ring, centreY + Math.sin(angle) * ring);
  context.rotate(angle);
  context.beginPath();
  context.moveTo(14, 0);
  context.lineTo(0, -8);
  context.lineTo(4, 0);
  context.lineTo(0, 8);
  context.closePath();
  context.fill();
  context.rotate(-angle);
  context.translate(-(centreX + Math.cos(angle) * ring), -(centreY + Math.sin(angle) * ring));
  context.globalAlpha = 1;
  context.textAlign = 'center';
  // Below the priority lines, where the message banner cannot cover it.
  context.fillText(`JOB · ${waypoint.label} · ${distance}`, centreX, centreY + ring + 78);
  context.restore();
}

/** Debris clouds: a dashed amber ring with the cloud's mass. */
function drawDebris(context: CanvasRenderingContext2D, projector: ScreenProjector, frame: GuidanceFrame): void {
  context.save();
  context.strokeStyle = 'rgba(255, 179, 71, 0.8)';
  context.fillStyle = 'rgba(255, 179, 71, 0.9)';
  context.setLineDash([3, 4]);
  context.textAlign = 'left';
  for (const cloud of frame.debris) {
    const point = projector.project(cloud.world);
    if (!point.visible) {
      continue;
    }
    context.beginPath();
    context.arc(point.x, point.y, 12, 0, Math.PI * 2);
    context.stroke();
    context.fillText(`${cloud.text} · ${formatDistance(cloud.world.distanceTo(frame.shipPosition))}`, point.x + 16, point.y + 4);
  }
  context.restore();
}
