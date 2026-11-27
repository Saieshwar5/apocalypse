import type * as THREE from 'three';
import type { TargetingInfo } from '../game/targeting';
import { formatCountdown, formatDistance } from '../logic/units';
import type { CombatFeedback } from './combatFeedback';
import type { ScreenProjector } from './screenProjector';

const RANGE_STYLE = {
  optimal: { color: '#7dffb0', label: 'OPTIMAL RANGE' },
  reduced: { color: '#ffb347', label: 'REDUCED DAMAGE' },
  'out-of-range': { color: '#8a96a8', label: 'OUT OF RANGE' },
} as const;

const HIT_COLOR = { solid: '#ffffff', 'weak-range': '#ffb347', resisted: '#9aa6b5' } as const;

/**
 * The aiming reticle: its colour shows laser range to the target, a small
 * ring shows where to lead a moving target, ticks flash on every hit, and
 * warnings appear above it for blast and collision danger.
 */
export function drawReticle(
  context: CanvasRenderingContext2D,
  projector: ScreenProjector,
  aimPoint: THREE.Vector3,
  targeting: TargetingInfo,
  feedback: CombatFeedback,
  overheated: boolean,
  elapsed: number,
): void {
  const aim = projector.project(aimPoint);
  if (!aim.visible) {
    return;
  }
  const style = targeting.target ? RANGE_STYLE[targeting.rangeBand] : null;
  const color = overheated ? '#ff5a4a' : (style?.color ?? 'rgba(180, 255, 220, 0.9)');
  context.save();
  context.lineWidth = targeting.onTarget ? 2.5 : 1.5;
  context.strokeStyle = color;
  context.fillStyle = color;

  const radius = targeting.onTarget ? 10 : 12;
  context.beginPath();
  context.arc(aim.x, aim.y, radius, 0, Math.PI * 2);
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    context.moveTo(aim.x + dx * (radius + 4), aim.y + dy * (radius + 4));
    context.lineTo(aim.x + dx * (radius + 12), aim.y + dy * (radius + 12));
  }
  context.stroke();
  context.fillRect(aim.x - 1.5, aim.y - 1.5, 3, 3);

  if (feedback.hitMarker > 0) {
    drawHitMarker(context, aim.x, aim.y, HIT_COLOR[feedback.hitQuality], feedback.killMarker > 0);
  }

  if (targeting.onTarget && !overheated) {
    // On target: the reticle closes into a solid diamond, no text needed.
    context.beginPath();
    context.moveTo(aim.x, aim.y - 5);
    context.lineTo(aim.x + 5, aim.y);
    context.lineTo(aim.x, aim.y + 5);
    context.lineTo(aim.x - 5, aim.y);
    context.closePath();
    context.fill();
  }
  context.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
  context.textAlign = 'center';
  drawWarnings(context, aim.x, aim.y, targeting, elapsed);
  context.restore();

  drawLeadMarker(context, projector, targeting, color);
  drawTargetPanel(context, projector, targeting, overheated, style?.label ?? '', color);
}

/** Fixed readout at the bottom centre, so text never covers the target. */
function drawTargetPanel(
  context: CanvasRenderingContext2D,
  projector: ScreenProjector,
  targeting: TargetingInfo,
  overheated: boolean,
  rangeLabel: string,
  color: string,
): void {
  const target = targeting.target;
  if (!target && !overheated) {
    return;
  }
  const x = projector.width / 2;
  const y = projector.height - 96;
  const lines: [string, string][] = [];
  if (target) {
    const health = Math.max(0, Math.ceil((target.health / target.maxHealth) * 100));
    lines.push([`TARGET  ${target.size.toUpperCase()} ${target.material.toUpperCase()}  ·  ${health}% INTACT`, '#e8f1ff']);
    lines.push([`${formatDistance(targeting.distance)}  ·  ${rangeLabel}${targeting.onTarget ? '  ·  ON TARGET' : ''}`, color]);
  }
  if (overheated) {
    lines.push(['LASER OVERHEATED: RELEASE TRIGGER', '#ff5a4a']);
  }
  context.save();
  context.font = '600 12px ui-monospace, SFMono-Regular, Menlo, monospace';
  context.textAlign = 'center';
  const width = Math.max(...lines.map(([text]) => context.measureText(text).width)) + 28;
  const height = lines.length * 17 + 12;
  context.fillStyle = 'rgba(6, 14, 24, 0.62)';
  context.strokeStyle = 'rgba(130, 200, 255, 0.22)';
  context.beginPath();
  context.roundRect(x - width / 2, y - height, width, height, 6);
  context.fill();
  context.stroke();
  lines.forEach(([text, lineColor], index) => {
    context.fillStyle = lineColor;
    context.fillText(text, x, y - height + 20 + index * 17);
  });
  context.restore();
}

function drawHitMarker(context: CanvasRenderingContext2D, x: number, y: number, color: string, kill: boolean): void {
  context.save();
  context.strokeStyle = kill ? '#7dffb0' : color;
  context.lineWidth = kill ? 3 : 2;
  const inner = 6;
  const outer = kill ? 18 : 14;
  context.beginPath();
  for (const [sx, sy] of [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ]) {
    context.moveTo(x + sx * inner, y + sy * inner);
    context.lineTo(x + sx * outer, y + sy * outer);
  }
  context.stroke();
  context.restore();
}

/** Small ring at the lead point, joined to the target by a thin line. */
function drawLeadMarker(
  context: CanvasRenderingContext2D,
  projector: ScreenProjector,
  targeting: TargetingInfo,
  color: string,
): void {
  if (!targeting.target || !targeting.lead || targeting.rangeBand === 'out-of-range') {
    return;
  }
  const lead = projector.project(targeting.lead);
  const target = projector.project(targeting.target.mesh.position);
  if (!lead.visible || !target.visible) {
    return;
  }
  context.save();
  context.strokeStyle = color;
  context.globalAlpha = 0.85;
  context.setLineDash([3, 4]);
  context.beginPath();
  context.moveTo(target.x, target.y);
  context.lineTo(lead.x, lead.y);
  context.stroke();
  context.setLineDash([]);
  context.lineWidth = 2;
  context.beginPath();
  context.arc(lead.x, lead.y, 6, 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

function drawWarnings(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  targeting: TargetingInfo,
  elapsed: number,
): void {
  const blink = Math.sin(elapsed * 10) > -0.3;
  const warnings: string[] = [];
  if (targeting.collision) {
    warnings.push(`COLLISION ALERT ${formatCountdown(targeting.collision.seconds)}`);
  }
  if (targeting.dangerClose && targeting.target) {
    warnings.push('DANGER CLOSE: MISSILE BLAST WILL HIT YOU');
  }
  if (warnings.length === 0 || !blink) {
    return;
  }
  context.font = '700 13px ui-monospace, SFMono-Regular, Menlo, monospace';
  warnings.forEach((warning, index) => {
    const lineY = y - 48 - index * 24;
    const width = context.measureText(warning).width + 20;
    // Dark backing keeps red text readable over explosions and fire.
    context.fillStyle = 'rgba(20, 0, 0, 0.7)';
    context.fillRect(x - width / 2, lineY - 15, width, 21);
    context.fillStyle = '#ff5a4a';
    context.fillText(warning, x, lineY);
  });
}
