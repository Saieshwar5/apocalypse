import * as THREE from 'three';
import { getGlowTexture } from '../scene/glowTexture';

/** Particles per ship; old puffs are reused. */
const POOL_SIZE = 96;
const PUFF_LIFE = 0.28;
const EXHAUST_SPEED = 7;
/** Accelerations below this (units/s²) fire no thrusters. */
const LINEAR_THRESHOLD = 1;
/** Turning accelerations below this (rad/s²) fire no thrusters. */
const ANGULAR_THRESHOLD = 0.8;
/** Puffs per second from one nozzle at full strength. */
const EMIT_RATE = 20;
/**
 * Faster changes than this cannot come from thrusters (collisions, docking
 * clamps, a tow line snapping), so they make no puffs.
 */
const IMPOSSIBLE_ACCELERATION = 40;

interface Puff {
  sprite: THREE.Sprite;
  velocity: THREE.Vector3;
  age: number;
  size: number;
  alive: boolean;
}

/** A nozzle: where it sits on the hull and which way its gas leaves, in the ship's frame. */
interface Nozzle {
  position: THREE.Vector3;
  exhaust: THREE.Vector3;
}

/**
 * Reaction-control thrusters: the small gas jets real spacecraft use to
 * brake, slide and turn. Rather than listening to keys, they watch how the
 * ship actually accelerates, so they fire for the pilot's brakes and slides,
 * for flight assist cancelling drift, and for computer pilots alike. The main
 * engine's push along the nose is left to the engine plumes.
 */
export class RcsThrusters {
  readonly group = new THREE.Group();
  /** 0..1 strength of the latest firing, for sound. */
  activity = 0;
  private readonly puffs: Puff[] = [];
  private readonly nozzles: Record<string, Nozzle[]>;
  private readonly lastVelocity = new THREE.Vector3();
  private readonly lastQuaternion = new THREE.Quaternion();
  private readonly lastAngular = new THREE.Vector3();
  private readonly emitCredit = new Map<Nozzle, number>();
  private primed = false;
  private next = 0;

  constructor(
    private readonly ship: THREE.Object3D,
    private readonly velocity: THREE.Vector3,
    bounds: THREE.Box3,
  ) {
    this.group.name = 'rcs';
    const material = new THREE.SpriteMaterial({
      map: getGlowTexture(),
      color: new THREE.Color(0.75, 0.8, 0.9),
      transparent: true,
      depthWrite: false,
    });
    for (let index = 0; index < POOL_SIZE; index += 1) {
      const sprite = new THREE.Sprite(material.clone());
      sprite.visible = false;
      this.group.add(sprite);
      this.puffs.push({ sprite, velocity: new THREE.Vector3(), age: 0, size: 0, alive: false });
    }
    const { min, max } = bounds;
    const nose = min.z + (max.z - min.z) * 0.12;
    const tail = max.z - (max.z - min.z) * 0.12;
    const mid = (min.y + max.y) / 2;
    const nozzle = (x: number, y: number, z: number, ex: number, ey: number, ez: number): Nozzle => ({
      position: new THREE.Vector3(x, y, z),
      exhaust: new THREE.Vector3(ex, ey, ez),
    });
    const half = (max.x - min.x) * 0.3;
    this.nozzles = {
      // Slowing down: gas jets out of the nose quad.
      brake: [nozzle(-half, mid, nose, 0, 0, -1), nozzle(half, mid, nose, 0, 0, -1)],
      // Pushed right: gas leaves the left flank, and the other way round.
      right: [nozzle(min.x, mid, nose, -1, 0, 0), nozzle(min.x, mid, tail, -1, 0, 0)],
      left: [nozzle(max.x, mid, nose, 1, 0, 0), nozzle(max.x, mid, tail, 1, 0, 0)],
      up: [nozzle(0, min.y, nose, 0, -1, 0), nozzle(0, min.y, tail, 0, -1, 0)],
      down: [nozzle(0, max.y, nose, 0, 1, 0), nozzle(0, max.y, tail, 0, 1, 0)],
      // Turning: opposite jets at nose and tail.
      pitchUp: [nozzle(0, min.y, nose, 0, -1, 0), nozzle(0, max.y, tail, 0, 1, 0)],
      pitchDown: [nozzle(0, max.y, nose, 0, 1, 0), nozzle(0, min.y, tail, 0, -1, 0)],
      yawLeft: [nozzle(max.x * 0.5, mid, nose, 1, 0, 0), nozzle(min.x * 0.5, mid, tail, -1, 0, 0)],
      yawRight: [nozzle(min.x * 0.5, mid, nose, -1, 0, 0), nozzle(max.x * 0.5, mid, tail, 1, 0, 0)],
      rollLeft: [nozzle(max.x, mid, 0, 0, 1, 0), nozzle(min.x, mid, 0, 0, -1, 0)],
      rollRight: [nozzle(max.x, mid, 0, 0, -1, 0), nozzle(min.x, mid, 0, 0, 1, 0)],
    };
  }

  reset(): void {
    this.primed = false;
    for (const puff of this.puffs) {
      puff.alive = false;
      puff.sprite.visible = false;
    }
  }

  update(deltaSeconds: number, active = true): void {
    this.updatePuffs(deltaSeconds);
    if (deltaSeconds <= 0) {
      return;
    }
    const inverse = this.ship.quaternion.clone().invert();
    if (!this.primed) {
      this.lastVelocity.copy(this.velocity);
      this.lastQuaternion.copy(this.ship.quaternion);
      this.primed = true;
      return;
    }
    // Linear acceleration in the ship's frame.
    const accel = this.velocity.clone().sub(this.lastVelocity).divideScalar(deltaSeconds).applyQuaternion(inverse);
    // Angular velocity from the change of orientation, and its change: the turning thrusters' work.
    const step = this.lastQuaternion.clone().invert().multiply(this.ship.quaternion);
    const angle = 2 * Math.acos(Math.min(1, Math.abs(step.w)));
    const axis = new THREE.Vector3(step.x, step.y, step.z);
    const angular = axis.lengthSq() > 1e-12 ? axis.normalize().multiplyScalar((Math.sign(step.w) * angle) / deltaSeconds) : new THREE.Vector3();
    const angularAccel = angular.clone().sub(this.lastAngular).divideScalar(deltaSeconds);
    this.lastVelocity.copy(this.velocity);
    this.lastQuaternion.copy(this.ship.quaternion);
    this.lastAngular.copy(angular);
    if (!active || accel.length() > IMPOSSIBLE_ACCELERATION || angularAccel.length() > IMPOSSIBLE_ACCELERATION) {
      this.activity = 0;
      return;
    }

    let strongest = 0;
    const fire = (key: string, amount: number, threshold: number, scale: number): void => {
      if (amount <= threshold) {
        return;
      }
      const strength = Math.min(1, (amount - threshold) / scale);
      strongest = Math.max(strongest, strength);
      for (const nozzle of this.nozzles[key]) {
        this.emit(nozzle, strength, deltaSeconds);
      }
    };
    fire('brake', accel.z, LINEAR_THRESHOLD, 10);
    fire('right', accel.x, LINEAR_THRESHOLD, 6);
    fire('left', -accel.x, LINEAR_THRESHOLD, 6);
    fire('up', accel.y, LINEAR_THRESHOLD, 6);
    fire('down', -accel.y, LINEAR_THRESHOLD, 6);
    fire('pitchUp', angularAccel.x, ANGULAR_THRESHOLD, 8);
    fire('pitchDown', -angularAccel.x, ANGULAR_THRESHOLD, 8);
    fire('yawLeft', angularAccel.y, ANGULAR_THRESHOLD, 8);
    fire('yawRight', -angularAccel.y, ANGULAR_THRESHOLD, 8);
    fire('rollLeft', angularAccel.z, ANGULAR_THRESHOLD, 6);
    fire('rollRight', -angularAccel.z, ANGULAR_THRESHOLD, 6);
    this.activity = strongest;
  }

  private emit(nozzle: Nozzle, strength: number, deltaSeconds: number): void {
    const credit = (this.emitCredit.get(nozzle) ?? 0) + EMIT_RATE * strength * deltaSeconds;
    let remaining = credit;
    while (remaining >= 1) {
      remaining -= 1;
      const puff = this.puffs[this.next];
      this.next = (this.next + 1) % this.puffs.length;
      const exhaust = nozzle.exhaust.clone().applyQuaternion(this.ship.quaternion);
      puff.sprite.position.copy(nozzle.position).applyMatrix4(this.ship.matrixWorld);
      puff.velocity
        .copy(this.velocity)
        .addScaledVector(exhaust, EXHAUST_SPEED * (0.7 + Math.random() * 0.6))
        .add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(1.2));
      puff.age = 0;
      puff.size = 0.05 + 0.06 * strength;
      puff.alive = true;
      // Size and fade are set now: a new sprite would otherwise show at full size for a frame.
      puff.sprite.scale.setScalar(puff.size);
      puff.sprite.material.opacity = 0.35;
      puff.sprite.visible = true;
    }
    this.emitCredit.set(nozzle, remaining);
  }

  private updatePuffs(deltaSeconds: number): void {
    for (const puff of this.puffs) {
      if (!puff.alive) {
        continue;
      }
      puff.age += deltaSeconds;
      if (puff.age >= PUFF_LIFE) {
        puff.alive = false;
        puff.sprite.visible = false;
        continue;
      }
      const t = puff.age / PUFF_LIFE;
      puff.sprite.position.addScaledVector(puff.velocity, deltaSeconds);
      // Gas expands and thins out quickly in vacuum.
      puff.sprite.scale.setScalar(puff.size * (1 + t * 2.5));
      puff.sprite.material.opacity = 0.35 * (1 - t) * (1 - t);
    }
  }
}
