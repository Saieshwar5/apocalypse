import { describe, expect, it } from 'vitest';
import { CARGO, cargoParSeconds, cargoPay, neediest, planCargo, type CargoKind } from './cargo';
import { MARKETS, type Stock } from './stationEconomy';
import type { StationId } from './stations';

const ALL: StationId[] = ['aegis', 'vulcan', 'ceres', 'halo'];
const full = (): Record<StationId, Stock> => ({
  aegis: { ...MARKETS.aegis.capacity },
  vulcan: { ...MARKETS.vulcan.capacity },
  ceres: { ...MARKETS.ceres.capacity },
  halo: { ...MARKETS.halo.capacity },
});
const fixed = (...values: number[]) => {
  let index = 0;
  return () => values[index++ % values.length];
};

describe('cargo pay', () => {
  it('pays more for a longer trip and for an emptier station', () => {
    const near = cargoPay({ kind: 'routine', distance: 60, shortage: 0.2 });
    expect(cargoPay({ kind: 'routine', distance: 180, shortage: 0.2 })).toBeGreaterThan(near);
    expect(cargoPay({ kind: 'routine', distance: 60, shortage: 0.9 })).toBeGreaterThan(near);
  });

  it('pays urgent, fragile and passenger runs above routine ones', () => {
    const routine = cargoPay({ kind: 'routine', distance: 120, shortage: 0.5 });
    for (const kind of ['urgent', 'fragile', 'passengers'] as CargoKind[]) {
      expect(cargoPay({ kind, distance: 120, shortage: 0.5 })).toBeGreaterThan(routine);
    }
  });

  it('halves a late urgent load but still pays it', () => {
    const onTime = cargoPay({ kind: 'urgent', distance: 120, shortage: 0.5 });
    const late = cargoPay({ kind: 'urgent', distance: 120, shortage: 0.5, late: true });
    expect(late).toBeGreaterThan(0);
    expect(late).toBeLessThanOrEqual(onTime * CARGO.lateShare + 5);
  });

  it('docks a fragile load per knock, down to a floor', () => {
    const clean = cargoPay({ kind: 'fragile', distance: 100, shortage: 0 });
    const two = cargoPay({ kind: 'fragile', distance: 100, shortage: 0, knocks: 2 });
    const wrecked = cargoPay({ kind: 'fragile', distance: 100, shortage: 0, knocks: 20 });
    expect(two).toBeLessThan(clean);
    expect(wrecked).toBeGreaterThanOrEqual(Math.floor(clean * CARGO.fragileFloor) - 5);
    expect(cargoPay({ kind: 'routine', distance: 100, shortage: 0, knocks: 5 })).toBe(cargoPay({ kind: 'routine', distance: 100, shortage: 0 }));
  });

  it('pays more with a cargo pod fitted', () => {
    expect(cargoPay({ kind: 'routine', distance: 100, shortage: 0.5, moduleRate: 1.4 })).toBeGreaterThan(cargoPay({ kind: 'routine', distance: 100, shortage: 0.5 }));
  });

  it('gives a longer trip a longer clock', () => {
    expect(cargoParSeconds(200)).toBeGreaterThan(cargoParSeconds(60));
    expect(cargoParSeconds(0)).toBe(30);
  });
});

describe('cargo planning', () => {
  it('finds the station shortest of a good, never the depot', () => {
    const stocks = full();
    stocks.halo.parts = 2;
    stocks.ceres.fuel = 0;
    expect(neediest(stocks, ALL)).toMatchObject({ station: 'halo', good: 'parts' });
  });

  it('sends a routine load from Ceres to the shortest station, sized to fit', () => {
    const stocks = full();
    stocks.vulcan.fuel = 170;
    const plan = planCargo(stocks, ALL, ['routine'], fixed(0));
    expect(plan).toMatchObject({ kind: 'routine', from: 'ceres', to: 'vulcan', good: 'fuel', units: 30 });
    expect(plan?.shortage).toBeCloseTo(0.15);
  });

  it('offers nothing when every store is full, or the depot is empty', () => {
    expect(planCargo(full(), ALL, ['routine'], fixed(0))).toBeNull();
    const stocks = full();
    stocks.halo.parts = 0;
    stocks.ceres.parts = 4;
    expect(planCargo(stocks, ALL, ['routine'], fixed(0))).toBeNull();
  });

  it('leaves Aegis out once it is gone', () => {
    const stocks = full();
    stocks.aegis.fuel = 0;
    stocks.halo.fuel = 100;
    expect(planCargo(stocks, ['vulcan', 'ceres', 'halo'], ['routine'], fixed(0))?.to).toBe('halo');
  });

  it('carries passengers to or from Halo and instruments to or from Vulcan Yard', () => {
    const people = planCargo(full(), ALL, ['passengers'], fixed(0, 0, 0.9));
    expect(people).toMatchObject({ kind: 'passengers', good: 'people', units: 0 });
    expect([people?.from, people?.to]).toContain('halo');
    const fragile = planCargo(full(), ALL, ['fragile'], fixed(0, 0, 0.1));
    expect(fragile).toMatchObject({ kind: 'fragile', good: 'instruments', from: 'vulcan' });
  });

  it('only offers kinds the pilot may fly', () => {
    const stocks = full();
    stocks.halo.fuel = 0;
    for (let roll = 0; roll < 1; roll += 0.1) {
      expect(planCargo(stocks, ALL, ['routine'], fixed(roll))?.kind).toBe('routine');
    }
    expect(planCargo(stocks, ALL, [], fixed(0))).toBeNull();
  });
});
