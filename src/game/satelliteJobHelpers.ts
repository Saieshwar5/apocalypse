import type * as THREE from 'three';
import type { Asteroid } from '../asteroids/asteroidField';
import type { PilotId } from '../logic/rivals';
import type { Satellite } from '../satellites/satelliteFleet';

// Geometry and types shared by the satellite contracts and the pilots who work them.

export const KIND_LABEL: Record<Satellite['kind'], string> = { comms: 'COMMS SAT', nav: 'NAV SAT', weather: 'WEATHER SAT' };

/** The asteroid counts as gone once it is this far past the satellite. */
const DODGE_CLEAR_DISTANCE = 14;

/** What a rival needs to know to consider a job. */
export interface OpenJob {
  readonly satellite: Satellite;
  readonly pay: number;
  /** Seconds until the asteroid strikes; Infinity when there is no deadline. */
  readonly deadline: number;
  readonly claimedBy: PilotId | null;
  readonly id: number;
}

/** One line on the contract board. */
export interface JobRow {
  title: string;
  detail: string;
  pay: number;
  urgent: boolean;
}

/** Where the player's current job wants the ship to go next. */
export interface Waypoint {
  world: THREE.Vector3;
  label: string;
}

/** A point well clear of the rock's path, beside the satellite: where to tow it during a dodge. */
export function escapePoint(satellite: Satellite, asteroid: Asteroid): THREE.Vector3 {
  const path = asteroid.velocity.clone().normalize();
  const offset = satellite.position.clone().sub(asteroid.mesh.position);
  const across = offset.addScaledVector(path, -offset.dot(path));
  if (across.lengthSq() < 1e-6) {
    across.copy(satellite.position).normalize();
  }
  return satellite.position.clone().addScaledVector(across.normalize(), 22);
}

/** The rock has been destroyed, or has passed the satellite and is moving away. */
export function asteroidGone(asteroid: Asteroid, satellite: Satellite): boolean {
  if (!asteroid.alive) {
    return true;
  }
  const offset = satellite.position.clone().sub(asteroid.mesh.position);
  const closing = asteroid.velocity.clone().sub(satellite.velocity).dot(offset) > 0;
  return !closing && offset.length() > DODGE_CLEAR_DISTANCE;
}

/** Seconds until the rock reaches the satellite at the current closing speed, or null if it is not closing. */
export function secondsToStrike(asteroid: Asteroid, satellite: Satellite): number | null {
  const offset = satellite.position.clone().sub(asteroid.mesh.position);
  const closing = asteroid.velocity.clone().sub(satellite.velocity).dot(offset.clone().normalize());
  return closing > 0 ? offset.length() / closing : null;
}
