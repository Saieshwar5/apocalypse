import * as THREE from 'three';
import type { CameraRig } from '../camera/cameraRig';
import { damping, orientationFromForward } from '../math/orientation';
import { EARTH_RADIUS, latLonToLocalDirection, type Earth } from '../scene/earth';

/** Satish Dhawan Space Centre, Sriharikota. */
export const LAUNCH_SITE = latLonToLocalDirection(13.72, 80.23);
export const ORBIT_ALTITUDE = 7;

const COUNTDOWN_SECONDS = 4;
const ASCENT_SECONDS = 9;
const PAD_HEIGHT = 0.45;
/** How far east (radians around the planet) the ascent drifts while turning. */
const DOWNRANGE_ANGLE = 0.42;
/**
 * The climb ends with the nose this far below level. From orbit the horizon
 * is about 54 degrees down, so flying level would leave Earth out of view.
 */
export const ORBIT_NOSE_DOWN = THREE.MathUtils.degToRad(38);

export type LaunchPhase = 'countdown' | 'ascent' | 'complete';

/**
 * Scripted opening: countdown on the pad, then a curving ascent that turns
 * from vertical to horizontal (a gravity turn) until the ship reaches orbit.
 * The pad turns with the planet, so positions are recomputed every frame.
 */
export class LaunchSequence {
  elapsed = 0;
  private readonly cameraPosition = new THREE.Vector3();
  private readonly cameraTarget = new THREE.Vector3();
  private cameraReady = false;

  constructor(
    private readonly earth: Earth,
    private readonly ship: THREE.Object3D,
    private readonly cameraRig: CameraRig,
  ) {}

  get phase(): LaunchPhase {
    if (this.elapsed < COUNTDOWN_SECONDS) {
      return 'countdown';
    }
    return this.elapsed < COUNTDOWN_SECONDS + ASCENT_SECONDS ? 'ascent' : 'complete';
  }

  /** Whole seconds left on the countdown, for the HUD. */
  get countdown(): number {
    return Math.max(0, Math.ceil(COUNTDOWN_SECONDS - this.elapsed));
  }

  /** Engine output 0..1 for the exhaust and sound. */
  get throttle(): number {
    if (this.phase === 'countdown') {
      return this.elapsed > COUNTDOWN_SECONDS - 1.2 ? 0.5 : 0.05;
    }
    return 1;
  }

  start(): void {
    this.elapsed = 0;
    this.cameraReady = false;
  }

  skip(): void {
    this.elapsed = COUNTDOWN_SECONDS + ASCENT_SECONDS;
  }

  update(deltaSeconds: number): void {
    this.elapsed += deltaSeconds;
    const progress = THREE.MathUtils.clamp((this.elapsed - COUNTDOWN_SECONDS) / ASCENT_SECONDS, 0, 1);
    const pose = this.poseAt(progress);
    this.ship.position.copy(pose.position);
    this.ship.quaternion.copy(pose.orientation);
    this.updateCamera(deltaSeconds, pose, progress);
  }

  /** Where the ship ends up, used to hand over to the flight controller. */
  finalPose(): { position: THREE.Vector3; orientation: THREE.Quaternion } {
    return this.poseAt(1);
  }

  private poseAt(progress: number): { position: THREE.Vector3; orientation: THREE.Quaternion; up: THREE.Vector3; east: THREE.Vector3 } {
    const up = this.earth.localToWorldDirection(LAUNCH_SITE);
    const east = new THREE.Vector3().crossVectors(this.earth.northAxis(), up).normalize();
    // Ease in: slow off the pad, then accelerating.
    const climb = progress * progress * (3 - 2 * progress);
    const turn = Math.pow(progress, 1.4);
    const angle = DOWNRANGE_ANGLE * progress * progress;

    const radial = up.clone().multiplyScalar(Math.cos(angle)).addScaledVector(east, Math.sin(angle)).normalize();
    const along = east.clone().multiplyScalar(Math.cos(angle)).addScaledVector(up, -Math.sin(angle)).normalize();
    const altitude = PAD_HEIGHT + climb * (ORBIT_ALTITUDE - PAD_HEIGHT);
    const position = radial.clone().multiplyScalar(EARTH_RADIUS + altitude);

    const level = along.clone().multiplyScalar(Math.cos(ORBIT_NOSE_DOWN)).addScaledVector(radial, -Math.sin(ORBIT_NOSE_DOWN));
    const forward = radial.clone().lerp(level, turn).normalize();
    // While vertical, the ship's belly faces east; once level, it faces Earth.
    const shipUp = new THREE.Vector3().crossVectors(along.clone().cross(radial), forward).normalize();
    const orientation = orientationFromForward(forward, shipUp.lengthSq() > 0 ? shipUp : radial);
    return { position, orientation, up: radial, east: along };
  }

  private updateCamera(
    deltaSeconds: number,
    pose: { position: THREE.Vector3; up: THREE.Vector3; east: THREE.Vector3 },
    progress: number,
  ): void {
    // Start beside the pad looking at the ship, then fall in behind it.
    const side = new THREE.Vector3().crossVectors(pose.up, pose.east).normalize();
    const padView = pose.position
      .clone()
      .addScaledVector(pose.east, 1.8)
      .addScaledVector(side, 1.4)
      .addScaledVector(pose.up, 0.35 - progress * 0.2);
    const chaseView = pose.position
      .clone()
      .addScaledVector(pose.up, -2.6 * (1 - progress) + 1.2 * progress)
      .addScaledVector(pose.east, -3.6 * progress)
      .addScaledVector(side, 1.2 * (1 - progress));
    const desired = padView.lerp(chaseView, THREE.MathUtils.smoothstep(progress, 0, 0.35));

    if (!this.cameraReady) {
      this.cameraPosition.copy(desired);
      this.cameraTarget.copy(pose.position);
      this.cameraReady = true;
    } else {
      this.cameraPosition.lerp(desired, damping(3, deltaSeconds));
      this.cameraTarget.lerp(pose.position, damping(8, deltaSeconds));
    }
    // Keep the camera above the ground.
    if (this.cameraPosition.length() < EARTH_RADIUS + 0.15) {
      this.cameraPosition.setLength(EARTH_RADIUS + 0.15);
    }
    this.cameraRig.place(this.cameraPosition, this.cameraTarget, pose.up, deltaSeconds);
  }
}
