/** A function returning a uniformly distributed number in [0, 1). */
export type RandomSource = () => number;

export type Vec3Tuple = [number, number, number];

/**
 * Small deterministic generator (mulberry32). Used so waves and asteroid
 * shapes can be reproduced from a seed, which the planned daily challenge
 * needs: every player must get the same pattern.
 */
export function createSeededRandom(seed: number): RandomSource {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomBetween(rng: RandomSource, min: number, max: number): number {
  return min + (max - min) * rng();
}

/** Uniformly distributed direction on the unit sphere. */
export function randomUnitVector(rng: RandomSource): Vec3Tuple {
  const z = rng() * 2 - 1;
  const angle = rng() * Math.PI * 2;
  const ring = Math.sqrt(1 - z * z);
  return [ring * Math.cos(angle), ring * Math.sin(angle), z];
}

export function normalizeTuple(vector: Vec3Tuple): Vec3Tuple {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (length === 0) {
    return [0, 1, 0];
  }
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}
