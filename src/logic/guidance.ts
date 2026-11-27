/**
 * Guidance answers the pilot's two questions: which asteroid matters most,
 * and can I get to it before it lands?
 */

/**
 * Seconds to close `gap` units, starting at `closingSpeed` and accelerating
 * at `acceleration` up to `topSpeed`.
 */
export function travelTime(gap: number, closingSpeed: number, topSpeed: number, acceleration: number): number {
  if (gap <= 0) {
    return 0;
  }
  const start = Math.min(Math.max(0, closingSpeed), topSpeed);
  const accelerationTime = (topSpeed - start) / acceleration;
  const accelerationDistance = start * accelerationTime + 0.5 * acceleration * accelerationTime * accelerationTime;
  if (gap >= accelerationDistance) {
    return accelerationTime + (gap - accelerationDistance) / topSpeed;
  }
  // Still speeding up on arrival: solve gap = start*t + a*t²/2.
  return (-start + Math.sqrt(start * start + 2 * acceleration * gap)) / acceleration;
}

export type InterceptVerdict = 'in-range' | 'in-time' | 'tight' | 'too-late';

/** Less spare time than this, in seconds, makes an intercept "tight". */
export const TIGHT_MARGIN_SECONDS = 10;

export function interceptVerdict(reachSeconds: number, impactSeconds: number): InterceptVerdict {
  if (reachSeconds <= 0) {
    return 'in-range';
  }
  const spare = impactSeconds - reachSeconds;
  if (spare < 0) {
    return 'too-late';
  }
  return spare < TIGHT_MARGIN_SECONDS ? 'tight' : 'in-time';
}

export interface GuidanceCandidate<T> {
  item: T;
  reachSeconds: number;
  impactSeconds: number;
}

export interface GuidanceChoice<T> extends GuidanceCandidate<T> {
  verdict: InterceptVerdict;
}

/**
 * Picks the priority target from threats listed most urgent first: the most
 * urgent one the ship can still reach. If none can be reached, the most
 * urgent is shown anyway so the pilot knows what is about to land.
 */
export function choosePriority<T>(candidates: readonly GuidanceCandidate<T>[]): GuidanceChoice<T> | null {
  if (candidates.length === 0) {
    return null;
  }
  const judged = candidates.map((candidate) => ({
    ...candidate,
    verdict: interceptVerdict(candidate.reachSeconds, candidate.impactSeconds),
  }));
  return judged.find((candidate) => candidate.verdict !== 'too-late') ?? judged[0];
}

/** Which way to turn, as seen from the cockpit, to face a direction given in the ship's frame. */
export function turnCue(localX: number, localY: number, localZ: number): string {
  // The ship looks along -Z.
  const ahead = -localZ;
  const sideways = Math.hypot(localX, localY);
  if (ahead > 0 && sideways < ahead * 0.12) {
    return 'AHEAD';
  }
  if (ahead < 0 && sideways < -ahead * 0.35) {
    return 'BEHIND';
  }
  const horizontal = localX > 0 ? 'RIGHT' : 'LEFT';
  const vertical = localY > 0 ? 'UP' : 'DOWN';
  if (Math.abs(localX) > Math.abs(localY) * 2.4) {
    return horizontal;
  }
  if (Math.abs(localY) > Math.abs(localX) * 2.4) {
    return vertical;
  }
  return `${vertical} ${horizontal}`;
}
