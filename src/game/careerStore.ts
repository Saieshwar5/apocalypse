import { parseCareer, type CareerRecord } from '../logic/career';

const STORAGE_KEY = 'singularity.career.v1';

/** The career kept in this browser; storage may be unavailable, and the game works without it. */
export function loadCareer(): CareerRecord {
  try {
    return parseCareer(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return parseCareer(null);
  }
}

export function saveCareer(career: CareerRecord): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(career));
  } catch {
    // Nothing to do: the career still counts for this session.
  }
}
