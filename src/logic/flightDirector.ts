import type { Vec3Tuple } from './random';

/**
 * The flight director: one clear instruction at a time for a trip to a
 * moving target, worked out from the same physics the ship flies by.
 * TURN to the meeting point, BURN up to a sensible speed, COAST, BRAKE at
 * the last moment the brakes can still stop you, then ARRIVE and match
 * the target's speed.
 */
export type DirectorPhase = 'turn' | 'burn' | 'coast' | 'brake' | 'arrive' | 'arrived';

export interface DirectorInput {
  /** Distance to the meeting point. */
  distance: number;
  /** Speed towards the meeting point, relative to the target (negative when opening). */
  closingSpeed: number;
  /** Total speed relative to the target. */
  relativeSpeed: number;
  /** Angle between the nose and the meeting point, radians. */
  angle: number;
  /** Braking deceleration available (units/s²), lower for a heavy ship. */
  brake: number;
  /** Speeds the ship can hold: with flight assist, and with boost. */
  cruiseSpeed: number;
  boostSpeed: number;
  /** Inside this distance the trip is over: match speed. */
  arriveRange: number;
  /** Relative speed to arrive at (docking, berthing or towing limit). */
  arriveSpeed: number;
}

export interface DirectorAdvice {
  phase: DirectorPhase;
  /** Speed worth reaching on this leg, units/s. */
  targetSpeed: number;
  /** Seconds until the brakes must come on, while coasting. */
  brakeIn: number | null;
}

const TURN_LIMIT = (20 * Math.PI) / 180;
/**
 * Once there, drifting this far past the arrival range still counts as
 * there: without it the advice flickered back to BURN at the edge, the
 * pilot touched the throttle, and the berth's hold timer started again.
 */
const ARRIVE_MARGIN = 1.5;
/** Brake a little early: a margin for reaction time. */
const BRAKE_MARGIN = 1.15;

export function directorAdvice(input: DirectorInput): DirectorAdvice {
  const usable = Math.max(0, input.distance - input.arriveRange);
  const closing = Math.max(0, input.closingSpeed);
  const stopping = ((closing * closing - input.arriveSpeed * input.arriveSpeed) / (2 * input.brake)) * BRAKE_MARGIN;
  // Fastest speed from which the brakes can still stop in time, and what the engines can hold.
  const reachable = Math.sqrt(2 * input.brake * usable + input.arriveSpeed * input.arriveSpeed);
  const engine = usable > 150 ? input.boostSpeed : input.cruiseSpeed;
  const targetSpeed = Math.max(input.arriveSpeed, Math.min(engine, reachable * 0.8));
  if (input.distance <= input.arriveRange || (input.distance <= input.arriveRange + ARRIVE_MARGIN && input.relativeSpeed <= input.arriveSpeed)) {
    return { phase: input.relativeSpeed <= input.arriveSpeed ? 'arrived' : 'arrive', targetSpeed: input.arriveSpeed, brakeIn: null };
  }
  if (closing > input.arriveSpeed && stopping >= usable) {
    return { phase: 'brake', targetSpeed, brakeIn: 0 };
  }
  if (input.angle > TURN_LIMIT) {
    return { phase: 'turn', targetSpeed, brakeIn: null };
  }
  if (closing < targetSpeed - 1) {
    return { phase: 'burn', targetSpeed, brakeIn: null };
  }
  return { phase: 'coast', targetSpeed, brakeIn: closing > 0.5 ? Math.max(0, (usable - stopping) / closing) : null };
}

/**
 * Where to meet a moving target: where it will be by the time the ship gets
 * there at `travelSpeed`. A few rounds of refinement are plenty; the time is
 * capped so a target racing away does not send the ship across the sky.
 */
export function meetingPoint(ship: Vec3Tuple, target: Vec3Tuple, targetVelocity: Vec3Tuple, travelSpeed: number, maxSeconds = 90): { point: Vec3Tuple; seconds: number } {
  const speed = Math.max(travelSpeed, 1);
  let seconds = distanceBetween(ship, target) / speed;
  let point: Vec3Tuple = target;
  for (let round = 0; round < 4; round += 1) {
    seconds = Math.min(maxSeconds, seconds);
    point = [target[0] + targetVelocity[0] * seconds, target[1] + targetVelocity[1] * seconds, target[2] + targetVelocity[2] * seconds];
    seconds = distanceBetween(ship, point) / speed;
  }
  return { point, seconds: Math.min(maxSeconds, seconds) };
}

function distanceBetween(a: Vec3Tuple, b: Vec3Tuple): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export type NavGroup = 'job' | 'station' | 'satellite' | 'pilot' | 'debris';
const GROUP_ORDER: readonly NavGroup[] = ['job', 'station', 'satellite', 'pilot', 'debris'];
export const NAV_GROUP_TAG: Record<NavGroup, string> = { job: 'JOB', station: 'STA', satellite: 'SAT', pilot: 'PIL', debris: 'DEB' };

/** The navigation computer's list: jobs first, then stations, satellites, pilots, debris; nearest first within each. */
export function sortNavEntries<T extends { group: NavGroup; distance: number }>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || a.distance - b.distance);
}

const ARROWS = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'];

/** A small arrow for a compass point (screen x right, y down); behind gets a turn-around mark. */
export function bearingArrow(x: number, y: number, behind: boolean): string {
  if (Math.hypot(x, y) < 0.06) {
    return '•';
  }
  const index = Math.round(Math.atan2(y, x) / (Math.PI / 4));
  const arrow = ARROWS[(index + 8) % 8];
  return behind ? `${arrow}⟲` : arrow;
}

/**
 * Earth is in the way more often than not. If the straight line from the
 * ship to the target passes closer to the planet's centre than `safeRadius`,
 * this returns a point to steer for instead: where a line from the ship just
 * grazes a sphere `clearance` larger, on the side the target lies. Followed
 * and recomputed as the ship moves, it leads the ship up to that sphere,
 * round it, and off again once the way is clear. Null when the way is clear.
 */
export function viaAround(ship: Vec3Tuple, target: Vec3Tuple, safeRadius: number, clearance: number): Vec3Tuple | null {
  const d: Vec3Tuple = [target[0] - ship[0], target[1] - ship[1], target[2] - ship[2]];
  const lengthSquared = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  if (lengthSquared === 0) {
    return null;
  }
  const t = -(ship[0] * d[0] + ship[1] * d[1] + ship[2] * d[2]) / lengthSquared;
  // Closest approach at either end: the line is leaving or arriving, not crossing.
  if (t <= 0 || t >= 1) {
    return null;
  }
  if (Math.hypot(ship[0] + d[0] * t, ship[1] + d[1] * t, ship[2] + d[2] * t) >= safeRadius) {
    return null;
  }
  const distance = Math.hypot(...ship);
  const outward: Vec3Tuple = distance > 1e-6 ? [ship[0] / distance, ship[1] / distance, ship[2] / distance] : [0, 1, 0];
  // The way round: the part of the direction to the target that is square to "outward".
  const along = d[0] * outward[0] + d[1] * outward[1] + d[2] * outward[2];
  let side: Vec3Tuple = [d[0] - outward[0] * along, d[1] - outward[1] * along, d[2] - outward[2] * along];
  let sideLength = Math.hypot(...side);
  if (sideLength < 1e-6) {
    // The target is straight through the centre: any way round will do.
    const axis: Vec3Tuple = Math.abs(outward[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    side = [outward[1] * axis[2] - outward[2] * axis[1], outward[2] * axis[0] - outward[0] * axis[2], outward[0] * axis[1] - outward[1] * axis[0]];
    sideLength = Math.hypot(...side);
  }
  side = [side[0] / sideLength, side[1] / sideLength, side[2] / sideLength];
  const radius = safeRadius + clearance;
  if (distance <= radius) {
    // Already down at the sphere: fly along it, climbing a little.
    const reach = 12;
    return [ship[0] + (side[0] + outward[0] * 0.25) * reach, ship[1] + (side[1] + outward[1] * 0.25) * reach, ship[2] + (side[2] + outward[2] * 0.25) * reach];
  }
  // The grazing line leaves the ship at this angle from the line to the centre.
  const sine = radius / distance;
  const cosine = Math.sqrt(1 - sine * sine);
  const reach = Math.sqrt(distance * distance - radius * radius);
  return [
    ship[0] + (side[0] * sine - outward[0] * cosine) * reach,
    ship[1] + (side[1] * sine - outward[1] * cosine) * reach,
    ship[2] + (side[2] * sine - outward[2] * cosine) * reach,
  ];
}
