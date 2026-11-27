import { describe, expect, it } from 'vitest';
import { STATION_IMPACT_DAMAGE, applyStationDamage, stationCondition, stationService } from './stationDamage';

describe('station damage', () => {
  it('lets the shield absorb a small rock completely', () => {
    expect(applyStationDamage({ shield: 100, health: 100 }, STATION_IMPACT_DAMAGE.small)).toEqual({ shield: 88, health: 100 });
  });

  it('passes what the shield cannot hold to the structure', () => {
    expect(applyStationDamage({ shield: 100, health: 100 }, STATION_IMPACT_DAMAGE.large)).toEqual({ shield: 0, health: 90 });
    expect(applyStationDamage({ shield: 0, health: 40 }, 45)).toEqual({ shield: 0, health: 0 });
  });

  it('destroys even a fresh station when a giant hits it', () => {
    expect(stationCondition(applyStationDamage({ shield: 100, health: 100 }, STATION_IMPACT_DAMAGE.giant).health)).toBe('destroyed');
  });

  it('degrades service in stages', () => {
    expect(stationService(80)).toEqual({ rate: 1, missiles: true });
    expect(stationService(50)).toEqual({ rate: 0.5, missiles: true });
    expect(stationService(20)).toEqual({ rate: 0.3, missiles: false });
    expect(stationService(0)).toEqual({ rate: 0, missiles: false });
  });
});
