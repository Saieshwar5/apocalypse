import { orbitalPeriod, type CircularOrbit } from './satellites';

export type StationId = 'aegis' | 'vulcan' | 'ceres' | 'halo' | 'meridian' | 'anchor' | 'farwatch';

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
  meridian: { id: 'meridian', name: 'MERIDIAN', role: 'The city', services: 'home to forty thousand people', color: '#ffe6a8' },
  anchor: { id: 'anchor', name: 'ANCHOR', role: 'The port', services: 'supplies up from Earth, cheap fuel', color: '#9ad8c8' },
  farwatch: { id: 'farwatch', name: 'FARWATCH', role: 'The lookout', services: 'early warning and the shipyard', color: '#d6b8ff' },
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
  // The three great stations, one in each orbit.
  anchor: { radius: 90, period: orbitalPeriod(90), inclination: 0.12, ascendingNode: 5.1, phase: 4.2 },
  meridian: { radius: 132, period: orbitalPeriod(132), inclination: 0.5, ascendingNode: 3.1, phase: 2.0 },
  farwatch: { radius: 228, period: orbitalPeriod(228), inclination: 0.3, ascendingNode: 1.4, phase: 0.5 },
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
