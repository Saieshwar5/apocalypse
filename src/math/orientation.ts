import * as THREE from 'three';

const scratchMatrix = new THREE.Matrix4();
const origin = new THREE.Vector3();

/** Rotation that points an object's -Z axis along `forward`, keeping `up` roughly up. */
export function orientationFromForward(
  forward: THREE.Vector3,
  up: THREE.Vector3,
  target = new THREE.Quaternion(),
): THREE.Quaternion {
  // Matrix4.lookAt uses the camera convention: -Z faces from eye to target.
  scratchMatrix.lookAt(origin, forward, up);
  return target.setFromRotationMatrix(scratchMatrix);
}

/** Frame-rate independent smoothing factor for exponential approach. */
export function damping(sharpness: number, deltaSeconds: number): number {
  return 1 - Math.exp(-sharpness * deltaSeconds);
}
