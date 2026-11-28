import * as THREE from 'three';
import type { ShipModel } from '../ship/shipModel';

const scratch = new THREE.Vector3();
const facing = new THREE.Vector3();

/**
 * On the title screen the pilot's ship hangs in front of Earth with its
 * engines lit, drifting gently, so the paint chosen on the licence shows
 * straight away. Placed relative to the camera, to the right of the menu.
 */
export function showShipOnTitle(model: ShipModel, camera: THREE.Camera, elapsed: number): void {
  const group = model.group;
  group.visible = true;
  camera.updateMatrixWorld();
  const bob = Math.sin(elapsed * 0.6) * 0.25;
  group.position.copy(camera.localToWorld(scratch.set(3.4, -0.9 + bob, -8.5)));
  // Nose towards the upper left, three-quarter view, so hull and engines both show.
  facing.set(-1, 0.18, 0.35).normalize().transformDirection(camera.matrixWorld);
  group.up.set(0, 1, 0).transformDirection(camera.matrixWorld);
  group.lookAt(group.position.clone().sub(facing));
  group.up.set(0, 1, 0);
  group.rotateZ(-0.22 + Math.sin(elapsed * 0.4) * 0.05);
  model.setThrottle(0.35, false);
  model.update(elapsed);
}
