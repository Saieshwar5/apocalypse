/** Altitudes above the surface, in world units (1 unit = 637 km). */
export const ATMOSPHERE = {
  /** "Pull up" warning starts here. */
  warning: 1.6,
  /** Top of the atmosphere: heating starts. Matches the visible glow shell. */
  top: 0.6,
  /** Below this the ship breaks up. */
  breakup: 0.2,
} as const;

/** The ship is turned back beyond `limit`; warned from `warning`. */
export const DEFENCE_ZONE = { warning: 260, limit: 300 } as const;

export type AtmosphereZone = 'space' | 'warning' | 'atmosphere' | 'breakup';

export function atmosphereZone(altitude: number): AtmosphereZone {
  if (altitude <= ATMOSPHERE.breakup) {
    return 'breakup';
  }
  if (altitude <= ATMOSPHERE.top) {
    return 'atmosphere';
  }
  return altitude <= ATMOSPHERE.warning ? 'warning' : 'space';
}

/** 0 at the top of the atmosphere, 1 at break-up depth. */
export function entryHeat(altitude: number): number {
  const depth = (ATMOSPHERE.top - altitude) / (ATMOSPHERE.top - ATMOSPHERE.breakup);
  return Math.min(1, Math.max(0, depth));
}

/** Heating damage per second: survivable at the edge, lethal deep in. */
export function entryDamagePerSecond(altitude: number): number {
  const heat = entryHeat(altitude);
  return heat <= 0 && altitude > ATMOSPHERE.top ? 0 : 8 + 60 * heat;
}

export interface AltitudeReadout {
  fromCentre: number;
  aboveSurface: number;
  /** Negative once inside the atmosphere. */
  aboveAtmosphere: number;
}

export function altitudeReadout(distanceFromCentre: number, planetRadius: number): AltitudeReadout {
  const aboveSurface = distanceFromCentre - planetRadius;
  return { fromCentre: distanceFromCentre, aboveSurface, aboveAtmosphere: aboveSurface - ATMOSPHERE.top };
}
