import * as THREE from 'three';
import { damping } from '../math/orientation';

export type CameraView = 'chase' | 'cockpit';

const CHASE_OFFSET = new THREE.Vector3(0, 0.75, 3.4);
const COCKPIT_OFFSET = new THREE.Vector3(0, 0.17, -0.3);
const FIELD_OF_VIEW: Record<CameraView, number> = { chase: 62, cockpit: 74 };

/**
 * Third-person chase camera and cockpit camera. The chase view lags slightly
 * behind the ship so turns and boosts are felt; the cockpit view is rigid.
 * Shake decays over time and is added after smoothing.
 */
export class CameraRig {
  view: CameraView = 'chase';
  private shake = 0;
  private readonly smoothPosition = new THREE.Vector3();
  private readonly smoothRotation = new THREE.Quaternion();
  private readonly scratch = new THREE.Vector3();
  private initialised = false;

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  toggleView(): CameraView {
    this.view = this.view === 'chase' ? 'cockpit' : 'chase';
    return this.view;
  }

  addShake(amount: number): void {
    this.shake = Math.min(1.5, this.shake + amount);
  }

  /** Jump to the target without smoothing, for example after a respawn. */
  snap(): void {
    this.initialised = false;
  }

  follow(target: THREE.Object3D, deltaSeconds: number, boosting: boolean): void {
    const offset = this.view === 'chase' ? CHASE_OFFSET : COCKPIT_OFFSET;
    const desired = this.scratch.copy(offset);
    if (this.view === 'chase' && boosting) {
      desired.z += 0.9;
    }
    desired.applyQuaternion(target.quaternion).add(target.position);

    if (!this.initialised || this.view === 'cockpit') {
      this.smoothPosition.copy(desired);
      this.smoothRotation.copy(target.quaternion);
      this.initialised = true;
    } else {
      this.smoothPosition.lerp(desired, damping(9, deltaSeconds));
      this.smoothRotation.slerp(target.quaternion, damping(7, deltaSeconds));
    }

    this.camera.position.copy(this.smoothPosition);
    this.camera.quaternion.copy(this.smoothRotation);
    this.applyFieldOfView(deltaSeconds, boosting);
    this.applyShake(deltaSeconds);
  }

  /** Free placement used by the launch sequence and menu. */
  place(position: THREE.Vector3, lookAt: THREE.Vector3, up: THREE.Vector3, deltaSeconds: number): void {
    this.camera.position.copy(position);
    this.camera.up.copy(up);
    this.camera.lookAt(lookAt);
    this.applyShake(deltaSeconds);
    this.initialised = false;
  }

  private applyFieldOfView(deltaSeconds: number, boosting: boolean): void {
    const target = FIELD_OF_VIEW[this.view] + (boosting ? 8 : 0);
    const next = THREE.MathUtils.lerp(this.camera.fov, target, damping(4, deltaSeconds));
    if (Math.abs(next - this.camera.fov) > 0.01) {
      this.camera.fov = next;
      this.camera.updateProjectionMatrix();
    }
  }

  private applyShake(deltaSeconds: number): void {
    if (this.shake <= 0.001) {
      this.shake = 0;
      return;
    }
    const strength = this.shake * this.shake * 0.12;
    this.camera.position.x += (Math.random() - 0.5) * strength;
    this.camera.position.y += (Math.random() - 0.5) * strength;
    this.camera.position.z += (Math.random() - 0.5) * strength;
    this.camera.rotateZ((Math.random() - 0.5) * strength * 0.2);
    this.shake = Math.max(0, this.shake - deltaSeconds * 1.4);
  }
}
