import * as THREE from 'three';

const direction = new THREE.Vector3();
const toCentre = new THREE.Vector3();

/**
 * First point where the segment start→end enters a sphere, or null. Testing
 * the swept segment instead of the end point stops fast bolts tunnelling
 * through small asteroids between frames.
 */
export function segmentHitsSphere(
  start: THREE.Vector3,
  end: THREE.Vector3,
  centre: THREE.Vector3,
  radius: number,
): THREE.Vector3 | null {
  direction.subVectors(end, start);
  const length = direction.length();
  if (length === 0) {
    return start.distanceTo(centre) <= radius ? start.clone() : null;
  }
  direction.divideScalar(length);
  toCentre.subVectors(start, centre);
  const b = toCentre.dot(direction);
  const c = toCentre.lengthSq() - radius * radius;
  if (c <= 0) {
    return start.clone();
  }
  const discriminant = b * b - c;
  if (discriminant < 0) {
    return null;
  }
  const distance = -b - Math.sqrt(discriminant);
  if (distance < 0 || distance > length) {
    return null;
  }
  return start.clone().addScaledVector(direction, distance);
}
