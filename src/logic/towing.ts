import type { Vec3Tuple } from './random';

/**
 * The tow line. One skill serves several jobs: fly close, match the object's
 * speed and connect; haul it, with the extra mass making the ship slow to
 * speed up and stop; place it in a marked zone; and do not shake a fragile
 * load. The line is a stiff spring that only pulls (a rope cannot push).
 */
export const TOW = {
  /** Connect within this distance of the object's surface... */
  attachRange: 4,
  /** ...when moving at less than this relative to it. */
  attachSpeed: 3,
  /** Rope length: slack inside, taut beyond. */
  length: 4.5,
  stiffness: 9,
  /** Damps stretching so the load does not bounce on the line. */
  damping: 3.5,
  /** The ship's mass, for sharing the pull between ship and load. */
  shipMass: 1,
  /** Beyond this stretch the line snaps. */
  breakStretch: 6,
  /**
   * The line's winch and stabilisers steady a swinging load: the share of
   * the load's motion relative to the ship removed each second. Without it
   * a load circles a stopped ship on the rope and cannot be placed.
   */
  steadying: 0.8,
} as const;

/** Masses relative to the ship. */
export const LOAD_MASS = { satellite: 0.7 } as const;

/** Tension a fragile load takes without harm; harder pulls damage it. */
export const FRAGILE = { safeTension: 14, damagePerTension: 0.9 } as const;

export function canAttach(surfaceDistance: number, relativeSpeed: number): boolean {
  return surfaceDistance <= TOW.attachRange && relativeSpeed <= TOW.attachSpeed;
}

export interface TowState {
  shipPosition: Vec3Tuple;
  shipVelocity: Vec3Tuple;
  loadPosition: Vec3Tuple;
  loadVelocity: Vec3Tuple;
  loadMass: number;
  /** The ship's mass with its modules; the bare ship is TOW.shipMass. */
  shipMass?: number;
  /** A heavy winch: multiplies the stretch the line takes and how fast it steadies. */
  lineStrength?: number;
  lineSteadying?: number;
}

export interface TowStep {
  /** Velocity changes for this step. */
  shipDelta: Vec3Tuple;
  loadDelta: Vec3Tuple;
  /** Force along the line; 0 while slack. */
  tension: number;
  /** How far the line is stretched past its length. */
  stretch: number;
  snapped: boolean;
}

/**
 * One step of the line. The pull is shared by mass, so a heavy load barely
 * moves while it drags the ship back, and a light one follows readily.
 */
export function towStep(state: TowState, deltaSeconds: number): TowStep {
  const offset = sub(state.loadPosition, state.shipPosition);
  const distance = length(offset);
  const stretch = distance - TOW.length;
  const relative = sub(state.loadVelocity, state.shipVelocity);
  const shipMass = state.shipMass ?? TOW.shipMass;
  const steadying = TOW.steadying * (state.lineSteadying ?? 1);
  // Steadying is shared by mass like any internal force, so momentum is kept.
  const steady = scale(relative, (1 - Math.exp(-steadying * deltaSeconds)) * (shipMass / (shipMass + state.loadMass)));
  const none: TowStep = {
    shipDelta: scale(steady, state.loadMass / shipMass),
    loadDelta: scale(steady, -1),
    tension: 0,
    stretch: Math.max(0, stretch),
    snapped: false,
  };
  if (stretch > TOW.breakStretch * (state.lineStrength ?? 1)) {
    return { ...none, shipDelta: [0, 0, 0], loadDelta: [0, 0, 0], snapped: true };
  }
  if (stretch <= 0 || distance === 0) {
    return none;
  }
  const direction = scale(offset, 1 / distance);
  // Rate at which the line is lengthening; only damp stretching, not slackening.
  const separating = dot(sub(state.loadVelocity, state.shipVelocity), direction);
  const tension = Math.max(0, TOW.stiffness * stretch + TOW.damping * separating);
  const impulse = tension * deltaSeconds;
  return {
    shipDelta: add(scale(direction, impulse / shipMass), none.shipDelta),
    loadDelta: add(scale(direction, -impulse / state.loadMass), none.loadDelta),
    tension,
    stretch,
    snapped: false,
  };
}

/** Condition lost by a fragile load in one step under `tension`. */
export function loadStress(tension: number, deltaSeconds: number): number {
  return Math.max(0, tension - FRAGILE.safeTension) * FRAGILE.damagePerTension * deltaSeconds;
}

/** A load is placed when it is inside the zone and nearly still relative to it. */
export const PLACEMENT = { radius: 6, maxSpeed: 2.5 } as const;

export function isPlaced(distanceFromSlot: number, relativeSpeed: number): boolean {
  return distanceFromSlot <= PLACEMENT.radius && relativeSpeed <= PLACEMENT.maxSpeed;
}

/** 1 at the exact spot, falling to 0.7 at the edge of the zone. */
export function placementAccuracy(distanceFromSlot: number): number {
  const share = Math.min(1, Math.max(0, distanceFromSlot / PLACEMENT.radius));
  return 1 - 0.3 * share;
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
