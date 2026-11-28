import { placementScore, timeScore, type JobKind } from '../logic/medals';
import type { SatelliteJobKind } from '../logic/satelliteJobs';
import type * as THREE from 'three';
import type { Asteroid } from '../asteroids/asteroidField';
import type { PilotId } from '../logic/rivals';
import type { SoundEffects } from '../audio/soundEffects';
import type { Hud } from '../hud/hud';
import { TOW } from '../logic/towing';
import { formatDistance } from '../logic/units';
import type { Satellite, SatelliteFleet } from '../satellites/satelliteFleet';
import type { TowEvent } from './towLine';

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

/**
 * Tells the player what happened on their tow line. Returns true when the
 * load was released and still needs placing.
 */
export function announceTowEvent(event: TowEvent, hud: Hud, sound: SoundEffects, fleet: SatelliteFleet): boolean {
  const name = KIND_LABEL[event.satellite.kind];
  if (event.type === 'out-of-reach') {
    const tooFar = event.surfaceDistance > TOW.attachRange;
    hud.showMessage(
      tooFar ? `Get within ${formatDistance(TOW.attachRange)} of the ${name} to connect` : 'Match its speed to connect: brake (S) until the gap stops closing',
      'warning',
      2.5,
    );
    return false;
  }
  if (event.type === 'attached') {
    hud.showMessage(`Tow line connected to ${name}. Heavier now: brake early`, 'success', 3);
    sound.dockClamp();
    return false;
  }
  if (event.type === 'snapped' || event.type === 'wrecked') {
    hud.showMessage(event.type === 'snapped' ? 'Tow line snapped: you pulled too hard' : `${name} broke apart under the strain`, 'danger', 3);
    if (event.type === 'wrecked') {
      fleet.destroy(event.satellite);
    }
    return false;
  }
  sound.dockClamp();
  return true;
}

export const JOB_FOR: Record<SatelliteJobKind, JobKind> = { dodge: 'dodge', 'repair-tow': 'tow', reboost: 'reboost' };
/** Posted to finished, flown well. */
const JOB_PAR_SECONDS: Record<SatelliteJobKind, number> = { dodge: 25, 'repair-tow': 150, reboost: 60 };

/** How well a satellite job was done: placing it on its slot, and the time it took. */
export function jobScore(kind: SatelliteJobKind, seconds: number, offsetFromSlot: number | null): number {
  const time = timeScore(seconds, JOB_PAR_SECONDS[kind]);
  return kind === 'dodge' ? time : Math.min(placementScore(offsetFromSlot), 0.6 + 0.4 * time);
}
