import * as THREE from 'three';
import type { InputState } from '../input/inputState';

export interface PhotoModeDependencies {
  camera: THREE.PerspectiveCamera;
  input: InputState;
  /** What the camera circles: the ship. */
  subject: () => THREE.Object3D;
  /** Hides or shows the HUD, the target overlay and the cockpit. */
  setInterface: (visible: boolean) => void;
  /** Fires the shutter; returns the line to show. */
  shutter: (camera: THREE.PerspectiveCamera) => string;
}

const FILTERS = ['none', 'cinematic', 'warm', 'mono'] as const;
type Filter = (typeof FILTERS)[number];
const FILTER_LABEL: Record<Filter, string> = { none: 'Natural', cinematic: 'Cinematic', warm: 'Golden hour', mono: 'Monochrome' };

/**
 * Photo mode (P): the action freezes, the interface disappears and the
 * camera floats free around the ship. The mouse orbits, W and S move in and
 * out, 1-4 choose a look, Space takes the picture.
 */
export class PhotoMode {
  active = false;
  private readonly spherical = new THREE.Spherical(7, Math.PI / 2.4, 0.6);
  private readonly saved = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), fov: 62 };
  private readonly panel = document.querySelector<HTMLElement>('#photo-mode');
  private readonly status = document.querySelector<HTMLElement>('#photo-status');
  private readonly flash = document.querySelector<HTMLElement>('#photo-flash');

  constructor(private readonly deps: PhotoModeDependencies) {}

  toggle(): void {
    this.active ? this.exit() : this.enter();
  }

  enter(): void {
    const { camera } = this.deps;
    this.active = true;
    this.saved.position.copy(camera.position);
    this.saved.quaternion.copy(camera.quaternion);
    this.saved.fov = camera.fov;
    this.deps.setInterface(false);
    this.setFilter('none');
    this.say('Photo mode · mouse orbits · W/S closer or further · 1-4 looks · Space takes the picture · P returns');
    if (this.panel) {
      this.panel.hidden = false;
    }
  }

  exit(): void {
    const { camera } = this.deps;
    this.active = false;
    camera.position.copy(this.saved.position);
    camera.quaternion.copy(this.saved.quaternion);
    camera.fov = this.saved.fov;
    camera.updateProjectionMatrix();
    this.setFilter('none');
    this.deps.setInterface(true);
    if (this.panel) {
      this.panel.hidden = true;
    }
  }

  update(deltaSeconds: number): void {
    const { input, camera } = this.deps;
    const look = input.consumeLook();
    this.spherical.theta -= look.x * 0.004;
    this.spherical.phi = THREE.MathUtils.clamp(this.spherical.phi - look.y * 0.004, 0.15, Math.PI - 0.15);
    if (input.isDown('ArrowLeft')) this.spherical.theta += deltaSeconds * 0.9;
    if (input.isDown('ArrowRight')) this.spherical.theta -= deltaSeconds * 0.9;
    if (input.isDown('KeyW')) this.spherical.radius = Math.max(2.5, this.spherical.radius - deltaSeconds * 6);
    if (input.isDown('KeyS')) this.spherical.radius = Math.min(60, this.spherical.radius + deltaSeconds * 10);
    FILTERS.forEach((filter, index) => {
      if (input.consumePress(`Digit${index + 1}`)) {
        this.setFilter(filter);
        this.say(`Look: ${FILTER_LABEL[filter]}`);
      }
    });
    if (input.consumePress('Space')) {
      this.say(this.deps.shutter(camera));
      this.flashOnce();
    }
    const subject = this.deps.subject();
    // Orbit in the ship's own frame, so "above" is above the ship.
    const offset = new THREE.Vector3().setFromSpherical(this.spherical).applyQuaternion(subject.quaternion);
    camera.position.copy(subject.position).add(offset);
    camera.up.set(0, 1, 0).applyQuaternion(subject.quaternion);
    camera.lookAt(subject.position);
  }

  private setFilter(filter: Filter): void {
    document.body.dataset.photoFilter = filter === 'none' ? '' : filter;
  }

  private say(text: string): void {
    if (this.status) {
      this.status.textContent = text;
    }
  }

  private flashOnce(): void {
    if (!this.flash) {
      return;
    }
    this.flash.classList.remove('photo-flash-on');
    void this.flash.offsetWidth;
    this.flash.classList.add('photo-flash-on');
  }
}
