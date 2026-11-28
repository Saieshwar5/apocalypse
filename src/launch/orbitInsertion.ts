import * as THREE from 'three';
import type { CameraRig } from '../camera/cameraRig';
import { damping, orientationFromForward } from '../math/orientation';
import { EARTH_RADIUS, latLonToLocalDirection, type Earth } from '../scene/earth';
import { requireNode, type ModelLibrary } from '../scene/modelLibrary';
import { SHIP_SCALE } from '../ship/shipModel';
import type { RocketEffects } from './rocketEffects';

/** Satish Dhawan Space Centre, Sriharikota. */
export const LAUNCH_SITE = latLonToLocalDirection(13.72, 80.23);
export const ORBIT_ALTITUDE = 20;
/**
 * The climb ends with the nose this far below level. From orbit the horizon
 * is about 54 degrees down, so flying level would leave Earth out of view.
 */
export const ORBIT_NOSE_DOWN = THREE.MathUtils.degToRad(38);

/** How far east (radians around the planet) the climb drifts while turning. */
const DOWNRANGE_ANGLE = 0.42;
const START_ALTITUDE = 4.8;
const CUTOFF = 3.6;
const SEPARATION = 4.0;
const SHIP_IGNITION = 4.4;
export const ORBIT_INSERTION_SECONDS = 8;

export type OrbitEvent = 'cutoff' | 'separation' | 'ship-ignition';

export interface OrbitPose {
  position: THREE.Vector3;
  orientation: THREE.Quaternion;
  radial: THREE.Vector3;
  along: THREE.Vector3;
  forward: THREE.Vector3;
}

/**
 * Point on the curving climb from just above the launch site to orbit
 * (progress 0..1). The pad turns with the planet, so this is recomputed.
 */
export function orbitPose(earth: Earth, progress: number, startAltitude = START_ALTITUDE): OrbitPose {
  const up = earth.localToWorldDirection(LAUNCH_SITE);
  const east = new THREE.Vector3().crossVectors(earth.northAxis(), up).normalize();
  const climb = progress * progress * (3 - 2 * progress);
  const angle = DOWNRANGE_ANGLE * (0.35 + 0.65 * progress);
  const radial = up.clone().multiplyScalar(Math.cos(angle)).addScaledVector(east, Math.sin(angle)).normalize();
  const along = east.clone().multiplyScalar(Math.cos(angle)).addScaledVector(up, -Math.sin(angle)).normalize();
  const position = radial.clone().multiplyScalar(EARTH_RADIUS + startAltitude + climb * (ORBIT_ALTITUDE - startAltitude));
  const level = along.clone().multiplyScalar(Math.cos(ORBIT_NOSE_DOWN)).addScaledVector(radial, -Math.sin(ORBIT_NOSE_DOWN));
  // Mostly pitched over already when the camera picks the rocket up in space.
  const forward = radial.clone().lerp(level, 0.45 + 0.55 * Math.pow(progress, 1.2)).normalize();
  const shipUp = new THREE.Vector3().crossVectors(along.clone().cross(radial), forward).normalize();
  const orientation = orientationFromForward(forward, shipUp.lengthSq() > 0 ? shipUp : radial);
  return { position, orientation, radial, along, forward };
}

/**
 * Second half of the launch, in the orbital scene: the booster carries the
 * interceptor out of the atmosphere, cuts off, separates and tumbles away,
 * and the interceptor lights its own engines and pulls ahead.
 */
export class OrbitInsertion {
  elapsed = 0;
  readonly booster: THREE.Object3D;
  private readonly mountHeight: number;
  private readonly boosterVelocity = new THREE.Vector3();
  private readonly boosterSpin = new THREE.Vector3();
  private readonly cameraPosition = new THREE.Vector3();
  private cameraReady = false;
  private fired = new Set<OrbitEvent>();
  private readonly coreFlames: THREE.Object3D[] = [];

  constructor(
    models: ModelLibrary,
    private readonly earth: Earth,
    private readonly ship: THREE.Object3D,
    private readonly cameraRig: CameraRig,
    private readonly effects: RocketEffects,
  ) {
    this.booster = models.booster.clone(true);
    this.booster.scale.setScalar(SHIP_SCALE);
    // Strap-on boosters were dropped during the climb from the pad.
    requireNode(this.booster, 'StrapOn_0').visible = false;
    requireNode(this.booster, 'StrapOn_1').visible = false;
    this.mountHeight = requireNode(this.booster, 'payload_mount').position.y * SHIP_SCALE;
    this.booster.traverse((node) => {
      if (/^core_flame_/.test(node.name)) {
        this.coreFlames.push(node);
        effects.attachFlame(node, 0.6);
      }
    });
    this.booster.visible = false;
  }

  get done(): boolean {
    return this.elapsed >= ORBIT_INSERTION_SECONDS;
  }

  /** Engine output for the interceptor's own plumes (0 before ignition). */
  get shipThrottle(): number {
    return this.elapsed < SHIP_IGNITION ? 0 : 1;
  }

  start(): void {
    this.elapsed = 0;
    this.fired.clear();
    this.cameraReady = false;
    this.booster.visible = true;
    this.effects.setThrust(1, this.coreFlames);
  }

  finish(): void {
    this.booster.visible = false;
    this.effects.setThrust(0, this.coreFlames);
  }

  /** Returns events that happened this frame, for captions and sound. */
  update(deltaSeconds: number): OrbitEvent[] {
    this.elapsed += deltaSeconds;
    const events: OrbitEvent[] = [];
    const fire = (event: OrbitEvent, at: number) => {
      if (this.elapsed >= at && !this.fired.has(event)) {
        this.fired.add(event);
        events.push(event);
      }
    };
    fire('cutoff', CUTOFF);
    fire('separation', SEPARATION);
    fire('ship-ignition', SHIP_IGNITION);
    if (events.includes('cutoff')) {
      this.effects.setThrust(0, this.coreFlames);
    }

    // The ship follows the climb to its final pose; it keeps going after separation.
    const progress = THREE.MathUtils.clamp(this.elapsed / (ORBIT_INSERTION_SECONDS - 0.5), 0, 1);
    const pose = orbitPose(this.earth, progress);
    this.ship.position.copy(pose.position);
    this.ship.quaternion.copy(pose.orientation);
    this.ship.updateMatrixWorld();

    if (this.elapsed < SEPARATION) {
      this.attachBooster(pose);
    } else {
      if (events.includes('separation')) {
        // Push the spent stage back and down, with a slow tumble.
        this.boosterVelocity.copy(pose.forward).multiplyScalar(-0.6).addScaledVector(pose.radial, -0.25);
        this.boosterSpin.set(0.35, 0.1, 0.25);
      }
      this.booster.position.addScaledVector(this.boosterVelocity, deltaSeconds);
      this.booster.rotateX(this.boosterSpin.x * deltaSeconds);
      this.booster.rotateZ(this.boosterSpin.z * deltaSeconds);
    }
    this.updateCamera(deltaSeconds, pose);
    return events;
  }

  /** Booster nose (its +Y) points along the ship's forward, mount at the ship's tail. */
  private attachBooster(pose: OrbitPose): void {
    const tail = new THREE.Vector3(0, 0, 5.9 * SHIP_SCALE).applyQuaternion(pose.orientation).add(pose.position);
    const alignNose = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    this.booster.quaternion.copy(pose.orientation).multiply(alignNose);
    this.booster.position.copy(tail).addScaledVector(pose.forward, -this.mountHeight);
  }

  private updateCamera(deltaSeconds: number, pose: OrbitPose): void {
    // Wide side view of the stack, then swing in behind the ship.
    const side = new THREE.Vector3().crossVectors(pose.radial, pose.along).normalize();
    const wide = pose.position.clone().addScaledVector(side, 15).addScaledVector(pose.forward, -5).addScaledVector(pose.radial, 3.5);
    const chase = new THREE.Vector3(0, 1.3, 4.6).applyQuaternion(pose.orientation).add(pose.position);
    const blend = THREE.MathUtils.smoothstep(this.elapsed, SHIP_IGNITION, ORBIT_INSERTION_SECONDS - 0.6);
    const desired = wide.lerp(chase, blend);
    if (!this.cameraReady) {
      this.cameraPosition.copy(desired);
      this.cameraReady = true;
    }
    this.cameraPosition.lerp(desired, damping(blend > 0 ? 5 : 2.5, deltaSeconds));
    const lookAt = pose.position.clone().addScaledVector(pose.forward, 3 * blend);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(pose.orientation).lerp(pose.radial, 1 - blend).normalize();
    this.cameraRig.place(this.cameraPosition, lookAt, up, deltaSeconds);
  }
}
