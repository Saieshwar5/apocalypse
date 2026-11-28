import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, DIFFICULTY, sanitizeDifficulty } from './difficulty';
import { buildOrbitPlan } from './orbitPlan';
import { applyPlanetDamage } from './planetDamage';

describe('difficulty levels', () => {
  it('leaves Standard exactly as the game was', () => {
    expect(DIFFICULTY.standard).toMatchObject({ planetDamage: 1, shipDamage: 1, pay: 1, waveShift: 0 });
  });

  it('orders the levels: each is harder on Earth and the ship, and pays more', () => {
    const [relaxed, standard, veteran] = DIFFICULTIES.map((level) => DIFFICULTY[level]);
    for (const key of ['planetDamage', 'shipDamage', 'pay'] as const) {
      expect(relaxed[key]).toBeLessThan(standard[key]);
      expect(standard[key]).toBeLessThan(veteran[key]);
    }
  });

  it('lets Earth take many more large impacts on Relaxed', () => {
    const impacts = (scale: number) => {
      let integrity = 100;
      let count = 0;
      while (integrity > 0) {
        integrity = applyPlanetDamage(integrity, 16 * scale);
        count += 1;
      }
      return count;
    };
    expect(impacts(DIFFICULTY.relaxed.planetDamage)).toBeGreaterThan(impacts(DIFFICULTY.standard.planetDamage));
    expect(impacts(DIFFICULTY.veteran.planetDamage)).toBeLessThan(impacts(DIFFICULTY.standard.planetDamage));
  });

  it('brings later, harder waves forward on Veteran but keeps 14 sectors and the final giant', () => {
    const standard = buildOrbitPlan(0);
    const veteran = buildOrbitPlan(DIFFICULTY.veteran.waveShift);
    expect(veteran).toHaveLength(standard.length);
    expect(veteran[1].wave).toBe(standard[1].wave + DIFFICULTY.veteran.waveShift);
    expect(veteran[veteran.length - 1].kind).toBe('giant');
  });

  it('treats an unknown stored value as Standard', () => {
    expect(sanitizeDifficulty('veteran')).toBe('veteran');
    expect(sanitizeDifficulty('impossible')).toBe('standard');
    expect(sanitizeDifficulty(undefined)).toBe('standard');
  });
});
