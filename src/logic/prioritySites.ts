import type { AsteroidSize } from './asteroidClasses';

export type SiteKind = 'city' | 'launch' | 'radar';

export interface SiteDefinition {
  id: string;
  name: string;
  kind: SiteKind;
  latitude: number;
  longitude: number;
  /** Metropolitan population in millions (cities only). */
  population: number;
}

/** One city per inhabited continent, plus the two installations. */
export const SITE_DEFINITIONS: readonly SiteDefinition[] = [
  { id: 'mumbai', name: 'Mumbai', kind: 'city', latitude: 19.08, longitude: 72.88, population: 21 },
  { id: 'new-york', name: 'New York', kind: 'city', latitude: 40.71, longitude: -74.01, population: 19 },
  { id: 'sao-paulo', name: 'São Paulo', kind: 'city', latitude: -23.55, longitude: -46.63, population: 22 },
  { id: 'lagos', name: 'Lagos', kind: 'city', latitude: 6.52, longitude: 3.38, population: 15 },
  { id: 'london', name: 'London', kind: 'city', latitude: 51.51, longitude: -0.13, population: 9 },
  { id: 'sydney', name: 'Sydney', kind: 'city', latitude: -33.87, longitude: 151.21, population: 5 },
  { id: 'launch', name: 'Launch Complex', kind: 'launch', latitude: 13.72, longitude: 80.23, population: 0 },
  { id: 'radar', name: 'Deep-Space Radar', kind: 'radar', latitude: -77.85, longitude: 166.67, population: 0 },
];

export const SITE_MAX_HEALTH = 100;
/** Health a surviving site regains between waves. */
export const SITE_REPAIR_PER_WAVE = 15;

/**
 * How far an impact reaches (angle from the impact point, in radians; 0.1
 * is about 640 km on the ground) and the damage it does at the centre.
 */
export const IMPACT_REACH: Record<AsteroidSize, { radius: number; damage: number }> = {
  small: { radius: 0.07, damage: 14 },
  medium: { radius: 0.11, damage: 38 },
  large: { radius: 0.17, damage: 75 },
  giant: { radius: 0.3, damage: 100 },
};

/** Full damage within half the reach, falling to zero at its edge. */
export function siteDamage(angularDistance: number, size: AsteroidSize): number {
  const { radius, damage } = IMPACT_REACH[size];
  if (angularDistance >= radius) {
    return 0;
  }
  const inner = radius / 2;
  if (angularDistance <= inner) {
    return damage;
  }
  return damage * (1 - (angularDistance - inner) / (radius - inner));
}

export type SiteCondition = 'intact' | 'damaged' | 'critical' | 'destroyed';

export function siteCondition(health: number): SiteCondition {
  if (health <= 0) {
    return 'destroyed';
  }
  if (health <= 35) {
    return 'critical';
  }
  return health < SITE_MAX_HEALTH ? 'damaged' : 'intact';
}

export function repairedHealth(health: number): number {
  return health <= 0 ? 0 : Math.min(SITE_MAX_HEALTH, health + SITE_REPAIR_PER_WAVE);
}

/** Share of later-wave asteroids aimed straight at a site. */
export function siteTargetingChance(wave: number): number {
  return wave < 2 ? 0 : Math.min(0.45, 0.1 * wave);
}
