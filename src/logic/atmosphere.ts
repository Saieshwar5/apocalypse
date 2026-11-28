import { stoppingDistance } from './flightModel';

/** Altitudes above the surface, in world units (1 unit is about 159 km). */
export const ATMOSPHERE = {
  /** "Pull up" warning starts here. */
  warning: 9,
  /** Top of the atmosphere: heating starts. Matches the visible glow shell. */
  top: 2.4,
  /** Below this the ship breaks up. */
  breakup: 0.5,
} as const;

/** The ship is turned back beyond `limit`; warned from `warning`. */
export const DEFENCE_ZONE = { warning: 360, limit: 420 } as const;

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
  return heat <= 0 && altitude > ATMOSPHERE.top ? 0 : 3 + 30 * heat;
}

/**
 * The automatic pull-up lets the ship skim the top of the atmosphere, where
 * heating is mild, and takes the controls at `PULL_UP_FLOOR`, or earlier when
 * the ship is sinking so fast that braking must start now to stop above that
 * floor (with `PULL_UP_REACTION` seconds allowed for turning the ship).
 */
export const PULL_UP_FLOOR = ATMOSPHERE.top - 1;
const PULL_UP_REACTION = 0.5;
/** The pull-up hands back control this far above the atmosphere, once climbing. */
const PULL_UP_CLEARANCE = 3;

/** `power`: braking power, below 1 for a heavily fitted ship, which needs more room. */
export function needsPullUp(altitude: number, sinkRate: number, power = 1): boolean {
  if (altitude <= PULL_UP_FLOOR) {
    return true;
  }
  return sinkRate > 0 && altitude - PULL_UP_FLOOR < stoppingDistance(sinkRate, power) + sinkRate * PULL_UP_REACTION;
}

export function pullUpComplete(altitude: number, sinkRate: number): boolean {
  return altitude >= ATMOSPHERE.top + PULL_UP_CLEARANCE && sinkRate <= 0;
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
