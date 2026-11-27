import type { ColorRamp } from './puffParticles';

/*
 * Stops are [time, r, g, b, alpha], premultiplied (see ColorRamp). Values
 * above 1 bloom. Fire keeps some alpha even while it glows: overlapping
 * puffs then cover each other instead of adding up to a white screen.
 */

/** White-yellow gas that cools through orange and red into dark smoke. */
export const FIREBALL: ColorRamp = [
  0, 2.3, 1.9, 1.1, 0.6,
  0.1, 2.1, 1.2, 0.38, 0.6,
  0.26, 1.7, 0.56, 0.1, 0.6,
  0.45, 0.55, 0.13, 0.03, 0.58,
  0.65, 0.028, 0.023, 0.02, 0.4,
  1, 0, 0, 0, 0,
];

/** The instant of detonation: pure light, gone in a few frames. */
export const CORE_FLASH: ColorRamp = [
  0, 5, 4.4, 3.2, 0,
  0.4, 1.8, 1.2, 0.5, 0,
  1, 0, 0, 0, 0,
];

/** Warm light that lingers on while the fireball burns. */
export const AFTERGLOW: ColorRamp = [
  0, 0.7, 0.35, 0.12, 0,
  0.4, 0.3, 0.1, 0.025, 0,
  1, 0, 0, 0, 0,
];

export const SPARK: ColorRamp = [
  0, 6, 4.2, 2.2, 0,
  0.3, 4.2, 1.7, 0.4, 0,
  0.75, 1.5, 0.32, 0.05, 0,
  1, 0, 0, 0, 0,
];

/** Pulverised rock: fades in behind the fire and hangs around. */
export const DUST: ColorRamp = [
  0, 0, 0, 0, 0,
  0.12, 0.014, 0.012, 0.01, 0.16,
  0.5, 0.009, 0.0078, 0.0065, 0.1,
  1, 0, 0, 0, 0,
];

/** Opaque grit knocked off by a hit; visible at once, short-lived. */
export const GRIT: ColorRamp = [
  0, 0.2, 0.18, 0.155, 0.5,
  0.6, 0.1, 0.09, 0.078, 0.3,
  1, 0, 0, 0, 0,
];

export const ICE_FLASH: ColorRamp = [
  0, 2.6, 3.8, 5, 0,
  0.4, 0.8, 1.3, 1.9, 0,
  1, 0, 0, 0, 0,
];

/** Sublimating vapour: bright for a moment, then a thin pale haze. */
export const ICE_MIST: ColorRamp = [
  0, 0.5, 0.72, 1.0, 0.1,
  0.15, 0.1, 0.135, 0.17, 0.13,
  0.55, 0.04, 0.054, 0.068, 0.08,
  1, 0, 0, 0, 0,
];

/** Ice crystals; used with `twinkle` so they flash on and off. */
export const ICE_GLITTER: ColorRamp = [
  0, 3.0, 4.4, 6.0, 0,
  0.7, 2.2, 3.4, 4.8, 0,
  1, 0, 0, 0, 0,
];

/** Fire seen through the atmosphere: redder, and it lasts. */
export const IMPACT_FLASH: ColorRamp = [
  0, 4.5, 2.4, 1.0, 0,
  0.25, 2.6, 1.05, 0.32, 0,
  1, 0, 0, 0, 0,
];
