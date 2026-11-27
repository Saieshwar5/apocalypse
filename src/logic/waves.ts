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

const MAX_SMALL_PER_WAVE = 22;

export function waveComposition(wave: number): Record<AsteroidSize, number> {
  assertWaveNumber(wave);
  return {
    small: Math.min(MAX_SMALL_PER_WAVE, 3 + wave * 2),
    medium: Math.floor((wave + 1) / 2),
    large: wave >= 3 ? Math.floor((wave - 1) / 2) : 0,
    giant: wave % 5 === 0 ? 1 : 0,
  };
}

/** Iron appears from wave 2 and ice from wave 3, each becoming more common. */
export function chooseMaterial(wave: number, rng: RandomSource): AsteroidMaterial {
  const ironChance = wave >= 2 ? Math.min(0.35, 0.12 + wave * 0.03) : 0;
  const iceChance = wave >= 3 ? Math.min(0.25, 0.1 + wave * 0.015) : 0;
  const roll = rng();
  if (roll < ironChance) {
    return 'iron';
  }
  if (roll < ironChance + iceChance) {
    return 'ice';
  }
  return 'rocky';
}

/**
 * Builds the spawn schedule for one wave. Asteroids come from one to three
 * main approach directions, so the radar shows clear attack fronts instead
 * of uniform noise.
 */
export function planWave(wave: number, rng: RandomSource): WavePlan {
  assertWaveNumber(wave);
  const composition = waveComposition(wave);
  const frontCount = 1 + (wave >= 3 ? 1 : 0) + (wave >= 7 ? 1 : 0);
  const fronts = Array.from({ length: frontCount }, () => randomUnitVector(rng));
  const durationSeconds = Math.min(70, 20 + wave * 4);
  const spawns: AsteroidSpawnPlan[] = [];

  for (const size of ASTEROID_SIZES) {
    for (let index = 0; index < composition[size]; index += 1) {
      const front = fronts[Math.floor(rng() * fronts.length)];
      spawns.push({
        // Giants come early so the player has time to fly out and meet them.
        delaySeconds: size === 'giant' ? durationSeconds * 0.2 : rng() * durationSeconds,
        size,
        material: size === 'giant' ? 'rocky' : chooseMaterial(wave, rng),
        direction: jitterDirection(front, 0.45, rng),
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
