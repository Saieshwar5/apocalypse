export type SectorKind = 'calm' | 'light' | 'dense' | 'giant';

export interface Sector {
  kind: SectorKind;
  /** Wave number that sets the asteroid mix; 0 for calm sectors. */
  wave: number;
  /** Length of a calm sector in seconds; unused for fields, which end when cleared. */
  seconds: number;
}

export const SECTOR_LABEL: Record<SectorKind, string> = {
  calm: 'Calm zone',
  light: 'Light debris',
  dense: 'Dense field',
  giant: 'Giant inbound',
};

function field(wave: number): Sector {
  return { kind: wave % 5 === 0 ? 'giant' : wave <= 2 ? 'light' : 'dense', wave, seconds: 0 };
}

function calm(seconds: number): Sector {
  return { kind: 'calm', wave: 0, seconds };
}

/**
 * One orbit of the planet around its star: debris fields separated by calm
 * zones where the pilot can dock, repair and reposition the station. The
 * orbit ends with a giant. `difficulty` shifts every field to a later, harder
 * wave for later star systems.
 */
export function buildOrbitPlan(difficulty = 0): Sector[] {
  const w = (wave: number) => field(wave + difficulty);
  return [
    calm(18),
    w(1),
    w(2),
    calm(35),
    w(3),
    w(4),
    calm(35),
    field(5 + difficulty - (difficulty % 5)),
    w(6),
    calm(40),
    w(7),
    w(8),
    calm(40),
    field(10 + difficulty - (difficulty % 5)),
  ];
}

/** One to three stars for a completed orbit. */
export function orbitRating(integrity: number, citiesStanding: number, cityCount: number): number {
  if (integrity >= 80 && citiesStanding === cityCount) {
    return 3;
  }
  return integrity >= 50 && citiesStanding >= Math.ceil(cityCount * 0.7) ? 2 : 1;
}
