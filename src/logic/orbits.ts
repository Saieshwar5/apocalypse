import { PLANET_RADIUS } from './units';

/**
 * The three heights of the working orbit. Low orbit skims the air: fast,
 * close to the ground, and where debris burns away by itself. Medium orbit,
 * about one planet radius up, is the busy middle. High orbit is far out and
 * slow: rocks pass it first, so it gives the earliest shot at them.
 * Radii are from the planet's centre, in world units.
 */
export type OrbitTier = 'low' | 'medium' | 'high';

export interface OrbitTierDefinition {
  name: string;
  minRadius: number;
  maxRadius: number;
}

export const ORBIT_TIERS: Record<OrbitTier, OrbitTierDefinition> = {
  low: { name: 'Low orbit', minRadius: PLANET_RADIUS + 10, maxRadius: PLANET_RADIUS + 24 },
  medium: { name: 'Medium orbit', minRadius: PLANET_RADIUS * 2 - 4, maxRadius: PLANET_RADIUS * 2 + 16 },
  high: { name: 'High orbit', minRadius: PLANET_RADIUS * 3.4, maxRadius: PLANET_RADIUS * 3.9 },
};

/** Rocks appear beyond high orbit, so every one crosses all three on its way down. */
export const FIELD_START: [number, number] = [PLANET_RADIUS * 5.6, PLANET_RADIUS * 6.4];

/** The tier a distance from the planet's centre belongs to: the nearest band. */
export function orbitTierAt(radius: number): OrbitTier {
  const gap = (tier: OrbitTier) => Math.max(ORBIT_TIERS[tier].minRadius - radius, radius - ORBIT_TIERS[tier].maxRadius, 0);
  return (['low', 'medium', 'high'] as const).reduce((best, tier) => (gap(tier) < gap(best) ? tier : best));
}
