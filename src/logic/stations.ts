import { orbitalPeriod, type CircularOrbit } from './satellites';

export type StationId = 'aegis' | 'vulcan' | 'ceres' | 'halo';

export interface StationDefinition {
  id: StationId;
  name: string;
  role: string;
  /** Shown on the station's marker: what the pilot goes there for. */
  services: string;
  /** Marker colour on the HUD and scanner. */
  color: string;
}

/**
 * The four stations of the orbit. Aegis is the pilot's home port and has
 * its own orbit code (it can be moved from the tactical map); the other three
 * follow fixed orbits at different heights, so each trip is a different
 * flight. Only Aegis docks the ship; Vulcan Yard takes satellites for repair.
 */
export const STATIONS: Record<StationId, StationDefinition> = {
  aegis: { id: 'aegis', name: 'AEGIS', role: 'Defence base', services: 'fuel · missiles · repairs · upgrades', color: '#5fd8ff' },
  vulcan: { id: 'vulcan', name: 'VULCAN YARD', role: 'Repair yard', services: 'satellite repairs', color: '#ffb347' },
  ceres: { id: 'ceres', name: 'CERES WORKS', role: 'Refinery', services: 'fuel and parts depot', color: '#7dffb0' },
  halo: { id: 'halo', name: 'HALO', role: 'Crew habitat', services: 'passengers and rescue', color: '#cfe3ff' },
};

/**
 * Orbits of the outposts, one in each of the three orbits: Vulcan Yard low
 * (near the weather satellites it mends most), the Ceres depot in the
 * middle, and Halo far out. Aegis, the pilot's base, is also low.
 */
export const OUTPOST_ORBITS: Record<Exclude<StationId, 'aegis'>, CircularOrbit> = {
  vulcan: { radius: 82, period: orbitalPeriod(82), inclination: 0.35, ascendingNode: 2.2, phase: 1.1 },
  ceres: { radius: 126, period: orbitalPeriod(126), inclination: 0.2, ascendingNode: 0.6, phase: 5.0 },
  halo: { radius: 218, period: orbitalPeriod(218), inclination: 0.9, ascendingNode: 4.0, phase: 3.6 },
};

/** Seconds the yard takes to repair one satellite. */
export const YARD_REPAIR_SECONDS = 60;

/** Contract pay for satellite work, in credits. */
export const SATELLITE_JOB_PAY = {
  /** Moving a satellite out of an asteroid's path and back. */
  dodge: 320,
  /** Towing a broken satellite to the yard, collecting it and putting it back. */
  repairTow: 480,
} as const;
