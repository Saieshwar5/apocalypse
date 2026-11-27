export interface RunRecord {
  score: number;
  planet: string;
  victory: boolean;
  stars: number;
  citiesStanding: number;
  cityCount: number;
  /** ISO date, for display. */
  date: string;
}

export const MAX_BEST_RUNS = 5;

/** Adds a run and keeps the best few, highest score first. */
export function recordRun(runs: readonly RunRecord[], run: RunRecord): RunRecord[] {
  return [...runs, run].sort((a, b) => b.score - a.score).slice(0, MAX_BEST_RUNS);
}

/** Stored data may be missing, old or edited by hand: keep only well-formed records. */
export function parseRuns(raw: string | null): RunRecord[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(
        (entry): entry is RunRecord =>
          typeof entry === 'object' &&
          entry !== null &&
          typeof (entry as RunRecord).score === 'number' &&
          Number.isFinite((entry as RunRecord).score) &&
          typeof (entry as RunRecord).planet === 'string' &&
          typeof (entry as RunRecord).date === 'string',
      )
      .slice(0, MAX_BEST_RUNS);
  } catch {
    return [];
  }
}

/** One line to paste when sharing a result. */
export function shareText(run: RunRecord): string {
  const outcome = run.victory ? `held ${run.planet}'s orbit ${'★'.repeat(run.stars)}${'☆'.repeat(3 - run.stars)}` : `lost ${run.planet}`;
  return `Singularity: I ${outcome} with ${run.score.toLocaleString('en-US')} points and ${run.citiesStanding} of ${run.cityCount} cities standing.`;
}
