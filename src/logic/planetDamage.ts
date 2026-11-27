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
