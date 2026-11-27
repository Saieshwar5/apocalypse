import {
  ASTEROID_SIZES,
  type AsteroidMaterial,
  type AsteroidSize,
} from './asteroidClasses';
import {
  normalizeTuple,
  randomUnitVector,
  type RandomSource,
  type Vec3Tuple,
} from './random';

export interface AsteroidSpawnPlan {
  delaySeconds: number;
  size: AsteroidSize;
  material: AsteroidMaterial;
  /** Unit vector from Earth's centre towards the spawn point. */
  direction: Vec3Tuple;
}

export interface WavePlan {
  wave: number;
  durationSeconds: number;
  hasGiant: boolean;
  spawns: AsteroidSpawnPlan[];
}

/**
 * Few asteroids, each one a job: the pilot has to fly to every rock, so a
 * field is a handful of contacts spread around the planet, not a swarm.
 */
const MAX_SMALL_PER_WAVE = 9;
const MAX_MEDIUM_PER_WAVE = 4;
const MAX_LARGE_PER_WAVE = 3;

export function waveComposition(wave: number): Record<AsteroidSize, number> {
  assertWaveNumber(wave);
  return {
    small: Math.min(MAX_SMALL_PER_WAVE, 2 + wave),
    medium: Math.min(MAX_MEDIUM_PER_WAVE, Math.floor((wave + 1) / 2)),
    large: wave >= 3 ? Math.min(MAX_LARGE_PER_WAVE, Math.floor((wave - 1) / 2)) : 0,
    giant: wave % 5 === 0 ? 1 : 0,
  };
}

/**
 * Light, loose types (rubble, carbon-rich) are present from the start; iron
 * appears from wave 2 and ice from wave 3, each becoming more common.
 */
export function chooseMaterial(wave: number, rng: RandomSource): AsteroidMaterial {
  const ironChance = wave >= 2 ? Math.min(0.3, 0.1 + wave * 0.03) : 0;
  const iceChance = wave >= 3 ? Math.min(0.2, 0.08 + wave * 0.015) : 0;
  const rubbleChance = 0.14;
  const carbonChance = 0.14;
  let roll = rng();
  for (const [material, chance] of [
    ['iron', ironChance],
    ['ice', iceChance],
    ['rubble', rubbleChance],
    ['carbon', carbonChance],
  ] as const) {
    if (roll < chance) {
      return material;
    }
    roll -= chance;
  }
  return 'rocky';
}

/** Share of extra asteroids per field that merely pass by and never threaten the planet. */
export const PASSER_BY_RATIO = 0.3;

/** Share of asteroids that arrive from a random direction instead of a front. */
const STRAGGLER_RATIO = 0.35;

/**
 * Builds the spawn schedule for one wave. Most asteroids come from two to
 * four approach directions around the planet and the rest from anywhere, so
 * the pilot has to read the scanner and choose where to fly.
 */
export function planWave(wave: number, rng: RandomSource): WavePlan {
  assertWaveNumber(wave);
  const composition = waveComposition(wave);
  const frontCount = 2 + (wave >= 4 ? 1 : 0) + (wave >= 8 ? 1 : 0);
  const fronts = Array.from({ length: frontCount }, () => randomUnitVector(rng));
  const durationSeconds = Math.min(120, 45 + wave * 6);
  const spawns: AsteroidSpawnPlan[] = [];

  for (const size of ASTEROID_SIZES) {
    for (let index = 0; index < composition[size]; index += 1) {
      const front = fronts[Math.floor(rng() * fronts.length)];
      spawns.push({
        // Giants come early so the player has time to fly out and meet them.
        delaySeconds: size === 'giant' ? durationSeconds * 0.2 : rng() * durationSeconds,
        size,
        material: size === 'giant' ? 'rocky' : chooseMaterial(wave, rng),
        direction: rng() < STRAGGLER_RATIO ? randomUnitVector(rng) : jitterDirection(front, 0.45, rng),
      });
    }
  }

  spawns.sort((a, b) => a.delaySeconds - b.delaySeconds);
  return { wave, durationSeconds, hasGiant: composition.giant > 0, spawns };
}

function jitterDirection(direction: Vec3Tuple, spread: number, rng: RandomSource): Vec3Tuple {
  const offset = randomUnitVector(rng);
  return normalizeTuple([
    direction[0] + offset[0] * spread,
    direction[1] + offset[1] * spread,
    direction[2] + offset[2] * spread,
  ]);
}

function assertWaveNumber(wave: number): void {
  if (!Number.isInteger(wave) || wave < 1) {
    throw new RangeError(`Wave must be a positive integer, received ${wave}`);
  }
}
