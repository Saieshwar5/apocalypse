import { describe, expect, it } from 'vitest';
import {
  STATION_STOCK,
  deliverSupplies,
  dockingReadiness,
  drawFromStock,
  fuelBurned,
  thrustScale,
} from './stationSupply';

describe('fuel', () => {
  it('burns faster when boosting and not at all when coasting', () => {
    expect(fuelBurned(0, 0, false, 10)).toBe(0);
    expect(fuelBurned(1, 0, false, 10)).toBeCloseTo(6);
    expect(fuelBurned(1, 0, true, 10)).toBeCloseTo(24);
    expect(fuelBurned(-1, 1, false, 10)).toBeCloseTo(8);
  });

  it('leaves weak thrust with an empty tank so the ship is never stranded', () => {
    expect(thrustScale(40)).toBe(1);
    expect(thrustScale(0)).toBe(0.25);
  });
});

describe('docking', () => {
  it('needs the ship close and slow relative to the station', () => {
    expect(dockingReadiness(60, 1)).toBe('far');
    expect(dockingReadiness(15, 1)).toBe('too-fast');
    expect(dockingReadiness(6, 20)).toBe('too-fast');
    expect(dockingReadiness(6, 3)).toBe('ready');
  });
});

describe('station stock', () => {
  it('fills up to capacity from supply rockets', () => {
    expect(deliverSupplies({ fuel: 100, missiles: 2 })).toEqual({ fuel: 210, missiles: 8 });
    expect(deliverSupplies({ fuel: 390, missiles: 23 })).toEqual(STATION_STOCK.capacity);
  });

  it('never hands out more than it holds', () => {
    expect(drawFromStock(5, 12)).toBe(5);
    expect(drawFromStock(50, 12)).toBe(12);
    expect(drawFromStock(0, 12)).toBe(0);
  });
});
