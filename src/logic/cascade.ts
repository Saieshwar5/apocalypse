import type { AsteroidSize, WeaponKind } from './asteroidClasses';
import { ATMOSPHERE } from './atmosphere';
import { PLANET_RADIUS } from './units';
import type { CircularOrbit } from './satellites';
import { orbitalPeriod } from './satellites';
import type { Vec3Tuple } from './random';

/**
 * The Cascade. Debris in orbit hits satellites, and every broken satellite
 * adds more debris; past a tipping point (the Singularity) fragments collide
 * with each other and the debris multiplies by itself until orbit is closed.
 * Orbit Health measures how far from that point orbit is: 100 is clean, 0
 * means the cascade has won.
 *
 * Masses are in tonnes.
 */
export const CASCADE = {
  /** Health lost per tonne of debris in orbit. */
  healthPerTonne: 0.48,
  /** Below this health, debris starts to multiply by itself. */
  tippingHealth: 35,
  /** Growth rate per second at zero health, as a share of each cloud's mass. */
  maxGrowthPerSecond: 0.004,
  /** What a satellite leaves behind. */
  satelliteWreck: 12,
  /** Shattering a rock inside the orbital band leaves this much debris. */
  shatter: { small: 2, medium: 5, large: 10, giant: 20 } satisfies Record<AsteroidSize, number>,
  /** A missile's blast vaporises most of a rock: this share is left. */
  missileShare: 0.4,
  /** Fragments made beyond this distance from the planet's centre fly off and never come back. */
  bandOuterRadius: 216,
  /** Fragments made this low fall into the atmosphere and burn up. */
  bandInnerAltitude: ATMOSPHERE.top + 2,
  /** Drag: share of a cloud's mass lost per second, at the surface and its fall-off height. */
  dragAtSurface: 0.012,
  dragScaleHeight: 18,
} as const;

/** The orbit clean-up job: sweeping debris with the ship's net. */
export const SWEEP = {
  /** The net only works at gentle speeds relative to the debris. */
  maxRelativeSpeed: 6,
  tonnesPerSecond: 1.2,
  /** Paid by the Orbital Safety Fund per tonne swept. */
  payPerTonne: 25,
} as const;

/** Debris left by destroying a rock, in tonnes. Deflected rocks leave none. */
export function shatterDebris(size: AsteroidSize, weapon: WeaponKind, distanceFromCentre: number, planetRadius = PLANET_RADIUS): number {
  const altitude = distanceFromCentre - planetRadius;
  if (distanceFromCentre > CASCADE.bandOuterRadius || altitude < CASCADE.bandInnerAltitude) {
    return 0;
  }
  return CASCADE.shatter[size] * (weapon === 'missile' ? CASCADE.missileShare : 1);
}

export function orbitHealth(totalDebris: number): number {
  return Math.max(0, Math.min(100, 100 - totalDebris * CASCADE.healthPerTonne));
}

/** Share of mass a cloud loses to drag per second at `altitude`. */
export function dragRate(altitude: number): number {
  return CASCADE.dragAtSurface * Math.exp(-Math.max(0, altitude) / CASCADE.dragScaleHeight);
}

/** Share of mass a cloud gains per second from fragments colliding, once past the tipping point. */
export function growthRate(health: number): number {
  if (health >= CASCADE.tippingHealth) {
    return 0;
  }
  return (CASCADE.maxGrowthPerSecond * (CASCADE.tippingHealth - health)) / CASCADE.tippingHealth;
}

/** A cloud's mass after one step of drag and (past the tipping point) growth. */
export function stepCloudMass(mass: number, altitude: number, health: number, deltaSeconds: number): number {
  return mass * Math.exp((growthRate(health) - dragRate(altitude)) * deltaSeconds);
}

/**
 * Chance per second that a satellite inside a cloud is struck and broken.
 * Thicker clouds are deadlier.
 */
export function strikeChancePerSecond(cloudMass: number): number {
  return Math.min(0.5, cloudMass * 0.015);
}

/**
 * Damage multiplier for a ship flying through debris: almost harmless at a
 * crawl, punishing at speed.
 */
export function debrisDamageScale(relativeSpeed: number): number {
  if (relativeSpeed <= SWEEP.maxRelativeSpeed) {
    return 0.1;
  }
  return Math.min(1.5, 0.3 + (relativeSpeed - SWEEP.maxRelativeSpeed) / 12);
}

/** Tonnes the net collects this step, never more than the cloud holds. */
/** `rate` and `speedLimit` multiply the net's intake and its top speed (a sweeper net module). */
export function sweptTonnes(relativeSpeed: number, cloudMass: number, deltaSeconds: number, rate = 1, speedLimit = 1): number {
  if (relativeSpeed > SWEEP.maxRelativeSpeed * speedLimit) {
    return 0;
  }
  return Math.min(cloudMass, SWEEP.tonnesPerSecond * rate * deltaSeconds);
}

/** Hazard radius of a cloud: thicker clouds spread wider. */
export function cloudRadius(mass: number): number {
  return 1 + Math.sqrt(Math.max(0, mass)) * 0.45;
}

/**
 * The circular orbit that passes through `position`, moving the way
 * `velocity` points (only its direction across the radius matters). Debris
 * from a rock shattered in orbit settles onto such an orbit.
 */
export function orbitThrough(position: Vec3Tuple, velocity: Vec3Tuple): CircularOrbit {
  const radius = Math.hypot(...position);
  let normal = cross(position, velocity);
  if (Math.hypot(...normal) < 1e-9 * radius) {
    // Moving straight up or down: any plane through the point will do.
    normal = cross(position, Math.abs(position[1]) < radius * 0.9 ? [0, 1, 0] : [1, 0, 0]);
  }
  const length = Math.hypot(...normal);
  const h: Vec3Tuple = [normal[0] / length, normal[1] / length, normal[2] / length];
  // orbitState's plane has normal (-sin N sin T, -cos T, cos N sin T).
  const inclination = Math.acos(Math.max(-1, Math.min(1, -h[1])));
  const sinT = Math.sin(inclination);
  const ascendingNode = sinT < 1e-6 ? 0 : Math.atan2(-h[0] / sinT, h[2] / sinT);
  const node: Vec3Tuple = [Math.cos(ascendingNode), 0, Math.sin(ascendingNode)];
  const quarter: Vec3Tuple = [-Math.sin(ascendingNode) * Math.cos(inclination), Math.sin(inclination), Math.cos(ascendingNode) * Math.cos(inclination)];
  const phase = Math.atan2(dot(position, quarter), dot(position, node));
  return { radius, period: orbitalPeriod(radius), inclination, ascendingNode, phase };
}

function cross(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec3Tuple, b: Vec3Tuple): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
