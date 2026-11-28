/**
 * How hard a season is. Relaxed is for learning the ship and the jobs;
 * Standard is the game as designed; Veteran is for pilots who finish
 * Standard with Earth in good shape and want it to bite.
 */
export type Difficulty = 'relaxed' | 'standard' | 'veteran';

export const DIFFICULTIES: readonly Difficulty[] = ['relaxed', 'standard', 'veteran'];

export interface DifficultyRules {
  label: string;
  /** One line for the menu. */
  summary: string;
  /** Multiplies what an impact takes from the planet. */
  planetDamage: number;
  /** Multiplies collision, shrapnel and blast damage to the ship. */
  shipDamage: number;
  /** Multiplies everything the pilot is paid. */
  pay: number;
  /** Every debris field is this many waves later, so denser and with tougher rocks. */
  waveShift: number;
}

export const DIFFICULTY: Record<Difficulty, DifficultyRules> = {
  relaxed: {
    label: 'Relaxed',
    summary: 'Impacts and hits hurt less. Pay is 10% lower',
    planetDamage: 0.6,
    shipDamage: 0.65,
    pay: 0.9,
    waveShift: 0,
  },
  standard: {
    label: 'Standard',
    summary: 'The season as designed',
    planetDamage: 1,
    shipDamage: 1,
    pay: 1,
    waveShift: 0,
  },
  veteran: {
    label: 'Veteran',
    summary: 'Denser fields, harder hits. Pay is 20% higher',
    planetDamage: 1.25,
    shipDamage: 1.25,
    pay: 1.2,
    waveShift: 2,
  },
};

/** Stored settings may be edited by hand: anything unknown is Standard. */
export function sanitizeDifficulty(value: unknown): Difficulty {
  return DIFFICULTIES.includes(value as Difficulty) ? (value as Difficulty) : 'standard';
}
