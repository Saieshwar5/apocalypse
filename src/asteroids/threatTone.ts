import type { Asteroid } from './asteroidField';

export type ThreatTone = 'urgent' | 'heavy' | 'normal' | 'miss';

/** How many of the most urgent threats are drawn in red. */
export const URGENT_COUNT = 3;

export const THREAT_COLORS: Record<ThreatTone, string> = {
  urgent: '#ff5a4a',
  heavy: '#ffb347',
  normal: '#e8f1ff',
  miss: '#7f8c9e',
};

/** Shared colour language for brackets, radar, path lines and markers. */
export function threatTone(asteroid: Asteroid, rank: number): ThreatTone {
  if (asteroid.timeToImpact === null) {
    return 'miss';
  }
  if (rank < URGENT_COUNT) {
    return 'urgent';
  }
  return asteroid.size === 'giant' || asteroid.size === 'large' ? 'heavy' : 'normal';
}
