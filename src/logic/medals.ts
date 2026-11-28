/**
 * Medals grade how well each job was done, not just that it was done:
 * bronze for finishing, silver for doing it well, gold for doing it the way
 * a veteran would. Silver and gold add to the pay (except intercept
 * contracts, whose early and clean bonuses already reward the same thing),
 * and the tally is kept with the career.
 */
export type Medal = 'bronze' | 'silver' | 'gold';
export type JobKind = 'contract' | 'dodge' | 'tow' | 'reboost' | 'haul' | 'crew' | 'rescue' | 'escort';

export const JOB_KINDS: readonly JobKind[] = ['contract', 'dodge', 'tow', 'reboost', 'haul', 'crew', 'rescue', 'escort'];

export const JOB_LABEL: Record<JobKind, string> = {
  contract: 'Intercepts',
  dodge: 'Satellite dodges',
  tow: 'Repair tows',
  reboost: 'Reboosts',
  haul: 'Rock hauls',
  crew: 'Crew runs',
  rescue: 'Rescues',
  escort: 'Escorts',
};

export const MEDAL_THRESHOLD = { gold: 0.85, silver: 0.5 } as const;
export const MEDAL_BONUS: Record<Medal, number> = { bronze: 0, silver: 0.1, gold: 0.25 };

/** `score` is 0..1, how close to perfect the job was. */
export function medalFor(score: number): Medal {
  if (score >= MEDAL_THRESHOLD.gold) {
    return 'gold';
  }
  return score >= MEDAL_THRESHOLD.silver ? 'silver' : 'bronze';
}

/** Extra credits a medal earns on a job that paid `pay`. */
export function medalBonus(kind: JobKind, medal: Medal, pay: number): number {
  return kind === 'contract' ? 0 : Math.round(Math.max(0, pay) * MEDAL_BONUS[medal]);
}

/** 1 at or under par, falling to 0 at twice par. */
export function timeScore(seconds: number, par: number): number {
  if (par <= 0) {
    return 1;
  }
  return Math.min(1, Math.max(0, 2 - seconds / par));
}

/** Intercepts: early and clean is gold, one of them silver. */
export function contractScore(early: boolean, clean: boolean): number {
  return (early ? 0.5 : 0.1) + (clean ? 0.45 : 0.05);
}

/** Placing a satellite: on the slot is perfect, `tolerance` away is half marks. */
export function placementScore(offset: number | null, tolerance = 3): number {
  if (offset === null) {
    return 1;
  }
  return Math.max(0, 1 - offset / (2 * tolerance));
}

/** Passengers: every hard hit they feel costs a medal step. */
export function passengerScore(hardHits: number, seconds: number, par: number): number {
  const comfort = hardHits === 0 ? 1 : hardHits === 1 ? 0.6 : 0.3;
  return Math.min(comfort, 0.55 + 0.45 * timeScore(seconds, par));
}

/** Escorts: rocks cleared with most of the warning time left. */
export function escortScore(secondsLeftWhenClear: number, warningSeconds: number): number {
  return warningSeconds <= 0 ? 1 : Math.min(1, Math.max(0, 0.35 + secondsLeftWhenClear / warningSeconds));
}

export type MedalTally = Record<JobKind, Record<Medal, number>>;

export function emptyTally(): MedalTally {
  return Object.fromEntries(JOB_KINDS.map((kind) => [kind, { bronze: 0, silver: 0, gold: 0 }])) as MedalTally;
}

export function addMedal(tally: MedalTally, kind: JobKind, medal: Medal): MedalTally {
  return { ...tally, [kind]: { ...tally[kind], [medal]: tally[kind][medal] + 1 } };
}

export function totalMedals(tally: MedalTally, medal: Medal): number {
  return JOB_KINDS.reduce((total, kind) => total + tally[kind][medal], 0);
}

export function mergeTallies(a: MedalTally, b: MedalTally): MedalTally {
  const merged = emptyTally();
  for (const kind of JOB_KINDS) {
    for (const medal of ['bronze', 'silver', 'gold'] as const) {
      merged[kind][medal] = a[kind][medal] + b[kind][medal];
    }
  }
  return merged;
}

export function sanitizeTally(value: unknown): MedalTally {
  const tally = emptyTally();
  const source = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  for (const kind of JOB_KINDS) {
    const row = (typeof source[kind] === 'object' && source[kind] !== null ? source[kind] : {}) as Record<string, unknown>;
    for (const medal of ['bronze', 'silver', 'gold'] as const) {
      const count = row[medal];
      tally[kind][medal] = typeof count === 'number' && Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0;
    }
  }
  return tally;
}
