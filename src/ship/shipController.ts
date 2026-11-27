import * as THREE from 'three';
import {
  applyShipDamage,
  createDefenseState,
  rechargeShield,
  type DamageResult,
  type DefenseState,
} from '../logic/shipDefense';
import { stepVelocity } from '../logic/flightModel';
import { FUEL_CAPACITY, fuelBurned, thrustScale } from '../logic/stationSupply';
import { damping } from '../math/orientation';

export interface FlightInput {
  /** Mouse movement in pixels since the last frame. */
  look: { x: number; y: number };
  /** Keyboard steering, each -1 to 1: positive pitch lifts the nose, positive yaw turns right. */
  pitch: number;
  yaw: number;
  /** 0 to 1: main engine. */
  thrust: number;
  /** 0 to 1: retro thrusters. */
  brake: number;
  /** -1 (left) to 1 (right). */
  strafe: number;
  /** -1 (down) to 1 (up). */
  lift: number;
  /** -1 (roll left) to 1 (roll right). */
  roll: number;
  boost: boolean;
}

export const IDLE_INPUT: FlightInput = {
  look: { x: 0, y: 0 },
  pitch: 0,
  yaw: 0,
  thrust: 0,
  brake: 0,
  strafe: 0,
  lift: 0,
  roll: 0,
  boost: false,
};

const LOOK_SENSITIVITY = 0.0022;
const MAX_TURN_RATE = 2.6;
const ROLL_RATE = 2.0;
/** Turn rate from the steering keys, radians per second. */
const KEY_TURN_RATE = 1.5;
const BOOST_DRAIN = 28;
const BOOST_RECHARGE = 11;

/**
 * Moves the interceptor: the mouse or the arrow keys steer, keys thrust,
 * brake, slide and roll. The rules of motion are in logic/flightModel. Owns the ship's velocity, boost energy and hull; the caller owns the
 * scene object passed in.
 */
export class ShipController {
  readonly velocity = new THREE.Vector3();
  boostEnergy = 100;
  /** Burned by thrust and boost; refilled at the station. */
  fuel = FUEL_CAPACITY;
  /** Set from the loadout; upgrades raise these. */
  fuelCapacity = FUEL_CAPACITY;
  shieldCapacity = 100;
  thrustMultiplier = 1;
  /** Mouse steering multiplier from the settings. */
  lookSensitivity = 1;
  defense: DefenseState = createDefenseState();
  /** Flight assist: cancels drift and gravity. Off gives pure physics. */
  assist = true;
  /** Set while an autopilot flies, which always uses the assist. */
  assistOverride = false;
  /** 0..1 engine output, used for exhaust visuals and sound. */
  throttle = 0;
  boosting = false;

  private readonly angularVelocity = new THREE.Vector3();
  private readonly scratch = new THREE.Vector3();
  private readonly turn = new THREE.Quaternion();

  constructor(readonly object: THREE.Object3D) {}

  get hull(): number {
    return this.defense.hull;
  }

  get shield(): number {
    return this.defense.shield;
  }

  /** Current yaw rate in radians per second (positive turns left), for banking. */
  get yawRate(): number {
    return this.angularVelocity.y;
  }

  get position(): THREE.Vector3 {
    return this.object.position;
  }

  forward(target = new THREE.Vector3()): THREE.Vector3 {
    return target.set(0, 0, -1).applyQuaternion(this.object.quaternion);
  }

  up(target = new THREE.Vector3()): THREE.Vector3 {
    return target.set(0, 1, 0).applyQuaternion(this.object.quaternion);
  }

  update(deltaSeconds: number, input: FlightInput): void {
    this.defense = rechargeShield(this.defense, deltaSeconds, this.shieldCapacity);
    this.updateRotation(deltaSeconds, input);
    this.updateThrust(deltaSeconds, input);
    this.object.position.addScaledVector(this.velocity, deltaSeconds);
  }

  /** Shield first, then hull. The caller checks `hull` to see if the ship is lost. */
  applyDamage(amount: number): DamageResult {
    const result = applyShipDamage(this.defense, amount);
    this.defense = result.state;
    return result;
  }

  /** Station repairs: the only way the hull recovers. */
  repair(hull: number, shield: number): void {
    this.defense = {
      ...this.defense,
      hull: Math.min(100, this.defense.hull + hull),
      shield: Math.min(this.shieldCapacity, this.defense.shield + shield),
    };
  }

  reset(position: THREE.Vector3, orientation: THREE.Quaternion, initialSpeed = 0): void {
    this.object.position.copy(position);
    this.object.quaternion.copy(orientation);
    this.velocity.copy(this.forward()).multiplyScalar(initialSpeed);
    this.angularVelocity.set(0, 0, 0);
    this.boostEnergy = 100;
    this.fuel = this.fuelCapacity;
    this.defense = createDefenseState(this.shieldCapacity);
    this.throttle = 0;
    this.boosting = false;
  }

  private updateRotation(deltaSeconds: number, input: FlightInput): void {
    const safeDelta = Math.max(deltaSeconds, 1 / 240);
    const mousePitch = (-input.look.y * LOOK_SENSITIVITY * this.lookSensitivity) / safeDelta;
    const mouseYaw = (-input.look.x * LOOK_SENSITIVITY * this.lookSensitivity) / safeDelta;
    const targetPitch = THREE.MathUtils.clamp(mousePitch + input.pitch * KEY_TURN_RATE, -MAX_TURN_RATE, MAX_TURN_RATE);
    const targetYaw = THREE.MathUtils.clamp(mouseYaw - input.yaw * KEY_TURN_RATE, -MAX_TURN_RATE, MAX_TURN_RATE);
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
    const wantsBoost = input.boost && input.thrust > 0 && this.boostEnergy > 1 && this.fuel > 0;
    // An empty tank leaves weak reserve thrust, so the ship can still limp home.
    const power = thrustScale(this.fuel) * this.thrustMultiplier;
    const mainEngines = Math.max(input.thrust, input.brake);
    const sideEngines = Math.min(1, Math.abs(input.strafe) + Math.abs(input.lift));
    this.fuel = Math.max(0, this.fuel - fuelBurned(mainEngines, sideEngines, wantsBoost, deltaSeconds));
    this.boosting = wantsBoost;
    this.boostEnergy = wantsBoost
      ? Math.max(0, this.boostEnergy - BOOST_DRAIN * deltaSeconds)
      : Math.min(100, this.boostEnergy + BOOST_RECHARGE * deltaSeconds);

    const quaternion = this.object.quaternion;
    const next = stepVelocity(
      {
        velocity: this.velocity.toArray(),
        forward: this.scratch.set(0, 0, -1).applyQuaternion(quaternion).toArray(),
        right: this.scratch.set(1, 0, 0).applyQuaternion(quaternion).toArray(),
        up: this.scratch.set(0, 1, 0).applyQuaternion(quaternion).toArray(),
        position: this.object.position.toArray(),
        assist: this.assist || this.assistOverride,
        power,
      },
      { thrust: input.thrust, brake: input.brake, strafe: input.strafe, lift: input.lift, boost: wantsBoost },
      deltaSeconds,
    );
    this.velocity.fromArray(next);

    const targetThrottle = Math.max(input.thrust * (wantsBoost ? 1 : 0.75), input.brake * 0.4) + 0.1;
    this.throttle = THREE.MathUtils.lerp(this.throttle, targetThrottle, damping(6, deltaSeconds));
  }
}
