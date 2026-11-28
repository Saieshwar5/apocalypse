/**
 * The planet's radius in world units. The ship is about 2 units long, so the
 * planet is large enough to fill the sky from a low orbit.
 */
export const PLANET_RADIUS = 60;

/** One world unit is about 106 km. */
export const KM_PER_UNIT = 6371 / PLANET_RADIUS;

/**
 * The game compresses time: a wave lasts about a minute instead of days.
 * Speeds are divided by this factor when shown, so an asteroid moving
 * 6 units per second reads as about 23 km/s, a realistic impact speed.
 */
export const TIME_COMPRESSION = 28;

export function unitsToKm(units: number): number {
  return units * KM_PER_UNIT;
}

export function speedToKmPerSecond(unitsPerSecond: number): number {
  return (unitsPerSecond * KM_PER_UNIT) / TIME_COMPRESSION;
}

/** "48,000 km", "6,400 km" or "640 km": precision drops with distance. */
export function formatDistance(units: number): string {
  const km = unitsToKm(Math.max(0, units));
  const step = km >= 10000 ? 1000 : km >= 1000 ? 100 : 10;
  return `${(Math.round(km / step) * step).toLocaleString('en-US')} km`;
}

export function formatSpeed(unitsPerSecond: number): string {
  const kmPerSecond = speedToKmPerSecond(Math.abs(unitsPerSecond));
  return `${kmPerSecond < 10 ? kmPerSecond.toFixed(1) : Math.round(kmPerSecond)} km/s`;
}

/** "0:07", "1:23". */
export function formatCountdown(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, '0')}`;
}
