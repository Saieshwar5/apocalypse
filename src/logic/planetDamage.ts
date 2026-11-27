import {
  ASTEROID_CLASSES,
  MATERIAL_TRAITS,
  type AsteroidMaterial,
  type AsteroidSize,
} from './asteroidClasses';

export const MAX_PLANET_INTEGRITY = 100;

/** Integrity percentage removed when this asteroid reaches the surface. */
export function impactDamage(size: AsteroidSize, material: AsteroidMaterial): number {
  return ASTEROID_CLASSES[size].planetDamage * MATERIAL_TRAITS[material].planetDamageMultiplier;
}

/** Below this much damage an asteroid burns up in the atmosphere as a shooting star. */
export const BURN_UP_THRESHOLD = 0.6;

export function burnsUp(size: AsteroidSize, material: AsteroidMaterial): boolean {
  return impactDamage(size, material) < BURN_UP_THRESHOLD;
}

export type ThreatRating = 'harmless' | 'low' | 'moderate' | 'severe';

/** What an identified asteroid would do to the planet, in plain words. */
export function threatRating(size: AsteroidSize, material: AsteroidMaterial, missesPlanet = false): ThreatRating {
  const damage = impactDamage(size, material);
  if (missesPlanet || damage < BURN_UP_THRESHOLD) {
    return 'harmless';
  }
  if (damage < 3) {
    return 'low';
  }
  return damage < 12 ? 'moderate' : 'severe';
}

export function applyPlanetDamage(integrity: number, damage: number): number {
  if (damage < 0) {
    throw new RangeError('Planet damage cannot be negative');
  }
  return Math.max(0, integrity - damage);
}

/** Crater size on the globe, as an angle in radians from the impact point. */
export function craterAngularRadius(size: AsteroidSize): number {
  const byClass: Record<AsteroidSize, number> = {
    small: 0.025,
    medium: 0.05,
    large: 0.09,
    giant: 0.16,
  };
  return byClass[size];
}

export type IntegrityLevel = 'stable' | 'damaged' | 'critical';

export function integrityLevel(integrity: number): IntegrityLevel {
  if (integrity > 60) {
    return 'stable';
  }
  return integrity > 25 ? 'damaged' : 'critical';
}
