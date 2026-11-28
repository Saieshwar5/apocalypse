import type { Vec3Tuple } from './random';

/**
 * Finding your way in three dimensions. Everything here works in the ship's
 * own frame (x right, y up, -z ahead), so "turn left" always means left on
 * the screen, however the ship has rolled.
 */

/** Within this angle of the nose the objective counts as dead ahead. */
export const ON_TARGET_ANGLE = (5 * Math.PI) / 180;
/** The compass rim: objectives in front fill the inner part, those behind the outer ring. */
const FRONT_SHARE = 0.78;

export interface CompassPoint {
  /** Position on a unit disc, screen-oriented: x right, y down. */
  x: number;
  y: number;
  /** Angle between the nose and the objective, radians (0 ahead, PI behind). */
  angle: number;
  behind: boolean;
  onTarget: boolean;
}

/**
 * Where to draw an objective on the target compass: the centre is straight
 * ahead, the rim of the inner part is 90 degrees off, and anything behind
 * sits in the outer ring (drawn hollow), so the dot always shows which way
 * to turn.
 */
export function compassPoint(local: Vec3Tuple): CompassPoint {
  const [x, y, z] = local;
  const length = Math.hypot(x, y, z);
  if (length === 0) {
    return { x: 0, y: 0, angle: 0, behind: false, onTarget: true };
  }
  const angle = Math.acos(Math.min(1, Math.max(-1, -z / length)));
  const half = Math.PI / 2;
  const radius = angle <= half ? (angle / half) * FRONT_SHARE : FRONT_SHARE + ((angle - half) / half) * (1 - FRONT_SHARE);
  const side = Math.hypot(x, y);
  // Straight behind has no side: point down, so the pilot pitches over.
  const dirX = side > 1e-9 ? x / side : 0;
  const dirY = side > 1e-9 ? -y / side : 1;
  return { x: dirX * radius, y: dirY * radius, angle, behind: angle > half, onTarget: angle <= ON_TARGET_ANGLE };
}

export interface SteeringCue {
  /** Screen direction to turn, radians (0 = right, PI/2 = down). */
  direction: number;
  /** 0..1: how much turning is left. */
  strength: number;
}

/** The arrow around the reticle: null when already on target. */
export function steeringCue(local: Vec3Tuple): SteeringCue | null {
  const point = compassPoint(local);
  if (point.onTarget) {
    return null;
  }
  return { direction: Math.atan2(point.y, point.x), strength: Math.min(1, Math.max(0.2, point.angle / (Math.PI / 3))) };
}

/** Seconds to reach something at `distance` closing at `closingSpeed`, or null when not closing. */
export function arrivalSeconds(distance: number, closingSpeed: number): number | null {
  return closingSpeed > 0.5 ? distance / closingSpeed : null;
}

/** `target` is whatever the pilot picked in the navigation computer (N). */
export type ObjectiveKind = 'threat' | 'job' | 'station' | 'home' | 'target';
export type ObjectiveMode = 'auto' | ObjectiveKind;

export const OBJECTIVE_ORDER: readonly ObjectiveMode[] = ['auto', 'threat', 'job', 'station', 'home'];

export const OBJECTIVE_NAME: Record<ObjectiveMode, string> = {
  auto: 'AUTO',
  threat: 'PRIORITY ROCK',
  job: 'JOB',
  station: 'NEAREST STATION',
  home: 'HOME (AEGIS)',
  target: 'NAV TARGET',
};

export interface ObjectiveOptions {
  threat: boolean;
  job: boolean;
  station: boolean;
  home: boolean;
  /** A target picked in the navigation computer still exists. */
  target?: boolean;
  /** Something is on the tow line, or a crew is aboard: the job in hand comes before anything else. */
  committed?: boolean;
  /** Low fuel or hull, or out of missiles. */
  needsHome: boolean;
}

/** What the game would point at by itself. */
export function autoObjective(options: ObjectiveOptions): ObjectiveKind | null {
  if (options.committed && options.job) {
    return 'job';
  }
  if (options.needsHome && options.home) {
    return 'home';
  }
  if (options.threat) {
    return 'threat';
  }
  if (options.job) {
    return 'job';
  }
  return null;
}

/** The objective in use: the pilot's choice while it exists, otherwise the automatic one. */
export function resolveObjective(mode: ObjectiveMode, options: ObjectiveOptions): ObjectiveKind | null {
  if (mode !== 'auto' && options[mode] === true) {
    return mode;
  }
  return autoObjective(options);
}

/** G: the next mode that has something to point at (auto always does). */
export function nextObjectiveMode(mode: ObjectiveMode, options: ObjectiveOptions): ObjectiveMode {
  const start = OBJECTIVE_ORDER.indexOf(mode);
  for (let step = 1; step <= OBJECTIVE_ORDER.length; step += 1) {
    const candidate = OBJECTIVE_ORDER[(start + step) % OBJECTIVE_ORDER.length];
    if (candidate === 'auto' || options[candidate] === true) {
      return candidate;
    }
  }
  return 'auto';
}

export type ScannerMode = 'auto' | 'close' | 'medium' | 'far';
export const SCANNER_MODES: readonly ScannerMode[] = ['auto', 'close', 'medium', 'far'];
/** Scanner ranges in world units: close for fighting, medium for the station band. */
export const SCANNER_LEVELS = { close: 70, medium: 180 } as const;

/**
 * The scanner's range. Auto zooms to the smallest level that still shows
 * the objective with a margin, so nearby things are not squeezed into the
 * centre; with no objective it shows everything it can.
 */
export function scannerRange(mode: ScannerMode, fullRange: number, objectiveDistance: number | null): number {
  if (mode === 'close') {
    return Math.min(SCANNER_LEVELS.close, fullRange);
  }
  if (mode === 'medium') {
    return Math.min(SCANNER_LEVELS.medium, fullRange);
  }
  if (mode === 'far' || objectiveDistance === null) {
    return fullRange;
  }
  const wanted = objectiveDistance * 1.25;
  if (wanted <= SCANNER_LEVELS.close) {
    return Math.min(SCANNER_LEVELS.close, fullRange);
  }
  return wanted <= SCANNER_LEVELS.medium ? Math.min(SCANNER_LEVELS.medium, fullRange) : fullRange;
}
