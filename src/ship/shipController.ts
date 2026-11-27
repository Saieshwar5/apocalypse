import * as THREE from 'three';
import { damping } from '../math/orientation';

export interface FlightInput {
  /** Mouse movement in pixels since the last frame. */
  look: { x: number; y: number };
  /** -1 (reverse) to 1 (forward). */
  thrust: number;
  /** -1 (left) to 1 (right). */
  strafe: number;
  /** -1 (roll left) to 1 (roll right). */
  roll: number;
  boost: boolean;
}

export const IDLE_INPUT: FlightInput = { look: { x: 0, y: 0 }, thrust: 0, strafe: 0, roll: 0, boost: false };

const LOOK_SENSITIVITY = 0.0022;
const MAX_TURN_RATE = 2.6;
const ROLL_RATE = 2.0;
const THRUST = 16;
const STRAFE_THRUST = 9;
const BOOST_MULTIPLIER = 2.6;
/** Arcade drag so the ship settles instead of drifting forever. */
const DRAG = 0.55;
const BOOST_DRAIN = 28;
const BOOST_RECHARGE = 11;
const HULL_CLEARANCE = 0.9;

/**
 * Moves the interceptor: mouse steers pitch and yaw, keys thrust, strafe and
 * roll. Owns the ship's velocity, boost energy and hull; the caller owns the
 * scene object passed in.
 */
export class ShipController {
  readonly velocity = new THREE.Vector3();
  boostEnergy = 100;
  hull = 100;
  /** 0..1 engine output, used for exhaust visuals and sound. */
  throttle = 0;
  boosting = false;

  private readonly angularVelocity = new THREE.Vector3();
  private readonly scratch = new THREE.Vector3();
  private readonly turn = new THREE.Quaternion();

  constructor(readonly object: THREE.Object3D) {}

  get position(): THREE.Vector3 {
    return this.object.position;
  }

  forward(target = new THREE.Vector3()): THREE.Vector3 {
    return target.set(0, 0, -1).applyQuaternion(this.object.quaternion);
  }

  up(target = new THREE.Vector3()): THREE.Vector3 {
    return target.set(0, 1, 0).applyQuaternion(this.object.quaternion);
  }

  update(deltaSeconds: number, input: FlightInput, planetRadius: number): void {
    this.updateRotation(deltaSeconds, input);
    this.updateThrust(deltaSeconds, input);
    this.velocity.multiplyScalar(Math.exp(-DRAG * deltaSeconds));
    this.object.position.addScaledVector(this.velocity, deltaSeconds);
    this.keepAbovePlanet(planetRadius);
  }

  /** Returns true when the hull is destroyed. */
  applyHullDamage(amount: number): boolean {
    this.hull = Math.max(0, this.hull - amount);
    return this.hull === 0;
  }

  reset(position: THREE.Vector3, orientation: THREE.Quaternion, initialSpeed = 0): void {
    this.object.position.copy(position);
    this.object.quaternion.copy(orientation);
    this.velocity.copy(this.forward()).multiplyScalar(initialSpeed);
    this.angularVelocity.set(0, 0, 0);
    this.boostEnergy = 100;
    this.hull = 100;
    this.throttle = 0;
    this.boosting = false;
  }

  private updateRotation(deltaSeconds: number, input: FlightInput): void {
    const safeDelta = Math.max(deltaSeconds, 1 / 240);
    const targetPitch = THREE.MathUtils.clamp((-input.look.y * LOOK_SENSITIVITY) / safeDelta, -MAX_TURN_RATE, MAX_TURN_RATE);
    const targetYaw = THREE.MathUtils.clamp((-input.look.x * LOOK_SENSITIVITY) / safeDelta, -MAX_TURN_RATE, MAX_TURN_RATE);
    const targetRoll = -input.roll * ROLL_RATE;
    this.angularVelocity.lerp(this.scratch.set(targetPitch, targetYaw, targetRoll), damping(14, deltaSeconds));

    this.turn.setFromEuler(
      new THREE.Euler(
        this.angularVelocity.x * deltaSeconds,
        this.angularVelocity.y * deltaSeconds,
        this.angularVelocity.z * deltaSeconds,
        'YXZ',
      ),
    );
    this.object.quaternion.multiply(this.turn).normalize();
  }

  private updateThrust(deltaSeconds: number, input: FlightInput): void {
    const wantsBoost = input.boost && input.thrust > 0 && this.boostEnergy > 1;
    this.boosting = wantsBoost;
    this.boostEnergy = wantsBoost
      ? Math.max(0, this.boostEnergy - BOOST_DRAIN * deltaSeconds)
      : Math.min(100, this.boostEnergy + BOOST_RECHARGE * deltaSeconds);

    const forwardThrust = input.thrust * THRUST * (wantsBoost ? BOOST_MULTIPLIER : 1);
    const quaternion = this.object.quaternion;
    this.velocity.addScaledVector(this.scratch.set(0, 0, -1).applyQuaternion(quaternion), forwardThrust * deltaSeconds);
    this.velocity.addScaledVector(this.scratch.set(1, 0, 0).applyQuaternion(quaternion), input.strafe * STRAFE_THRUST * deltaSeconds);

    const targetThrottle = Math.max(0, input.thrust) * (wantsBoost ? 1 : 0.75) + 0.1;
    this.throttle = THREE.MathUtils.lerp(this.throttle, targetThrottle, damping(6, deltaSeconds));
  }

  /** The ship cannot fly into the planet: it slides along the upper atmosphere. */
  private keepAbovePlanet(planetRadius: number): void {
    const minimum = planetRadius + HULL_CLEARANCE;
    const distance = this.object.position.length();
    if (distance >= minimum) {
      return;
    }
    const normal = this.scratch.copy(this.object.position).normalize();
    this.object.position.copy(normal).multiplyScalar(minimum);
    const inward = this.velocity.dot(normal);
    if (inward < 0) {
      this.velocity.addScaledVector(normal, -inward * 1.3);
    }
  }
}
