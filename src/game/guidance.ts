import { handlingShare } from '../logic/shipModules';
import * as THREE from 'three';
import type { Asteroid } from '../asteroids/asteroidField';
import { LASER_RANGE, closestApproach } from '../logic/ballistics';
import { FLIGHT } from '../logic/flightModel';
import { choosePriority, travelTime, turnCue, type GuidanceChoice } from '../logic/guidance';
import type { Satellite } from '../satellites/satelliteFleet';
import type { ShipController } from '../ship/shipController';

export interface Guidance {
  /** The asteroid to deal with first, and whether the ship can reach it in time. */
  priority: (GuidanceChoice<Asteroid> & { distance: number; cue: string }) | null;
  /** A satellite the ship is about to fly into. */
  satelliteAhead: { satellite: Satellite; seconds: number } | null;
}

const SATELLITE_WARNING = { seconds: 5, clearance: 2.2, range: 90 } as const;

/** Works out the priority target and nearby traffic for the guidance display. */
export function computeGuidance(ship: ShipController, ranked: readonly Asteroid[], satellites: readonly Satellite[]): Guidance {
  const relative = new THREE.Vector3();
  const candidates = ranked
    .filter((asteroid) => asteroid.timeToImpact !== null && !(asteroid.identified && asteroid.assessedDamage === 0))
    .map((asteroid) => {
      relative.copy(asteroid.mesh.position).sub(ship.position);
      const distance = Math.max(0, relative.length() - asteroid.radius);
      const closing = relative.lengthSq() > 0 ? ship.velocity.clone().sub(asteroid.velocity).dot(relative) / relative.length() : 0;
      const reachSeconds = travelTimeTo(distance, closing, ship.thrustMultiplier * handlingShare(ship.massFactor));
      return { item: asteroid, reachSeconds, impactSeconds: asteroid.timeToImpact ?? 0, distance };
    });
  const choice = choosePriority(candidates);
  let priority: Guidance['priority'] = null;
  if (choice) {
    const local = choice.item.mesh.position.clone().sub(ship.position).applyQuaternion(ship.object.quaternion.clone().invert());
    const distance = candidates.find((candidate) => candidate.item === choice.item)?.distance ?? 0;
    priority = { ...choice, distance, cue: turnCue(local.x, local.y, local.z) };
  }
  return { priority, satelliteAhead: findSatelliteAhead(ship, satellites) };
}

function travelTimeTo(distance: number, closingSpeed: number, power: number): number {
  // The ship must get within good laser range. Boost only lasts a few
  // seconds, so plan on a speed between cruise and boost.
  const speed = (FLIGHT.cruiseSpeed + FLIGHT.boostSpeed) / 2;
  return travelTime(distance - LASER_RANGE.optimal, closingSpeed, speed, FLIGHT.thrust * 1.5 * power);
}

function findSatelliteAhead(ship: ShipController, satellites: readonly Satellite[]): Guidance['satelliteAhead'] {
  let soonest: Guidance['satelliteAhead'] = null;
  for (const satellite of satellites) {
    if (!satellite.alive) {
      continue;
    }
    const relativePosition = satellite.position.clone().sub(ship.position);
    if (relativePosition.lengthSq() > SATELLITE_WARNING.range ** 2) {
      continue;
    }
    const relativeVelocity = satellite.velocity.clone().sub(ship.velocity);
    const pass = closestApproach(relativePosition.toArray(), relativeVelocity.toArray());
    if (pass.time <= SATELLITE_WARNING.seconds && pass.distance < satellite.radius + SATELLITE_WARNING.clearance) {
      if (!soonest || pass.time < soonest.seconds) {
        soonest = { satellite, seconds: pass.time };
      }
    }
  }
  return soonest;
}
