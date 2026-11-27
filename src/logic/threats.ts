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
  /** What the pilot knows so far; used in place of planetDamage when present. */
  assessedDamage?: number;
  /** True when the predicted impact would damage a priority site. */
  threatensSite?: boolean;
}

/** An asteroid heading for a priority site counts this many times over. */
const SITE_THREAT_WEIGHT = 2.5;

/** Damage per second of remaining warning time. Asteroids that miss score 0. */
export function threatUrgency(threat: ThreatCandidate): number {
  if (threat.timeToImpact === null) {
    return 0;
  }
  const weight = threat.threatensSite ? SITE_THREAT_WEIGHT : 1;
  return ((threat.assessedDamage ?? threat.planetDamage) * weight) / Math.max(threat.timeToImpact, 1);
}

/** Most urgent first. Does not modify the input array. */
export function rankThreats<T extends ThreatCandidate>(threats: readonly T[]): T[] {
  return [...threats].sort((a, b) => threatUrgency(b) - threatUrgency(a));
}

function dot(a: Vec3Tuple, b: Vec3Tuple): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
