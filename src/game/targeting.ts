import * as THREE from 'three';
import type { Asteroid } from '../asteroids/asteroidField';
import { closestApproach, laserRangeBand, leadOffset, type RangeBand } from '../logic/ballistics';
import { MISSILE_BLAST } from '../logic/shipDefense';
import type { ShipController } from '../ship/shipController';
import { BOLT_SPEED } from '../weapons/laserCannon';

/** Warn about rocks whose path will pass this close within this time. */
const COLLISION_WARNING = { seconds: 4, clearance: 1.2 } as const;

export interface CollisionThreat {
  asteroid: Asteroid;
  seconds: number;
}

export interface TargetingInfo {
  target: Asteroid | null;
  /** Distance from the ship to the target's surface. */
  distance: number;
  rangeBand: RangeBand;
  /** World point to aim at so laser bolts meet the moving target. */
  lead: THREE.Vector3 | null;
  /** The nose points close enough to the lead point for bolts to connect. */
  onTarget: boolean;
  /** A missile fired now would catch the ship in its own blast. */
  dangerClose: boolean;
  collision: CollisionThreat | null;
}

/** Everything the reticle needs to know about the current target and nearby dangers. */
export function computeTargeting(
  ship: ShipController,
  target: Asteroid | null,
  asteroids: readonly Asteroid[],
): TargetingInfo {
  const info: TargetingInfo = {
    target,
    distance: Infinity,
    rangeBand: 'out-of-range',
    lead: null,
    onTarget: false,
    dangerClose: false,
    collision: findCollisionThreat(ship, asteroids),
  };
  if (!target) {
    return info;
  }
  const relativePosition = target.mesh.position.clone().sub(ship.position);
  const relativeVelocity = target.velocity.clone().sub(ship.velocity);
  info.distance = Math.max(0, relativePosition.length() - target.radius);
  info.rangeBand = laserRangeBand(info.distance);
  // The warhead detonates at the target's surface, so the ship is inside the
  // blast when the surface is closer than the blast radius.
  info.dangerClose = info.distance < MISSILE_BLAST.radius;

  const offset = leadOffset(relativePosition.toArray(), relativeVelocity.toArray(), BOLT_SPEED);
  if (offset) {
    const leadVector = new THREE.Vector3(...offset);
    info.lead = leadVector.clone().add(ship.position);
    const allowance = Math.atan2(target.radius * 0.9, Math.max(leadVector.length(), 0.01));
    info.onTarget = ship.forward().angleTo(leadVector) < allowance;
  }
  return info;
}

function findCollisionThreat(ship: ShipController, asteroids: readonly Asteroid[]): CollisionThreat | null {
  let soonest: CollisionThreat | null = null;
  for (const asteroid of asteroids) {
    const relativePosition = asteroid.mesh.position.clone().sub(ship.position);
    if (relativePosition.lengthSq() > 120 * 120) {
      continue;
    }
    const relativeVelocity = asteroid.velocity.clone().sub(ship.velocity);
    const pass = closestApproach(relativePosition.toArray(), relativeVelocity.toArray());
    if (pass.time <= COLLISION_WARNING.seconds && pass.distance < asteroid.radius + COLLISION_WARNING.clearance) {
      if (!soonest || pass.time < soonest.seconds) {
        soonest = { asteroid, seconds: pass.time };
      }
    }
  }
  return soonest;
}
