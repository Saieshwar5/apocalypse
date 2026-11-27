import { ASTEROID_CLASSES, type AsteroidSize, type WeaponKind } from './asteroidClasses';

/** Intercepts beyond this distance from Earth's centre earn a bonus. */
export const DEEP_INTERCEPT_DISTANCE = 60;

/**
 * Points for destroying an asteroid. Meeting a threat far from Earth is
 * rewarded, because it means leaving the planet exposed to do it. Fragments
 * created by a laser are scored separately when they are destroyed.
 */
export function destroyScore(size: AsteroidSize, weapon: WeaponKind, distanceFromEarth: number): number {
  const base = ASTEROID_CLASSES[size].score;
  const deepBonus = distanceFromEarth >= DEEP_INTERCEPT_DISTANCE ? 0.5 : 0;
  const missileBonus = weapon === 'missile' && (size === 'large' || size === 'giant') ? 0.25 : 0;
  return Math.round(base * (1 + deepBonus + missileBonus));
}

/**
 * Bonus for finishing a wave, in proportion to how much of it the pilot
 * destroyed, so surviving a wave without fighting earns nothing. A wave with
 * no impacts at all doubles it.
 */
export function waveClearBonus(wave: number, destroyed: number, impacts: number): number {
  const total = destroyed + impacts;
  if (destroyed <= 0 || total <= 0) {
    return 0;
  }
  const base = Math.round((100 * wave * destroyed) / total);
  return impacts === 0 ? base * 2 : base;
}
