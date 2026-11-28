import { formatCountdown, formatDistance, formatSpeed } from './units';

/**
 * Delivering what is on the tow line. Whatever the load (a satellite, a
 * haul rock, an escape pod), the pilot needs the same three facts: what it
 * is, where it goes, and what to do next. This works out the next step.
 */
export type DeliveryState = 'travel' | 'slow' | 'release' | 'hold' | 'safe';

export interface DeliveryInput {
  /** Distance from the load to the centre of the drop zone, and the zone's radius. */
  distance: number;
  radius: number;
  /** The load's speed relative to the destination, and the most it may have on release. */
  speed: number;
  maxSpeed: number;
  /**
   * A dodge has no drop zone: the load is held out of a rock's path until
   * the rock has gone by. Seconds until the rock arrives, or null once it
   * has passed.
   */
  dodge?: { strikeSeconds: number | null };
}

export interface DeliveryStep {
  state: DeliveryState;
  text: string;
}

export function deliveryStep(input: DeliveryInput): DeliveryStep {
  if (input.dodge) {
    return input.dodge.strikeSeconds === null
      ? { state: 'safe', text: 'The rock has passed: hold here' }
      : { state: 'hold', text: `Rock arrives in ${formatCountdown(input.dodge.strikeSeconds)}: keep towing across its path, away from it` };
  }
  if (input.distance > input.radius) {
    return { state: 'travel', text: `${formatDistance(input.distance - input.radius)} to the drop zone` };
  }
  if (input.speed > input.maxSpeed) {
    return { state: 'slow', text: `In the drop zone: slow below ${formatSpeed(input.maxSpeed)} (S). Now ${formatSpeed(input.speed)}` };
  }
  return { state: 'release', text: 'In the drop zone: release now (T)' };
}

/** What the tow card says on its first line. */
export function deliveryTitle(load: string, place: string, condition: number | null): string {
  return `Towing ${load}${condition !== null ? ` (${Math.round(condition)}%)` : ''} → ${place}`;
}
