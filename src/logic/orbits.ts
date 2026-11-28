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

export const ORBIT_TIER_ORDER: readonly OrbitTier[] = ['low', 'medium', 'high'];

/** The middle of a tier's band: where a transfer aims. */
export function tierRadius(tier: OrbitTier): number {
  return (ORBIT_TIERS[tier].minRadius + ORBIT_TIERS[tier].maxRadius) / 2;
}

/** Within this much of an orbit's height, the ship is there. */
const ARRIVED_HEIGHT = 7;

export interface OrbitTransfer {
  tier: OrbitTier;
  /** "climb" or "descend" from where the ship is now, or "here" when it is already at that height. */
  way: 'climb' | 'descend' | 'here';
  /** Where to fly: straight up or down from the ship, at the tier's height. */
  point: [number, number, number];
  /** Units of height to gain or lose. */
  height: number;
}

/**
 * The three orbits as destinations from a position: straight up or down
 * from the ship, so the trip is a pure change of height and the ship
 * arrives over the same part of the planet. All three are always listed,
 * so a destination does not vanish half way through the climb.
 */
export function orbitTransfers(position: readonly [number, number, number]): OrbitTransfer[] {
  const radius = Math.hypot(position[0], position[1], position[2]);
  if (radius < 1e-6) {
    return [];
  }
  return ORBIT_TIER_ORDER.map((tier) => {
    const target = tierRadius(tier);
    const scale = target / radius;
    const height = Math.abs(target - radius);
    return { tier, way: height < ARRIVED_HEIGHT ? 'here' : target > radius ? 'climb' : 'descend', point: [position[0] * scale, position[1] * scale, position[2] * scale], height };
  });
}
