import type * as THREE from 'three';
import type { Guidance } from '../game/guidance';
import type { InterceptVerdict } from '../logic/guidance';
import { formatCredits } from '../logic/contracts';
import { formatCountdown, formatDistance } from '../logic/units';
import type { Satellite } from '../satellites/satelliteFleet';
import type { ScreenProjector } from './screenProjector';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const PRIORITY_COLOR = '#ffd75e';
const VERDICT_TEXT: Record<InterceptVerdict, string> = {
  'in-range': 'IN RANGE: FIRE',
  'in-time': 'YOU CAN MAKE IT',
  tight: 'HURRY: BOOST',
  'too-late': 'TOO LATE TO REACH',
};
const VERDICT_COLOR: Record<InterceptVerdict, string> = {
  'in-range': '#7dffb0',
  'in-time': '#7dffb0',
  tight: '#ffb347',
  'too-late': '#ff5a4a',
};
const SATELLITE_LABEL: Record<Satellite['kind'], string> = { comms: 'COMMS SAT', nav: 'NAV SAT', weather: 'WEATHER SAT' };
/** Satellites are labelled inside this distance, so the sky is not covered in text. */
const SATELLITE_LABEL_RANGE = 130;

export interface GuidanceFrame {
  guidance: Guidance;
  satellites: readonly Satellite[];
  shipPosition: THREE.Vector3;
  shipVelocity: THREE.Vector3;
  /** Flight assist off: show where the ship is really moving. */
  showDrift: boolean;
  /** Contract offer for the priority target, in credits; 0 when none. */
  priorityPay: number;
  /** True when the offer is an estimate because the rock is not scanned yet. */
  priorityEstimate: boolean;
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
  drawDrift(context, projector, frame);
  drawPriority(context, projector, frame, elapsed);
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

  // Out of view: an arrow on a ring around the reticle shows which way to turn.
  const angle = Math.atan2(point.y - centreY, point.x - centreX);
  const ring = Math.min(projector.width, projector.height) * 0.2;
  const x = centreX + Math.cos(angle) * ring;
  const y = centreY + Math.sin(angle) * ring;
  context.save();
  context.translate(x, y);
  context.rotate(angle);
  context.globalAlpha = 0.7 + 0.3 * Math.sin(elapsed * 6);
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
  context.fillText(`PRIORITY${pay} · TURN ${priority.cue} · ${formatDistance(priority.distance)}`, centreX, textY);
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
    if (distance > SATELLITE_LABEL_RANGE && !danger) {
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
    const label = danger ? `${SATELLITE_LABEL[satellite.kind]} · STEER CLEAR` : `${SATELLITE_LABEL[satellite.kind]} ${formatDistance(distance)}`;
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
