import { normalizeTuple, type Vec3Tuple } from './random';
import { placementAccuracy } from './towing';

export type SatelliteJobKind = 'dodge' | 'repair-tow' | 'reboost';

/**
 * Plans the path of an asteroid that will strike a satellite but miss the
 * planet: it crosses the satellite's future position at right angles to the
 * line from the planet, so its nearest approach to the planet is the
 * satellite's own height. `seed` chooses which way across.
 */
export function dodgeApproach(
  target: Vec3Tuple,
  seed: Vec3Tuple,
  speed: number,
  seconds: number,
): { position: Vec3Tuple; velocity: Vec3Tuple } {
  const lengthSquared = target[0] ** 2 + target[1] ** 2 + target[2] ** 2;
  const along = (seed[0] * target[0] + seed[1] * target[1] + seed[2] * target[2]) / lengthSquared;
  const across: Vec3Tuple = [seed[0] - target[0] * along, seed[1] - target[1] * along, seed[2] - target[2] * along];
  // A seed along the target line leaves nothing across it: pick any perpendicular.
  const fallback: Vec3Tuple = Math.abs(target[0]) < Math.abs(target[1]) ? [0, -target[2], target[1]] : [target[2], 0, -target[0]];
  const direction = normalizeTuple(Math.hypot(...across) > 1e-6 ? across : fallback);
  const velocity: Vec3Tuple = [direction[0] * speed, direction[1] * speed, direction[2] * speed];
  return {
    position: [target[0] - velocity[0] * seconds, target[1] - velocity[1] * seconds, target[2] - velocity[2] * seconds],
    velocity,
  };
}

/** Pay for a satellite job, scaled by how precisely the satellite was put back. */
export function satelliteJobPay(basePay: number, distanceFromSlot: number | null): number {
  const accuracy = distanceFromSlot === null ? 1 : placementAccuracy(distanceFromSlot);
  return Math.round((basePay * accuracy) / 5) * 5;
}
