import { describe, expect, it } from 'vitest';
import {
  blastDamage,
  closestApproach,
  interceptTime,
  laserRangeBand,
  laserRangeMultiplier,
  leadOffset,
} from './ballistics';
import {
  SHIELD_RECHARGE_DELAY,
  applyShipDamage,
  createDefenseState,
  rechargeShield,
} from './shipDefense';
import { formatCountdown, formatDistance, formatSpeed } from './units';

describe('laser range', () => {
  it('does full damage close in, less far away and nothing past its range', () => {
    expect(laserRangeMultiplier(5)).toBe(1);
    expect(laserRangeMultiplier(16)).toBe(1);
    expect(laserRangeMultiplier(30)).toBeCloseTo(0.675, 3);
    expect(laserRangeMultiplier(44)).toBe(0);
  });

  it('classifies range for the reticle', () => {
    expect(laserRangeBand(10)).toBe('optimal');
    expect(laserRangeBand(30)).toBe('reduced');
    expect(laserRangeBand(60)).toBe('out-of-range');
  });
});

describe('aiming ahead', () => {
  it('needs no lead for a stationary target', () => {
    expect(interceptTime([100, 0, 0], [0, 0, 0], 50)).toBeCloseTo(2, 6);
    expect(leadOffset([100, 0, 0], [0, 0, 0], 50)).toEqual([100, 0, 0]);
  });

  it('leads a crossing target so the bolt and the target arrive together', () => {
    const lead = leadOffset([100, 0, 0], [0, 10, 0], 50);
    expect(lead).not.toBeNull();
    const time = interceptTime([100, 0, 0], [0, 10, 0], 50) ?? 0;
    expect(lead?.[1]).toBeCloseTo(10 * time, 6);
    expect(Math.hypot(...(lead ?? [0, 0, 0]))).toBeCloseTo(50 * time, 6);
  });

  it('reports a target that outruns the projectile as unreachable', () => {
    expect(interceptTime([100, 0, 0], [80, 0, 0], 50)).toBeNull();
  });
});

describe('closestApproach', () => {
  it('finds when and how near a passing rock comes', () => {
    const pass = closestApproach([-30, 2, 0], [10, 0, 0]);
    expect(pass.time).toBeCloseTo(3, 6);
    expect(pass.distance).toBeCloseTo(2, 6);
  });

  it('uses the current distance for something moving away', () => {
    expect(closestApproach([30, 0, 0], [10, 0, 0])).toEqual({ time: 0, distance: 30 });
  });
});

describe('blast damage', () => {
  it('falls off with distance and stops at the blast radius', () => {
    expect(blastDamage(0, 5, 40)).toBe(40);
    expect(blastDamage(2.5, 5, 40)).toBe(20);
    expect(blastDamage(5, 5, 40)).toBe(0);
  });
});

describe('ship defence', () => {
  it('lets the shield absorb damage before the hull', () => {
    const first = applyShipDamage(createDefenseState(), 60);
    expect(first.state).toMatchObject({ shield: 40, hull: 100 });
    const second = applyShipDamage(first.state, 70);
    expect(second.absorbedByShield).toBe(40);
    expect(second.hullDamage).toBe(30);
    expect(second.state).toMatchObject({ shield: 0, hull: 70, secondsSinceDamage: 0 });
  });

  it('recharges the shield only after a quiet period, never the hull', () => {
    const hit = applyShipDamage(createDefenseState(), 150).state;
    const early = rechargeShield(hit, SHIELD_RECHARGE_DELAY - 0.5);
    expect(early.shield).toBe(0);
    const later = rechargeShield(early, 1.5);
    expect(later.shield).toBeGreaterThan(0);
    expect(later.hull).toBe(50);
  });
});

describe('units', () => {
  it('formats distances, speeds and countdowns for the HUD', () => {
    expect(formatDistance(75)).toBe('8,000 km');
    expect(formatDistance(1)).toBe('110 km');
    expect(formatSpeed(5)).toBe('19 km/s');
    expect(formatSpeed(1)).toBe('3.8 km/s');
    expect(formatCountdown(37.2)).toBe('0:38');
    expect(formatCountdown(83)).toBe('1:23');
  });
});
