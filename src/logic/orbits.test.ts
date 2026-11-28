import { describe, expect, it } from 'vitest';
import { FIELD_START, ORBIT_TIERS, orbitTierAt, orbitTransfers, tierRadius } from './orbits';
import { ORBIT_BANDS } from './satellites';
import { OUTPOST_ORBITS } from './stations';
import { ATMOSPHERE } from './atmosphere';
import { PLANET_RADIUS } from './units';

describe('the three orbits', () => {
  it('stacks low, medium and high with clear space between them', () => {
    expect(ORBIT_TIERS.low.minRadius).toBeGreaterThan(PLANET_RADIUS + ATMOSPHERE.warning - 5);
    expect(ORBIT_TIERS.medium.minRadius - ORBIT_TIERS.low.maxRadius).toBeGreaterThan(20);
    expect(ORBIT_TIERS.high.minRadius - ORBIT_TIERS.medium.maxRadius).toBeGreaterThan(40);
  });

  it('starts every rock beyond high orbit', () => {
    expect(FIELD_START[0]).toBeGreaterThan(ORBIT_TIERS.high.maxRadius + 50);
  });

  it('names the tier for a height, taking the nearest band in the gaps', () => {
    expect(orbitTierAt(ORBIT_TIERS.low.minRadius + 2)).toBe('low');
    expect(orbitTierAt(PLANET_RADIUS * 2)).toBe('medium');
    expect(orbitTierAt(PLANET_RADIUS * 3.6)).toBe('high');
    expect(orbitTierAt(PLANET_RADIUS + 1)).toBe('low');
    expect(orbitTierAt(PLANET_RADIUS * 9)).toBe('high');
  });

  it('puts satellites in all three: weather low, navigation in the middle, relays high', () => {
    expect(ORBIT_BANDS.map((band) => orbitTierAt((band.minRadius + band.maxRadius) / 2))).toEqual(['low', 'medium', 'high']);
    expect(ORBIT_BANDS.map((band) => [...new Set(band.kinds)])).toEqual([['weather'], ['nav'], ['comms']]);
  });

  it('spreads the stations over all three', () => {
    expect(orbitTierAt(OUTPOST_ORBITS.vulcan.radius)).toBe('low');
    expect(orbitTierAt(OUTPOST_ORBITS.ceres.radius)).toBe('medium');
    expect(orbitTierAt(OUTPOST_ORBITS.halo.radius)).toBe('high');
  });
});

describe('orbit transfers', () => {
  it('lists all three orbits from wherever the ship is, saying which way each lies', () => {
    const ways = (position: [number, number, number]) => orbitTransfers(position).map((transfer) => transfer.way);
    expect(ways([tierRadius('low'), 0, 0])).toEqual(['here', 'climb', 'climb']);
    expect(ways([0, tierRadius('medium'), 0])).toEqual(['descend', 'here', 'climb']);
    expect(ways([0, 0, -tierRadius('high')])).toEqual(['descend', 'descend', 'here']);
    // Half way up, nothing has dropped out of the list.
    expect(ways([150, 0, 0])).toEqual(['descend', 'descend', 'climb']);
  });

  it('aims straight up or down from the ship, at the middle of the orbit', () => {
    const [, toMedium] = orbitTransfers([0, tierRadius('low'), 0]);
    expect(toMedium.point[0]).toBeCloseTo(0);
    expect(toMedium.point[1]).toBeCloseTo(tierRadius('medium'));
    expect(toMedium.height).toBeCloseTo(tierRadius('medium') - tierRadius('low'));
  });

  it('offers nothing from the planet\'s centre', () => {
    expect(orbitTransfers([0, 0, 0])).toEqual([]);
  });
});
