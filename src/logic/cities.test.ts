import { describe, expect, it } from 'vitest';
import { CITY_IDS, WATCH_RANGE, cityLights, cityState, isCity, stepCity, supplyShare } from './cities';
import { orbitTierAt } from './orbits';
import { MARKETS } from './stationEconomy';
import { OUTPOST_ORBITS } from './stations';

describe('the three great stations', () => {
  it('puts one in each orbit: Anchor low, Meridian in the middle, Farwatch high', () => {
    expect(orbitTierAt(OUTPOST_ORBITS.anchor.radius)).toBe('low');
    expect(orbitTierAt(OUTPOST_ORBITS.meridian.radius)).toBe('medium');
    expect(orbitTierAt(OUTPOST_ORBITS.farwatch.radius)).toBe('high');
    expect(CITY_IDS.every(isCity)).toBe(true);
    expect(isCity('vulcan')).toBe(false);
  });

  it('judges supply by the emptier store', () => {
    const capacity = MARKETS.meridian.capacity;
    expect(supplyShare('meridian', capacity)).toBe(1);
    expect(supplyShare('meridian', { fuel: capacity.fuel, parts: capacity.parts * 0.2 })).toBeCloseTo(0.2);
    expect(supplyShare('meridian', { fuel: 0, parts: capacity.parts })).toBe(0);
  });

  it('names the state and dims the lights as supply falls', () => {
    expect([0.8, 0.4, 0.2, 0.05].map(cityState)).toEqual(['thriving', 'steady', 'short', 'failing']);
    expect(cityLights(1)).toBe(1);
    expect(cityLights(0.2)).toBeLessThan(cityLights(0.5));
    expect(cityLights(0)).toBeGreaterThan(0);
  });

  it('lets a supplied Farwatch see further and a starved one less', () => {
    expect(WATCH_RANGE.thriving).toBeGreaterThan(WATCH_RANGE.steady);
    expect(WATCH_RANGE.failing).toBeLessThan(WATCH_RANGE.short);
  });

  it('uses up Meridian\'s stores, never below empty', () => {
    const after = stepCity('meridian', { fuel: 100, parts: 10 }, 60);
    expect(after.fuel).toBeLessThan(100);
    expect(after.parts).toBeLessThan(10);
    expect(stepCity('meridian', { fuel: 1, parts: 1 }, 1e6)).toEqual({ fuel: 0, parts: 0 });
  });

  it('has Anchor lift fuel from Earth while it has parts, and stop when it has none', () => {
    expect(stepCity('anchor', { fuel: 100, parts: 20 }, 60).fuel).toBeGreaterThan(100);
    expect(stepCity('anchor', { fuel: 100, parts: 0 }, 60).fuel).toBe(100);
    expect(stepCity('anchor', { fuel: MARKETS.anchor.capacity.fuel, parts: 20 }, 60).fuel).toBe(MARKETS.anchor.capacity.fuel);
  });

  it('keeps a city going for minutes, not seconds, on its starting stores', () => {
    for (const city of CITY_IDS) {
      const after = stepCity(city, { ...MARKETS[city].start }, 240);
      expect(supplyShare(city, after)).toBeGreaterThan(0.05);
    }
  });
});
