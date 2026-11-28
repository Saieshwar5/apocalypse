/**
 * The pilot's logbook: the moments worth remembering across a career, kept
 * with the career record and shown on the menu. Newest first, and only the
 * most recent entries are kept.
 */
export interface LogEntry {
  /** YYYY-MM-DD. */
  date: string;
  text: string;
}

export const LOGBOOK_SIZE = 40;

export function addLogEntry(log: readonly LogEntry[], text: string, date: string): LogEntry[] {
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, 140);
  if (!clean) {
    return [...log];
  }
  return [{ date, text: clean }, ...log].slice(0, LOGBOOK_SIZE);
}

export function sanitizeLog(value: unknown): LogEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is LogEntry => typeof entry === 'object' && entry !== null && typeof entry.date === 'string' && typeof entry.text === 'string')
    .map((entry) => ({ date: entry.date.slice(0, 10), text: entry.text.slice(0, 140) }))
    .slice(0, LOGBOOK_SIZE);
}
