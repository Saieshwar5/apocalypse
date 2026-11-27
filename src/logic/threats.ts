import type { Vec3Tuple } from './random';

/**
 * Seconds until a body moving in a straight line reaches the planet surface
 * (planet centred on the origin), or null if its path misses the planet.
 */
export function timeToImpact(position: Vec3Tuple, velocity: Vec3Tuple, planetRadius: number): number | null {
  const a = dot(velocity, velocity);
  const b = 2 * dot(position, velocity);
  const c = dot(position, position) - planetRadius * planetRadius;
  if (c <= 0) {
    return 0;
  }
  if (a === 0) {
    return null;
  }
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) {
    return null;
  }
  const time = (-b - Math.sqrt(discriminant)) / (2 * a);
  return time >= 0 ? time : null;
}

export interface ThreatCandidate {
  timeToImpact: number | null;
  planetDamage: number;
}

/** Damage per second of remaining warning time. Asteroids that miss score 0. */
export function threatUrgency(threat: ThreatCandidate): number {
  if (threat.timeToImpact === null) {
    return 0;
  }
  return threat.planetDamage / Math.max(threat.timeToImpact, 1);
}

/** Most urgent first. Does not modify the input array. */
export function rankThreats<T extends ThreatCandidate>(threats: readonly T[]): T[] {
  return [...threats].sort((a, b) => threatUrgency(b) - threatUrgency(a));
}

function dot(a: Vec3Tuple, b: Vec3Tuple): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
