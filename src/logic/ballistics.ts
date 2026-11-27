import type { Vec3Tuple } from './random';

/**
 * Laser falloff: full damage up to `optimal`, then weaker until the bolt
 * dissipates at `maximum`. This makes close attacks stronger but riskier
 * (shrapnel, collisions) and long shots safer but slower to kill.
 */
export const LASER_RANGE = { optimal: 16, maximum: 44, minimumMultiplier: 0.35 } as const;

export type RangeBand = 'optimal' | 'reduced' | 'out-of-range';

export function laserRangeMultiplier(distance: number): number {
  if (distance <= LASER_RANGE.optimal) {
    return 1;
  }
  if (distance >= LASER_RANGE.maximum) {
    return 0;
  }
  const t = (distance - LASER_RANGE.optimal) / (LASER_RANGE.maximum - LASER_RANGE.optimal);
  return 1 - t * (1 - LASER_RANGE.minimumMultiplier);
}

export function laserRangeBand(distance: number): RangeBand {
  if (distance <= LASER_RANGE.optimal) {
    return 'optimal';
  }
  return distance < LASER_RANGE.maximum ? 'reduced' : 'out-of-range';
}

/** Damage from a blast, falling off linearly to zero at its radius. */
export function blastDamage(distance: number, blastRadius: number, maxDamage: number): number {
  if (blastRadius <= 0 || distance >= blastRadius) {
    return 0;
  }
  return maxDamage * (1 - Math.max(0, distance) / blastRadius);
}

/**
 * Seconds until a projectile fired now at `projectileSpeed` meets a target
 * moving in a straight line, or null if it can never catch it.
 * `relativePosition` and `relativeVelocity` are target minus shooter.
 */
export function interceptTime(
  relativePosition: Vec3Tuple,
  relativeVelocity: Vec3Tuple,
  projectileSpeed: number,
): number | null {
  const a = dot(relativeVelocity, relativeVelocity) - projectileSpeed * projectileSpeed;
  const b = 2 * dot(relativePosition, relativeVelocity);
  const c = dot(relativePosition, relativePosition);
  if (Math.abs(a) < 1e-9) {
    return b < 0 ? -c / b : null;
  }
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) {
    return null;
  }
  const root = Math.sqrt(discriminant);
  const candidates = [(-b - root) / (2 * a), (-b + root) / (2 * a)].filter((time) => time > 0);
  return candidates.length > 0 ? Math.min(...candidates) : null;
}

/** Point to aim at so a projectile meets the target, relative to the shooter. */
export function leadOffset(
  relativePosition: Vec3Tuple,
  relativeVelocity: Vec3Tuple,
  projectileSpeed: number,
): Vec3Tuple | null {
  const time = interceptTime(relativePosition, relativeVelocity, projectileSpeed);
  if (time === null) {
    return null;
  }
  return [
    relativePosition[0] + relativeVelocity[0] * time,
    relativePosition[1] + relativeVelocity[1] * time,
    relativePosition[2] + relativeVelocity[2] * time,
  ];
}

/** When and how close two bodies pass, given relative position and velocity. */
export function closestApproach(
  relativePosition: Vec3Tuple,
  relativeVelocity: Vec3Tuple,
): { time: number; distance: number } {
  const speedSquared = dot(relativeVelocity, relativeVelocity);
  const time = speedSquared === 0 ? 0 : Math.max(0, -dot(relativePosition, relativeVelocity) / speedSquared);
  const distance = Math.hypot(
    relativePosition[0] + relativeVelocity[0] * time,
    relativePosition[1] + relativeVelocity[1] * time,
    relativePosition[2] + relativeVelocity[2] * time,
  );
  return { time, distance };
}

function dot(a: Vec3Tuple, b: Vec3Tuple): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
