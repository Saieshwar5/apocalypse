import type { Vec3Tuple } from './random';

/**
 * Solar storms. A countdown gives the pilot time to shelter: in the planet's
 * shadow, or docked or berthed at a station. Out in the open the storm
 * drains the shield and then the hull, and the scanner is noisy. Afterwards
 * the atmosphere has swollen with the storm's heat and drags the lowest
 * satellites down: they sink until someone tows them back up.
 */
export const STORM = {
  warningSeconds: 30,
  durationSeconds: 35,
  shieldDrainPerSecond: 6,
  /** Hull damage per second once the shield is gone. */
  hullDrainPerSecond: 1.5,
  /** The scanner sees this share of its normal range during a storm. */
  scannerShare: 0.5,
} as const;

/** After a storm, satellites below this orbit radius start to sink, at this many units per second. */
export const SWELL = { belowRadius: 60, sinkPerSecond: 0.11 } as const;

/** Pay for towing a sinking satellite back up to its orbit slot. */
export const REBOOST_PAY = 380;

/**
 * True when `position` is in the planet's shadow: on the night side and
 * within the cylinder the planet blocks from the sun.
 */
export function inPlanetShadow(position: Vec3Tuple, sunDirection: Vec3Tuple, planetRadius: number): boolean {
  const along = position[0] * sunDirection[0] + position[1] * sunDirection[1] + position[2] * sunDirection[2];
  if (along >= 0) {
    return false;
  }
  const offAxis = Math.hypot(position[0] - sunDirection[0] * along, position[1] - sunDirection[1] * along, position[2] - sunDirection[2] * along);
  return offAxis < planetRadius;
}

/** Seconds until a sinking satellite falls to `burnRadius`, at the swell's sink rate. */
export function secondsUntilBurn(currentRadius: number, burnRadius: number): number {
  return Math.max(0, (currentRadius - burnRadius) / SWELL.sinkPerSecond);
}

/** A crew service call from Halo: pick up a crew, hold beside a satellite while they work, bring them home. */
export const CREW_CALL = { pay: 450, workSeconds: 20, holdRange: 6, holdRelativeSpeed: 2 } as const;
