import { orbitTierAt } from './orbits';
import { describe, expect, it } from 'vitest';
import { createSeededRandom } from './random';
import {
  ORBIT_BANDS,
  orbitState,
  orbitalPeriod,
  planFleet,
  scannerRangeBonus,
  segmentSphereHit,
  type CircularOrbit,
} from './satellites';

describe('scanner range bonus', () => {
  it('runs from 1.0 with no satellites to 1.25 with all of them', () => {
    expect(scannerRangeBonus(0, 8)).toBe(1);
    expect(scannerRangeBonus(8, 8)).toBe(1.25);
    expect(scannerRangeBonus(4, 8)).toBeCloseTo(1.125, 10);
    expect(scannerRangeBonus(2, 8)).toBeCloseTo(1.0625, 10);
  });

  it('never leaves that range on bad input', () => {
    expect(scannerRangeBonus(0, 0)).toBe(1);
    expect(scannerRangeBonus(3, 0)).toBe(1);
    expect(scannerRangeBonus(-2, 8)).toBe(1);
    expect(scannerRangeBonus(12, 8)).toBe(1.25);
    expect(scannerRangeBonus(Number.NaN, 8)).toBe(1);
  });
});

describe('circular orbits', () => {
  const orbit: CircularOrbit = { radius: 20, period: 200, inclination: 0.7, ascendingNode: 1.1, phase: 0.4 };

  it('stays at the orbit radius and moves at the orbital speed', () => {
    for (const seconds of [0, 13, 77, 150, 999]) {
      const { position, velocity } = orbitState(orbit, seconds);
      expect(Math.hypot(...position)).toBeCloseTo(20, 9);
      expect(Math.hypot(...velocity)).toBeCloseTo((2 * Math.PI * 20) / 200, 9);
      // Circular motion: velocity is always at right angles to the radius.
      expect(position[0] * velocity[0] + position[1] * velocity[1] + position[2] * velocity[2]).toBeCloseTo(0, 9);
    }
  });

  it('returns to the same place after one period', () => {
    const start = orbitState(orbit, 5).position;
    const later = orbitState(orbit, 205).position;
    later.forEach((value, axis) => expect(value).toBeCloseTo(start[axis], 9));
  });

  it('has a velocity that matches the change in position', () => {
    const step = 1e-4;
    const before = orbitState(orbit, 40 - step).position;
    const after = orbitState(orbit, 40 + step).position;
    const { velocity } = orbitState(orbit, 40);
    velocity.forEach((value, axis) => expect(value).toBeCloseTo((after[axis] - before[axis]) / (2 * step), 5));
  });

  it('keeps an equatorial orbit in the XZ plane and climbs as high as its inclination allows', () => {
    const flat = orbitState({ ...orbit, inclination: 0 }, 31);
    expect(flat.position[1]).toBeCloseTo(0, 12);
    // A quarter of an orbit after the ascending node is the highest point.
    const top = orbitState({ ...orbit, phase: 0 }, 50);
    expect(top.position[1]).toBeCloseTo(20 * Math.sin(0.7), 9);
  });
});

describe('fleet plan', () => {
  it('puts three satellites low, three at medium height and two far out', () => {
    const plans = planFleet(createSeededRandom(7));
    const radii = plans.map((plan) => plan.orbit.radius);
    expect(plans).toHaveLength(8);
    expect(radii.filter((radius) => orbitTierAt(radius) === 'low')).toHaveLength(3);
    expect(radii.filter((radius) => orbitTierAt(radius) === 'medium')).toHaveLength(3);
    expect(radii.filter((radius) => orbitTierAt(radius) === 'high')).toHaveLength(2);
    expect(new Set(plans.map((plan) => plan.kind))).toEqual(new Set(['comms', 'nav', 'weather']));
  });

  it('keeps every period watchable and slower with height', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      for (const { orbit } of planFleet(createSeededRandom(seed))) {
        expect(orbit.period).toBeGreaterThanOrEqual(240);
        expect(orbit.period).toBeLessThanOrEqual(1000);
        expect(orbit.period).toBeCloseTo(orbitalPeriod(orbit.radius), 10);
      }
    }
    expect(orbitalPeriod(110)).toBeGreaterThan(orbitalPeriod(48));
  });

  it('is reproducible from the seed and differs between seeds', () => {
    expect(planFleet(createSeededRandom(3))).toEqual(planFleet(createSeededRandom(3)));
    expect(planFleet(createSeededRandom(3))).not.toEqual(planFleet(createSeededRandom(4)));
  });

  it('returns nothing for an empty band list', () => {
    expect(planFleet(createSeededRandom(1), [])).toEqual([]);
    expect(ORBIT_BANDS.reduce((sum, band) => sum + band.kinds.length, 0)).toBe(8);
  });
});

describe('segment against a sphere', () => {
  it('reports where a segment first touches the sphere', () => {
    expect(segmentSphereHit([-5, 0, 0], [5, 0, 0], [0, 0, 0], 1)).toBeCloseTo(0.4, 10);
    expect(segmentSphereHit([0, 0, 10], [0, 0, 2], [0, 0, 0], 2)).toBeCloseTo(1, 10);
  });

  it('misses when the segment stops short, passes wide or points away', () => {
    expect(segmentSphereHit([-5, 0, 0], [-2, 0, 0], [0, 0, 0], 1)).toBeNull();
    expect(segmentSphereHit([-5, 1.5, 0], [5, 1.5, 0], [0, 0, 0], 1)).toBeNull();
    expect(segmentSphereHit([2, 0, 0], [9, 0, 0], [0, 0, 0], 1)).toBeNull();
  });

  it('counts a start inside the sphere as an immediate hit', () => {
    expect(segmentSphereHit([0.2, 0, 0], [9, 0, 0], [0, 0, 0], 1)).toBe(0);
  });

  it('treats a zero-length segment as a point test', () => {
    expect(segmentSphereHit([3, 0, 0], [3, 0, 0], [0, 0, 0], 1)).toBeNull();
    expect(segmentSphereHit([0.5, 0, 0], [0.5, 0, 0], [0, 0, 0], 1)).toBe(0);
  });
});

describe('satellite call signs', () => {
  it('gives every satellite its own name', async () => {
    const { satelliteNames } = await import('./satellites');
    const names = satelliteNames(['weather', 'comms', 'weather', 'nav', 'weather', 'nav', 'comms', 'nav']);
    expect(names).toEqual(['WX-1 NIMBUS', 'COM-1 ECHO', 'WX-2 CIRRUS', 'NAV-1 POLARIS', 'WX-3 STRATUS', 'NAV-2 RIGEL', 'COM-2 RELAY', 'NAV-3 ALTAIR']);
    expect(new Set(names).size).toBe(names.length);
  });
});
