import * as THREE from 'three';
import type { SoundEffects } from '../audio/soundEffects';
import type { CameraRig } from '../camera/cameraRig';
import { damping } from '../math/orientation';
import type { GroundScene } from './groundScene';
import type { OrbitInsertion } from './orbitInsertion';
import type { RocketEffects } from './rocketEffects';

/** Ground timeline, in seconds from the start of the cinematic. */
const ARMS_START = 1.6;
const ARMS_END = 4.4;
const IGNITION = 5.0;
const LIFTOFF = 7.0;
const STRAP_SEPARATION = 14.2;
const FADE_START = 17.2;
const GROUND_END = 18.0;

const CAPTIONS: [number, string][] = [
  [0.2, 'Launch control: T minus 7. All systems go.'],
  [ARMS_START, 'Swing arms retracting.'],
  [IGNITION, 'Main engine ignition.'],
  [LIFTOFF, 'Liftoff. Interceptor PDW-01 is on its way.'],
  [11, 'Throttle up. Passing through max Q.'],
  [STRAP_SEPARATION, 'Strap-on boosters separated.'],
];

export interface CinematicPresentation {
  caption(text: string): void;
  fade(opacity: number): void;
  useScene(scene: 'ground' | 'orbit'): void;
}

/**
 * The launch: about 18 seconds at the pad in real scale (countdown, swing
 * arms, ignition, liftoff, strap-on separation) and 8 seconds in orbit
 * (cut-off, booster separation, ship ignition). Skippable at any time.
 */
export class LaunchCinematic {
  phase: 'ground' | 'orbit' | 'done' = 'done';
  private elapsed = 0;
  private captionIndex = 0;
  private readonly cameraPosition = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly strapVelocity: THREE.Vector3[] = [];
  private shot = -1;
  private ignited = false;
  private liftedOff = false;
  private strapsDropped = false;

  constructor(
    private readonly ground: GroundScene,
    private readonly effects: RocketEffects,
    private readonly orbit: OrbitInsertion,
    private readonly cameraRig: CameraRig,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly sound: SoundEffects,
    private readonly presentation: CinematicPresentation,
  ) {
    for (const flame of ground.stack.coreFlames) {
      effects.attachFlame(flame, 0.6);
    }
    for (const flame of ground.stack.strapFlames) {
      effects.attachFlame(flame, 0.42);
    }
    // Remember starting placements so a second launch can reset them.
    for (const node of [...ground.swingArms, ...ground.stack.strapOns]) {
      node.userData.home = { position: node.position.clone(), quaternion: node.quaternion.clone() };
    }
    ground.scene.add(effects.group);
  }

  get done(): boolean {
    return this.phase === 'done';
  }

  start(): void {
    const { stack } = this.ground;
    this.phase = 'ground';
    this.elapsed = 0;
    this.captionIndex = 0;
    this.shot = -1;
    this.ignited = false;
    this.liftedOff = false;
    this.strapsDropped = false;
    stack.rocket.position.copy(this.ground.rocketBase);
    stack.rocket.visible = true;
    for (const node of [...this.ground.swingArms, ...stack.strapOns]) {
      const home = node.userData.home as { position: THREE.Vector3; quaternion: THREE.Quaternion };
      node.position.copy(home.position);
      node.quaternion.copy(home.quaternion);
    }
    for (const strap of stack.strapOns) {
      // Put the strap-ons back on the booster after a previous launch.
      stack.booster.add(strap);
    }
    this.effects.clear();
    this.ground.setAltitude(0);
    this.presentation.useScene('ground');
    this.presentation.fade(0);
    this.camera.fov = 50;
    this.camera.updateProjectionMatrix();
  }

  skip(): void {
    this.finish();
  }

  update(deltaSeconds: number): void {
    if (this.phase === 'ground') {
      this.updateGround(deltaSeconds);
    } else if (this.phase === 'orbit') {
      this.updateOrbit(deltaSeconds);
    }
  }

  private updateGround(deltaSeconds: number): void {
    this.elapsed += deltaSeconds;
    const t = this.elapsed;
    const { stack } = this.ground;
    this.showCaptions(t);

    // Swing arms pull back towards the tower and turn away from the rocket.
    const arms = THREE.MathUtils.smoothstep(t, ARMS_START, ARMS_END);
    this.ground.swingArms.forEach((arm, index) => {
      const home = arm.userData.home as { position: THREE.Vector3 };
      arm.position.x = home.position.x - arms * 3.2;
      arm.rotation.y = arms * (0.7 + index * 0.12);
    });

    if (!this.ignited && t >= IGNITION) {
      this.ignited = true;
      this.effects.steamBurst(this.ground.rocketBase, 50);
      this.sound.explosion(0.7);
    }
    if (!this.liftedOff && t >= LIFTOFF) {
      this.liftedOff = true;
      this.effects.steamBurst(this.ground.rocketBase, 35);
      this.sound.planetImpact(0.4);
    }
    const thrust = t < IGNITION ? 0 : t < LIFTOFF ? 0.35 + 0.4 * ((t - IGNITION) / (LIFTOFF - IGNITION)) : 1;
    this.effects.setThrust(thrust, stack.coreFlames);
    this.effects.setThrust(this.strapsDropped ? 0 : thrust, stack.strapFlames);
    this.sound.setEngine(thrust, thrust > 0.9);

    const flight = Math.max(0, t - LIFTOFF);
    const height = 1.6 * flight * flight + 0.35 * flight * flight * flight;
    stack.rocket.position.copy(this.ground.rocketBase).add(new THREE.Vector3(0, height, 0));
    this.ground.setAltitude(height / 1800);

    if (!this.strapsDropped && t >= STRAP_SEPARATION) {
      this.dropStrapOns();
    }
    this.updateFallingStraps(deltaSeconds);
    this.effects.update(deltaSeconds, 0, true);
    this.updateGroundCamera(deltaSeconds, t, thrust, height);

    if (t >= FADE_START) {
      this.presentation.fade(THREE.MathUtils.smoothstep(t, FADE_START, GROUND_END));
    }
    if (t >= GROUND_END) {
      this.beginOrbit();
    }
  }

  private updateGroundCamera(deltaSeconds: number, t: number, thrust: number, height: number): void {
    const base = this.ground.rocketBase;
    const rocket = this.ground.stack.rocket.position;
    const shot = t < IGNITION ? 0 : t < 10.5 ? 1 : t < STRAP_SEPARATION ? 2 : 3;
    let position: THREE.Vector3;
    let target: THREE.Vector3;
    let fov = 50;
    if (shot === 0) {
      // Wide sunrise view of the pad, drifting slowly.
      position = base.clone().add(new THREE.Vector3(72 - t * 1.6, 9 + t * 0.3, -70 + t * 1.2));
      target = base.clone().add(new THREE.Vector3(0, 20, 0));
    } else if (shot === 1) {
      // Low and close at the base: flames, steam and the first metres of flight.
      position = base.clone().add(new THREE.Vector3(48, 3, -44));
      target = rocket.clone().add(new THREE.Vector3(0, 10 + Math.min(height, 40) * 0.4, 0));
      fov = 58;
    } else if (shot === 2) {
      // Tracking from below and to the side as it climbs.
      position = rocket.clone().add(new THREE.Vector3(38, -22, -34));
      target = rocket.clone().add(new THREE.Vector3(0, 22, 0));
    } else {
      // From the ground far away: the smoke column and the flame high above.
      position = base.clone().add(new THREE.Vector3(160, 4, -190));
      target = rocket.clone();
      fov = 38;
    }
    if (shot !== this.shot) {
      this.shot = shot;
      this.cameraPosition.copy(position);
      this.lookTarget.copy(target);
    } else {
      this.cameraPosition.lerp(position, damping(shot === 2 ? 6 : 3, deltaSeconds));
      this.lookTarget.lerp(target, damping(8, deltaSeconds));
    }
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    const closeness = shot === 1 ? 1 : shot === 2 ? 0.5 : 0.15;
    if (thrust > 0.3) {
      this.cameraRig.addShake(deltaSeconds * thrust * closeness * 2.2);
    }
    this.cameraRig.place(this.cameraPosition, this.lookTarget, new THREE.Vector3(0, 1, 0), deltaSeconds);
  }

  private dropStrapOns(): void {
    this.strapsDropped = true;
    const scene = this.ground.scene;
    this.strapVelocity.length = 0;
    for (const strap of this.ground.stack.strapOns) {
      const outward = strap.getWorldPosition(new THREE.Vector3()).sub(this.ground.stack.rocket.position).setY(0).normalize();
      scene.attach(strap);
      this.strapVelocity.push(outward.multiplyScalar(6).add(new THREE.Vector3(0, -4, 0)));
    }
    this.sound.explosion(0.2);
  }

  private updateFallingStraps(deltaSeconds: number): void {
    if (!this.strapsDropped) {
      return;
    }
    this.ground.stack.strapOns.forEach((strap, index) => {
      const velocity = this.strapVelocity[index];
      velocity.y -= 9.8 * deltaSeconds;
      strap.position.addScaledVector(velocity, deltaSeconds);
      strap.rotation.z += (index === 0 ? 0.5 : -0.5) * deltaSeconds;
    });
  }

  private beginOrbit(): void {
    this.phase = 'orbit';
    this.effects.setThrust(0);
    this.presentation.useScene('orbit');
    this.camera.fov = 62;
    this.camera.updateProjectionMatrix();
    this.orbit.start();
  }

  private updateOrbit(deltaSeconds: number): void {
    // Fade back in from white as the rocket appears above the atmosphere.
    const fadeIn = 1 - THREE.MathUtils.clamp(this.orbit.elapsed / 1.2, 0, 1);
    this.presentation.fade(fadeIn);
    for (const event of this.orbit.update(deltaSeconds)) {
      if (event === 'cutoff') {
        this.presentation.caption('Main engine cut-off.');
        this.sound.setEngine(0.1, false);
      } else if (event === 'separation') {
        this.presentation.caption('Booster separation confirmed.');
        this.sound.explosion(0.15);
      } else {
        this.presentation.caption('PDW-01 engines lit. You have the controls.');
        this.sound.chime();
      }
    }
    if (this.orbit.elapsed < 3.6) {
      this.sound.setEngine(1, true);
    }
    this.effects.update(deltaSeconds, -1000, false);
    if (this.orbit.done) {
      this.finish();
    }
  }

  private showCaptions(t: number): void {
    while (this.captionIndex < CAPTIONS.length && t >= CAPTIONS[this.captionIndex][0]) {
      this.presentation.caption(CAPTIONS[this.captionIndex][1]);
      this.captionIndex += 1;
    }
  }

  private finish(): void {
    this.phase = 'done';
    this.orbit.finish();
    this.effects.clear();
    this.presentation.fade(0);
    this.presentation.caption('');
    this.presentation.useScene('orbit');
    this.camera.fov = 62;
    this.camera.updateProjectionMatrix();
  }
}
