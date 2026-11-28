/**
 * The pilot's career across runs: total earnings and completed seasons,
 * kept in the browser, and the rank they earn. Ranks are recognition first;
 * mission control addresses the pilot by rank.
 */
export interface CareerRecord {
  /** Credits earned across every run. */
  earned: number;
  /** Seasons (full orbits) completed in good standing. */
  seasons: number;
  runs: number;
  trainingDone: boolean;
}

export const EMPTY_CAREER: CareerRecord = { earned: 0, seasons: 0, runs: 0, trainingDone: false };

export const RANKS = [
  { name: 'Cadet', earned: 0, seasons: 0 },
  { name: 'Pilot', earned: 2000, seasons: 0 },
  { name: 'Senior Pilot', earned: 8000, seasons: 1 },
  { name: 'Commander', earned: 20000, seasons: 3 },
] as const;

export type RankName = (typeof RANKS)[number]['name'];

export function rankFor(career: CareerRecord): RankName {
  let rank: RankName = RANKS[0].name;
  for (const candidate of RANKS) {
    if (career.earned >= candidate.earned && career.seasons >= candidate.seasons) {
      rank = candidate.name;
    }
  }
  return rank;
}

/** What is needed for the next rank, or null at the top. */
export function nextRank(career: CareerRecord): { name: RankName; earnedNeeded: number; seasonsNeeded: number } | null {
  const index = RANKS.findIndex((rank) => rank.name === rankFor(career));
  const next = RANKS[index + 1];
  if (!next) {
    return null;
  }
  return { name: next.name, earnedNeeded: Math.max(0, next.earned - career.earned), seasonsNeeded: Math.max(0, next.seasons - career.seasons) };
}

/** Adds one run to the career. */
export function recordCareerRun(career: CareerRecord, earned: number, seasonCompleted: boolean): CareerRecord {
  return {
    earned: career.earned + Math.max(0, earned),
    seasons: career.seasons + (seasonCompleted ? 1 : 0),
    runs: career.runs + 1,
    trainingDone: career.trainingDone,
  };
}

/** Stored data may be missing or edited: keep only sensible numbers. */
export function parseCareer(raw: string | null): CareerRecord {
  try {
    const value = raw ? (JSON.parse(raw) as Partial<CareerRecord>) : {};
    const number = (candidate: unknown) => (typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0 ? candidate : 0);
    return {
      earned: number(value.earned),
      seasons: Math.floor(number(value.seasons)),
      runs: Math.floor(number(value.runs)),
      trainingDone: value.trainingDone === true,
    };
  } catch {
    return { ...EMPTY_CAREER };
  }
}
