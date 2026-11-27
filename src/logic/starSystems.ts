import { SITE_DEFINITIONS, type SiteDefinition } from './prioritySites';

export interface StarSystem {
  id: string;
  /** Name of the star, for the travel button. */
  star: string;
  /** Name of the world being defended. */
  planet: string;
  /** Shifts every debris field to a later, harder wave. */
  difficulty: number;
  /** Colour of the star's light as RGB 0..1. */
  starColor: [number, number, number];
  sites: readonly SiteDefinition[];
  /** Null uses the photographic Earth textures; otherwise a generated world. */
  surface: PlanetSurface | null;
  briefing: string;
}

export interface PlanetSurface {
  seed: number;
  /** Fraction of the surface under water, roughly. */
  seaLevel: number;
  land: [number, number, number];
  highland: [number, number, number];
  sea: [number, number, number];
  ice: [number, number, number];
}

const MERIDIAN_SITES: readonly SiteDefinition[] = [
  { id: 'port-aurora', name: 'Port Aurora', kind: 'city', latitude: 24, longitude: 18, population: 6 },
  { id: 'new-chennai', name: 'New Chennai', kind: 'city', latitude: -12, longitude: 71, population: 9 },
  { id: 'halcyon', name: 'Halcyon', kind: 'city', latitude: 46, longitude: -64, population: 4 },
  { id: 'redwater', name: 'Redwater', kind: 'city', latitude: -38, longitude: -112, population: 3 },
  { id: 'kestrel-bay', name: 'Kestrel Bay', kind: 'city', latitude: 8, longitude: 148, population: 5 },
  { id: 'solace', name: 'Solace', kind: 'city', latitude: -52, longitude: -8, population: 2 },
  { id: 'launch', name: 'Landing Field', kind: 'launch', latitude: 15, longitude: 80, population: 0 },
  { id: 'radar', name: 'Sky Watch', kind: 'radar', latitude: -74, longitude: 160, population: 0 },
];

/** The campaign: Earth first, then humanity's colonies. */
export const STAR_SYSTEMS: readonly StarSystem[] = [
  {
    id: 'sol',
    star: 'Sol',
    planet: 'Earth',
    difficulty: 0,
    starColor: [1, 0.96, 0.9],
    sites: SITE_DEFINITIONS,
    surface: null,
    briefing: 'In orbit. Defend Earth',
  },
  {
    id: 'tau-ceti',
    star: 'Tau Ceti',
    planet: 'Meridian',
    difficulty: 3,
    starColor: [1, 0.78, 0.55],
    sites: MERIDIAN_SITES,
    surface: {
      seed: 442,
      seaLevel: 0.52,
      land: [0.55, 0.36, 0.22],
      highland: [0.42, 0.3, 0.26],
      sea: [0.05, 0.25, 0.3],
      ice: [0.86, 0.9, 0.95],
    },
    briefing: 'Jump complete. The Meridian colony has six settlements and thinner defences. Hold the orbit',
  },
];

export function nextSystem(index: number): StarSystem | null {
  return STAR_SYSTEMS[index + 1] ?? null;
}
