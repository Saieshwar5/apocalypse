import { describe, expect, it } from 'vitest';
import { createSeededRandom } from './random';
import { chooseMaterial, planWave, waveComposition } from './waves';

describe('waveComposition', () => {
  it('starts with only small and medium asteroids', () => {
    expect(waveComposition(1)).toEqual({ small: 5, medium: 1, large: 0, giant: 0 });
  });

  it('adds a giant on every fifth wave', () => {
    expect(waveComposition(4).giant).toBe(0);
    expect(waveComposition(5).giant).toBe(1);
    expect(waveComposition(10).giant).toBe(1);
  });

  it('caps small asteroids so late waves stay readable', () => {
    expect(waveComposition(50).small).toBe(22);
  });

  it('rejects invalid wave numbers', () => {
    expect(() => waveComposition(0)).toThrow(RangeError);
    expect(() => waveComposition(1.5)).toThrow(RangeError);
  });
});

describe('chooseMaterial', () => {
  it('uses only rock in the first wave', () => {
    const rng = createSeededRandom(7);
    const materials = new Set(Array.from({ length: 200 }, () => chooseMaterial(1, rng)));
    expect(materials).toEqual(new Set(['rocky']));
  });

  it('introduces iron and ice in later waves', () => {
    const rng = createSeededRandom(7);
    const materials = new Set(Array.from({ length: 500 }, () => chooseMaterial(6, rng)));
    expect(materials).toEqual(new Set(['rocky', 'iron', 'ice']));
  });
});

describe('planWave', () => {
  it('is reproducible from the same seed', () => {
    expect(planWave(4, createSeededRandom(42))).toEqual(planWave(4, createSeededRandom(42)));
  });

  it('schedules every asteroid in the composition, in time order, within the wave', () => {
    const plan = planWave(5, createSeededRandom(3));
    const composition = waveComposition(5);
    const total = composition.small + composition.medium + composition.large + composition.giant;
    expect(plan.spawns).toHaveLength(total);
    expect(plan.hasGiant).toBe(true);
    for (let index = 1; index < plan.spawns.length; index += 1) {
      expect(plan.spawns[index].delaySeconds).toBeGreaterThanOrEqual(plan.spawns[index - 1].delaySeconds);
    }
    for (const spawn of plan.spawns) {
      expect(spawn.delaySeconds).toBeLessThanOrEqual(plan.durationSeconds);
      expect(Math.hypot(...spawn.direction)).toBeCloseTo(1, 6);
    }
  });
});
