import { describe, expect, it } from 'vitest';
import { asteroidHealth, fragmentsOnDestroy, weaponDamage } from './asteroidClasses';
import { applyPlanetDamage, impactDamage, integrityLevel } from './planetDamage';
import { destroyScore, waveClearBonus } from './scoring';

describe('planet damage', () => {
  it('scales with asteroid size so one small hit is not fatal', () => {
    expect(impactDamage('small', 'rocky')).toBe(1);
    expect(impactDamage('giant', 'rocky')).toBe(40);
    expect(impactDamage('medium', 'iron')).toBeGreaterThan(impactDamage('medium', 'rocky'));
  });

  it('never drops integrity below zero', () => {
    expect(applyPlanetDamage(10, 40)).toBe(0);
    expect(applyPlanetDamage(100, 6)).toBe(94);
    expect(() => applyPlanetDamage(100, -1)).toThrow(RangeError);
  });

  it('reports integrity levels for the HUD', () => {
    expect(integrityLevel(100)).toBe('stable');
    expect(integrityLevel(40)).toBe('damaged');
    expect(integrityLevel(10)).toBe('critical');
  });
});

describe('weapons against materials', () => {
  it('makes iron resist lasers but not missiles', () => {
    expect(weaponDamage(10, 'laser', 'iron')).toBe(2.5);
    expect(weaponDamage(100, 'missile', 'iron')).toBe(125);
    expect(asteroidHealth('medium', 'iron')).toBeGreaterThan(asteroidHealth('medium', 'rocky'));
  });

  it('splits large asteroids finished by a laser, but not by a missile', () => {
    expect(fragmentsOnDestroy('large', 'laser')).toEqual({ size: 'medium', count: 2 });
    expect(fragmentsOnDestroy('large', 'missile')).toBeNull();
    expect(fragmentsOnDestroy('small', 'laser')).toBeNull();
  });
});

describe('scoring', () => {
  it('rewards deep intercepts and missiles on big targets', () => {
    expect(destroyScore('small', 'laser', 20)).toBe(10);
    expect(destroyScore('small', 'laser', 80)).toBe(15);
    expect(destroyScore('giant', 'missile', 20)).toBe(625);
  });

  it('scales the wave bonus by the share destroyed and doubles it when Earth took no hits', () => {
    expect(waveClearBonus(3, 6, 2)).toBe(225);
    expect(waveClearBonus(3, 8, 0)).toBe(600);
  });

  it('gives no wave bonus to a pilot who destroyed nothing', () => {
    expect(waveClearBonus(4, 0, 12)).toBe(0);
    expect(waveClearBonus(4, 0, 0)).toBe(0);
  });
});
