import type { RangeBand } from './ballistics';

/**
 * Close-in fighting: once the target is on screen and within laser reach
 * (or simply large in view), the question is no longer "where is it?" but
 * "am I hitting it?". The overlay then strips the target down to a lock
 * ring, one line and its health bar, and puts the finding aids away.
 */
export const ENGAGE = {
  /** A target this large on screen (radius in pixels) counts as close, whatever the range. */
  pixels: 30,
} as const;

export interface EngagementInput {
  hasTarget: boolean;
  onScreen: boolean;
  rangeBand: RangeBand;
  /** The target's radius on screen, in pixels. */
  projectedRadius: number;
}

export function isEngaged(input: EngagementInput): boolean {
  if (!input.hasTarget || !input.onScreen) {
    return false;
  }
  return input.rangeBand !== 'out-of-range' || input.projectedRadius >= ENGAGE.pixels;
}
