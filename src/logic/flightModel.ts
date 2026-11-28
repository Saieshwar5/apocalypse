import type { Vec3Tuple } from './random';
import { PLANET_RADIUS } from './units';

/**
 * How the ship moves. Space has no air, so nothing slows the ship down by
 * itself: it keeps its speed until the pilot brakes. Two modes share the same
 * engines:
 *
 * - Flight assist on (default): small thrusters cancel sideways drift so the
 *   ship goes where its nose points, hold it against the planet's gravity and
 *   ease it back to cruise speed after a boost.
 * - Flight assist off: pure physics. The ship drifts in whatever direction it
 *   was moving, and gravity bends its path, so it can coast in an orbit.
 */
export const FLIGHT = {
  /** Main engine acceleration, units per second squared. */
  thrust: 13,
  boostMultiplier: 2.2,
  /** Side and vertical thrusters. */
  sideThrust: 8,
  /** Retro thrusters: stronger than the main engine so stopping feels safe. */
  brake: 22,
  /** The engines cannot push the ship past these speeds. */
  cruiseSpeed: 24,
  boostSpeed: 50,
  sideSpeed: 9,
  /** Share of sideways drift the assist removes each second. */
  assistGrip: 1.8,
  /** Share of speed above cruise that the assist removes each second. */
  assistSettle: 0.45,
  /** Pull at the surface; falls with the square of distance. */
  surfaceGravity: 1.5,
} as const;

/** Pull towards the planet's centre at `distance` from it. */
export function gravityAt(distance: number, planetRadius = PLANET_RADIUS): number {
  const clamped = Math.max(distance, planetRadius);
  return FLIGHT.surfaceGravity * (planetRadius / clamped) ** 2;
}

/** Speed that keeps a circular orbit at `distance` with flight assist off. */
export function orbitSpeedAt(distance: number, planetRadius = PLANET_RADIUS): number {
  const clamped = Math.max(distance, planetRadius);
  return Math.sqrt(gravityAt(clamped, planetRadius) * clamped);
}

export interface FlightCommand {
  /** 0 to 1: main engine. */
  thrust: number;
  /** 0 to 1: retro thrusters, slowing the ship whatever way it is moving. */
  brake: number;
  /** -1 (left) to 1 (right). */
  strafe: number;
  /** -1 (down) to 1 (up), relative to the ship. */
  lift: number;
  boost: boolean;
}

export interface FlightFrame {
  velocity: Vec3Tuple;
  /** Ship axes in world space, unit length. */
  forward: Vec3Tuple;
  right: Vec3Tuple;
  up: Vec3Tuple;
  /** Ship position relative to the planet's centre. */
  position: Vec3Tuple;
  assist: boolean;
  /** Engine power: 1 normally, less with an empty tank, more with upgrades. */
  power: number;
}

/** The ship's velocity after `deltaSeconds` of the given command. */
export function stepVelocity(frame: FlightFrame, command: FlightCommand, deltaSeconds: number): Vec3Tuple {
  let velocity: Vec3Tuple = [...frame.velocity];
  const { forward, right, up, power } = frame;

  const engine = FLIGHT.thrust * power * (command.boost ? FLIGHT.boostMultiplier : 1) * clamp01(command.thrust);
  velocity = pushTowardsLimit(velocity, forward, engine * deltaSeconds, command.boost ? FLIGHT.boostSpeed : FLIGHT.cruiseSpeed);
  const side = FLIGHT.sideThrust * power * deltaSeconds;
  velocity = pushTowardsLimit(velocity, scale(right, Math.sign(command.strafe)), side * Math.abs(command.strafe), FLIGHT.sideSpeed);
  velocity = pushTowardsLimit(velocity, scale(up, Math.sign(command.lift)), side * Math.abs(command.lift), FLIGHT.sideSpeed);

  if (command.brake > 0) {
    velocity = shorten(velocity, FLIGHT.brake * power * clamp01(command.brake) * deltaSeconds);
  }

  if (frame.assist) {
    // Cancel drift on the axes the pilot is not using.
    const grip = 1 - Math.exp(-FLIGHT.assistGrip * deltaSeconds);
    if (command.strafe === 0) {
      velocity = addScaled(velocity, right, -dot(velocity, right) * grip);
    }
    if (command.lift === 0) {
      velocity = addScaled(velocity, up, -dot(velocity, up) * grip);
    }
    const speed = length(velocity);
    if (!command.boost && speed > FLIGHT.cruiseSpeed) {
      const settled = FLIGHT.cruiseSpeed + (speed - FLIGHT.cruiseSpeed) * Math.exp(-FLIGHT.assistSettle * deltaSeconds);
      velocity = scale(velocity, settled / speed);
    }
  } else {
    const distance = length(frame.position);
    if (distance > 0) {
      velocity = addScaled(velocity, frame.position, (-gravityAt(distance) * deltaSeconds) / distance);
    }
  }
  return velocity;
}

/** Seconds of braking needed to stop from `speed`. */
export function stoppingTime(speed: number, power = 1): number {
  return speed / (FLIGHT.brake * power);
}

/** Distance covered while braking to a stop from `speed`. */
export function stoppingDistance(speed: number, power = 1): number {
  return (speed * speed) / (2 * FLIGHT.brake * power);
}

/** Adds `amount` of speed along `direction`, but never past `limit` on that axis. */
function pushTowardsLimit(velocity: Vec3Tuple, direction: Vec3Tuple, amount: number, limit: number): Vec3Tuple {
  if (amount <= 0) {
    return velocity;
  }
  const along = dot(velocity, direction);
  const room = Math.max(0, limit - along);
  return addScaled(velocity, direction, Math.min(amount, room));
}

function shorten(velocity: Vec3Tuple, amount: number): Vec3Tuple {
  const speed = length(velocity);
  return speed <= amount ? [0, 0, 0] : scale(velocity, (speed - amount) / speed);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function dot(a: Vec3Tuple, b: Vec3Tuple): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function length(a: Vec3Tuple): number {
  return Math.hypot(a[0], a[1], a[2]);
}

function scale(a: Vec3Tuple, factor: number): Vec3Tuple {
  return [a[0] * factor, a[1] * factor, a[2] * factor];
}

function addScaled(a: Vec3Tuple, b: Vec3Tuple, factor: number): Vec3Tuple {
  return [a[0] + b[0] * factor, a[1] + b[1] * factor, a[2] + b[2] * factor];
}
