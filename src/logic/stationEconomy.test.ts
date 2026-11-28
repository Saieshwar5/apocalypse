import { describe, expect, it } from 'vitest';
import { MARKETS, SHUTTLE, haulLoadMass, haulTonnes, planShuttle, unitPrice, type Stock } from './stationEconomy';
import type { StationId } from './stations';

const stocks = (overrides: Partial<Record<StationId, Partial<Stock>>> = {}): Record<StationId, Stock> => {
  const result = {} as Record<StationId, Stock>;
  for (const id of Object.keys(MARKETS) as StationId[]) {
    result[id] = { ...MARKETS[id].capacity, ...overrides[id] };
  }
  return result;
};

describe('prices', () => {
  it('follow stock: cheap when full, dear when nearly empty', () => {
    expect(unitPrice(2, 100, 100)).toBeCloseTo(1.4);
    expect(unitPrice(2, 0, 100)).toBeCloseTo(3.2);
    expect(unitPrice(2, 50, 100)).toBeCloseTo(2.3);
  });

  it('make Ceres the cheapest place for fuel', () => {
    const ceres = unitPrice(MARKETS.ceres.basePrice.fuel, MARKETS.ceres.start.fuel, MARKETS.ceres.capacity.fuel);
    const aegis = unitPrice(MARKETS.aegis.basePrice.fuel, MARKETS.aegis.start.fuel, MARKETS.aegis.capacity.fuel);
    expect(ceres).toBeLessThan(aegis);
  });
});

describe('shuttles', () => {
  it('stay home while every store is well stocked', () => {
    expect(planShuttle(stocks())).toBeNull();
  });

  it('carry from Ceres to the emptiest store', () => {
    const route = planShuttle(stocks({ vulcan: { parts: 5 }, halo: { fuel: 100 } }));
    expect(route).toEqual({ from: 'ceres', to: 'vulcan', good: 'parts', amount: SHUTTLE.capacity / 2 });
  });

  it('never take more than Ceres can spare or the store can hold', () => {
    const route = planShuttle(stocks({ halo: { fuel: 240 * 0.5 }, ceres: { fuel: 10 } }));
    expect(route?.amount).toBe(5);
    expect(planShuttle(stocks({ halo: { fuel: 0 }, ceres: { fuel: 2 } }))).toBeNull();
  });
});

describe('haul rocks', () => {
  it('weigh several tonnes and are heavy on the tow line', () => {
    expect(haulTonnes(1.1)).toBeGreaterThan(5);
    expect(haulLoadMass(6)).toBeGreaterThan(2);
    expect(haulLoadMass(0.5)).toBe(1);
  });
});
