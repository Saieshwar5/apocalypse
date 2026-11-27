import { parseRuns, recordRun, type RunRecord } from '../logic/bestRuns';

const STORAGE_KEY = 'singularity.bestRuns.v1';

/**
 * Best runs kept in this browser. Storage can be unavailable (private
 * windows, blocked site data), so every access is guarded and the game works
 * without it.
 */
export function loadBestRuns(): RunRecord[] {
  try {
    return parseRuns(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

export function saveRun(run: RunRecord): RunRecord[] {
  const runs = recordRun(loadBestRuns(), run);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(runs));
  } catch {
    // Nothing to do: the list is still shown for this session.
  }
  return runs;
}
