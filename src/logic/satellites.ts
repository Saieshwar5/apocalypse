import { randomBetween, type RandomSource, type Vec3Tuple } from './random';

export type SatelliteKind = 'comms' | 'nav' | 'weather';

/** Hull damage to the ship for flying into an intact satellite. */
export const SATELLITE_COLLISION_DAMAGE = 35;
/** Hull damage per second while the ship is inside a debris cloud. */
export const DEBRIS_DAMAGE_PER_SECOND = 20;
/** Score taken away when the player (not an asteroid) destroys a satellite. */
export const SATELLITE_LOSS_PENALTY = 150;

/** Scanner range multiplier with every satellite working. */
const FULL_FLEET_RANGE_BONUS = 1.25;

/**
 * Satellites relay tracking data, so the scanner sees further the more of
 * them survive: from 1.0 (none left) to 1.25 (all alive), in proportion.
 * A fleet of zero gives no bonus rather than dividing by zero.
 */
export function scannerRangeBonus(aliveCount: number, total: number): number {
  if (!(total > 0) || !(aliveCount > 0)) {
    return 1;
  }
  const share = Math.min(aliveCount / total, 1);
  return 1 + (FULL_FLEET_RANGE_BONUS - 1) * share;
}

/** A circular orbit around the origin. Angles are in radians, the period in seconds. */
export interface CircularOrbit {
  radius: number;
  period: number;
  /** Tilt of the orbit plane away from the planet's equator (the XZ plane). */
  inclination: number;
  /** Direction, around the Y axis, of the line where the orbit crosses the equator. */
  ascendingNode: number;
  /** Angle along the orbit at time zero, measured from the ascending node. */
  phase: number;
}

export interface OrbitState {
  position: Vec3Tuple;
  velocity: Vec3Tuple;
}

/** Where a body on `orbit` is, and how it is moving, `seconds` after time zero. */
export function orbitState(orbit: CircularOrbit, seconds: number): OrbitState {
  const rate = (Math.PI * 2) / orbit.period;
  const angle = orbit.phase + rate * seconds;
  const cosNode = Math.cos(orbit.ascendingNode);
  const sinNode = Math.sin(orbit.ascendingNode);
  const cosTilt = Math.cos(orbit.inclination);
  const sinTilt = Math.sin(orbit.inclination);
  // Two perpendicular unit vectors spanning the orbit plane: one along the
  // ascending node, one a quarter turn further along the orbit.
  const node: Vec3Tuple = [cosNode, 0, sinNode];
  const quarter: Vec3Tuple = [-sinNode * cosTilt, sinTilt, cosNode * cosTilt];
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const speed = orbit.radius * rate;
  return {
    position: [
      orbit.radius * (node[0] * cos + quarter[0] * sin),
      orbit.radius * (node[1] * cos + quarter[1] * sin),
      orbit.radius * (node[2] * cos + quarter[2] * sin),
    ],
    velocity: [
      speed * (quarter[0] * cos - node[0] * sin),
      speed * (quarter[1] * cos - node[1] * sin),
      speed * (quarter[2] * cos - node[2] * sin),
    ],
  };
}

const REFERENCE_RADIUS = 48;
const REFERENCE_PERIOD = 260;
/**
 * Real orbits follow period ∝ radius^1.5, which would make the far
 * satellites take over ten minutes and look frozen. A gentler exponent keeps
 * "higher is slower" while every orbit stays between about 90 and 400 s.
 */
const PERIOD_EXPONENT = 1.1;

export function orbitalPeriod(radius: number): number {
  return REFERENCE_PERIOD * Math.pow(radius / REFERENCE_RADIUS, PERIOD_EXPONENT);
}

export interface OrbitBand {
  minRadius: number;
  maxRadius: number;
  /** One satellite of each listed kind flies in this band. */
  kinds: readonly SatelliteKind[];
}

/**
 * The fleet: three low and fast, three at medium height, two far and slow
 * (the planet's radius is 10). Kinds follow real practice loosely: imaging
 * and weather low, navigation in the middle, relays far out.
 */
export const ORBIT_BANDS: readonly OrbitBand[] = [
  { minRadius: 48, maxRadius: 53, kinds: ['weather', 'comms', 'weather'] },
  { minRadius: 60, maxRadius: 74, kinds: ['nav', 'weather', 'nav'] },
  { minRadius: 90, maxRadius: 110, kinds: ['comms', 'nav'] },
];

export interface SatellitePlan {
  kind: SatelliteKind;
  orbit: CircularOrbit;
}

/** Lays out a fresh fleet. The same `rng` sequence gives the same fleet. */
export function planFleet(rng: RandomSource, bands: readonly OrbitBand[] = ORBIT_BANDS): SatellitePlan[] {
  const plans: SatellitePlan[] = [];
  for (const band of bands) {
    const count = band.kinds.length;
    const step = (band.maxRadius - band.minRadius) / count;
    const startPhase = rng() * Math.PI * 2;
    band.kinds.forEach((kind, index) => {
      // Each satellite gets its own slice of the band's heights and its own
      // third (or half) of the circle, so a band never starts bunched up.
      const radius = randomBetween(rng, band.minRadius + step * index, band.minRadius + step * (index + 1));
      plans.push({
        kind,
        orbit: {
          radius,
          period: orbitalPeriod(radius),
          inclination: randomBetween(rng, 0.15, 1.35),
          ascendingNode: rng() * Math.PI * 2,
          phase: startPhase + ((index + randomBetween(rng, -0.2, 0.2)) / count) * Math.PI * 2,
        },
      });
    });
  }
  return plans;
}

/**
 * Where along the segment from `start` to `end` (0 to 1) it first touches a
 * sphere, or null when it misses. A segment that starts inside the sphere
 * hits at 0, so a fast bolt cannot tunnel out of a satellite it spawned in.
 */
export function segmentSphereHit(start: Vec3Tuple, end: Vec3Tuple, centre: Vec3Tuple, radius: number): number | null {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const dz = end[2] - start[2];
  const fx = start[0] - centre[0];
  const fy = start[1] - centre[1];
  const fz = start[2] - centre[2];
  const c = fx * fx + fy * fy + fz * fz - radius * radius;
  if (c <= 0) {
    return 0;
  }
  const a = dx * dx + dy * dy + dz * dz;
  if (a === 0) {
    return null;
  }
  const b = fx * dx + fy * dy + fz * dz;
  const discriminant = b * b - a * c;
  if (b >= 0 || discriminant < 0) {
    // Moving away from the sphere, or the line never reaches it.
    return null;
  }
  const t = (-b - Math.sqrt(discriminant)) / a;
  return t <= 1 ? t : null;
}

/** Call-sign prefixes and names, in fleet order, so every satellite can be told apart. */
const CALL_SIGNS: Record<SatelliteKind, { prefix: string; names: readonly string[] }> = {
  weather: { prefix: 'WX', names: ['NIMBUS', 'CIRRUS', 'STRATUS', 'CUMULUS'] },
  nav: { prefix: 'NAV', names: ['POLARIS', 'RIGEL', 'ALTAIR', 'DENEB'] },
  comms: { prefix: 'COM', names: ['ECHO', 'RELAY', 'TELSTAR', 'MERCURY'] },
};

/**
 * Unique names for a fleet laid out in order: the third weather satellite
 * is "WX-3 STRATUS". Contracts, labels, the scanner and the radio all use them.
 */
export function satelliteNames(kinds: readonly SatelliteKind[]): string[] {
  const counts: Partial<Record<SatelliteKind, number>> = {};
  return kinds.map((kind) => {
    const index = counts[kind] ?? 0;
    counts[kind] = index + 1;
    const { prefix, names } = CALL_SIGNS[kind];
    return `${prefix}-${index + 1} ${names[index % names.length]}`;
  });
}
