import type { WeaponKind } from './asteroidClasses';

/** Momentum each weapon delivers, in arbitrary units (mass is radius cubed). */
const WEAPON_IMPULSE: Record<WeaponKind, number> = { laser: 0.5, missile: 30 };
/** No single hit changes an asteroid's speed by more than this. */
const MAX_SPEED_CHANGE = 2.5;

/** Asteroids are treated as uniform spheres, so mass grows with the cube of radius. */
export function asteroidMass(radius: number, density = 1): number {
  return radius * radius * radius * density;
}

/**
 * Speed change (units per second) a hit gives an asteroid. Missiles shove
 * small rocks hard and nudge giants; several missiles can push a giant far
 * enough off course to miss the planet, which is how big threats are
 * deflected rather than destroyed.
 */
export function hitSpeedChange(weapon: WeaponKind, radius: number, density = 1): number {
  return Math.min(MAX_SPEED_CHANGE, WEAPON_IMPULSE[weapon] / asteroidMass(Math.max(radius, 0.05), density));
}

/** Points for pushing an asteroid onto a path that misses the planet. */
export function deflectionScore(baseScore: number): number {
  return Math.round(baseScore * 0.75);
}
