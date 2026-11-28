import * as THREE from 'three';
import type { CameraRig } from '../camera/cameraRig';
import { orientationFromForward } from '../math/orientation';
import { EARTH_RADIUS } from '../scene/earth';
import type { ShipController } from '../ship/shipController';
import type { MissileLauncher } from '../weapons/missileLauncher';

/** A replacement ship is delivered this far from Aegis, matching its orbit. */
const DELIVERY_OFFSET = 10;
/** Without Aegis, it is placed on a low orbit above where the old one was lost. */
const FALLBACK_ALTITUDE = 20;

/**
 * Puts a replacement ship in orbit after a loss: beside Aegis and moving
 * with it when the station stands, otherwise on a low orbit, fully fuelled
 * and armed, facing the station or along the orbit.
 */
export function deliverReplacementShip(
  ship: ShipController,
  missiles: MissileLauncher,
  cameraRig: CameraRig,
  station: { position: THREE.Vector3; velocity: THREE.Vector3 } | null,
): void {
  const lastPosition = ship.position.clone();
  let position: THREE.Vector3;
  let velocity: THREE.Vector3;
  let facing: THREE.Vector3;
  if (station) {
    const outward = station.position.clone().normalize();
    position = station.position.clone().addScaledVector(outward, DELIVERY_OFFSET);
    velocity = station.velocity.clone();
    facing = station.position.clone().sub(position).normalize();
  } else {
    position = lastPosition.lengthSq() > 0 ? lastPosition.clone().setLength(EARTH_RADIUS + FALLBACK_ALTITUDE) : new THREE.Vector3(0, EARTH_RADIUS + FALLBACK_ALTITUDE, 0);
    const along = new THREE.Vector3(0, 1, 0).cross(position).normalize();
    velocity = new THREE.Vector3();
    facing = along.lengthSq() > 0 ? along : new THREE.Vector3(1, 0, 0);
  }
  ship.reset(position, orientationFromForward(facing, position.clone().normalize()), 0);
  ship.velocity.copy(velocity);
  missiles.reset();
  cameraRig.snap();
}
