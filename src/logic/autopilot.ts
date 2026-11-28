import { FLIGHT } from './flightModel';
import type { Vec3Tuple } from './random';

/**
 * Steering for computer pilots, built on the same flight model as the
 * player's ship: it chooses where to point the nose and whether to thrust or
 * brake, so it obeys the same speed limits and braking distances.
 */
export interface AutopilotSituation {
  /** Target minus ship. */
  offset: Vec3Tuple;
  shipVelocity: Vec3Tuple;
  targetVelocity: Vec3Tuple;
  /** Unit vector the nose points along. */
  forward: Vec3Tuple;
  /** Stop this far from the target (to stand off a rock, for example). */
  standOff: number;
}

export interface AutopilotCommand {
  /** Direction to turn the nose towards (unit length). */
  aim: Vec3Tuple;
  thrust: number;
  brake: number;
  boost: boolean;
  /** Within a unit of the stand-off point and nearly matched in speed. */
  arrived: boolean;
}

/** Nose must be within this angle of the wanted direction before thrusting. */
const THRUST_CONE = 0.35;
/** Approach is planned at this share of braking power, to leave a margin. */
const BRAKE_MARGIN = 0.6;

export function autopilotCommand(situation: AutopilotSituation): AutopilotCommand {
  const distance = length(situation.offset);
  const gap = Math.max(0, distance - situation.standOff);
  const toward = distance > 1e-6 ? scale(situation.offset, 1 / distance) : situation.forward;
  // Fastest closing speed from which the ship can still stop in the gap.
  const approach = Math.min(FLIGHT.boostSpeed, Math.sqrt(2 * FLIGHT.brake * BRAKE_MARGIN * gap));
  const wanted = add(situation.targetVelocity, scale(toward, approach));
  const change = sub(wanted, situation.shipVelocity);
  const changeSize = length(change);
  const relativeSpeed = length(sub(situation.shipVelocity, situation.targetVelocity));
  const arrived = gap < 1 && relativeSpeed < 1.5;
  if (changeSize < 0.4) {
    return { aim: toward, thrust: 0, brake: 0, boost: false, arrived };
  }
  const aim = scale(change, 1 / changeSize);
  // Going too fast in a wrong direction: the retro thrusters fix it fastest.
  const speed = length(situation.shipVelocity);
  const wrongWay = speed > 1 && dot(scale(situation.shipVelocity, 1 / speed), aim) < -0.2;
  const tooFast = speed > length(wanted) + 3;
  if (wrongWay || tooFast) {
    return { aim, thrust: 0, brake: 1, boost: false, arrived };
  }
  const aligned = Math.acos(Math.min(1, Math.max(-1, dot(situation.forward, aim)))) < THRUST_CONE;
  return { aim, thrust: aligned ? 1 : 0, brake: 0, boost: aligned && changeSize > FLIGHT.cruiseSpeed * 0.8, arrived };
}

function add(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(a: Vec3Tuple, factor: number): Vec3Tuple {
  return [a[0] * factor, a[1] * factor, a[2] * factor];
}

function dot(a: Vec3Tuple, b: Vec3Tuple): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function length(a: Vec3Tuple): number {
  return Math.hypot(a[0], a[1], a[2]);
}
