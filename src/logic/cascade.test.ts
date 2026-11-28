import { describe, expect, it } from 'vitest';
import {
  CASCADE,
  SWEEP,
  cloudRadius,
  debrisDamageScale,
  dragRate,
  growthRate,
  orbitHealth,
  orbitThrough,
  shatterDebris,
  stepCloudMass,
  strikeChancePerSecond,
  sweptTonnes,
} from './cascade';
import { orbitState } from './satellites';
import { PLANET_RADIUS } from './units';

describe('debris from destroying rocks', () => {
  it('leaves debris when a rock is shattered inside the orbital band', () => {
    expect(shatterDebris('medium', 'laser', PLANET_RADIUS + 30)).toBe(CASCADE.shatter.medium);
  });

  it('leaves less with a missile, which vaporises most of it', () => {
    expect(shatterDebris('large', 'missile', PLANET_RADIUS + 30)).toBeCloseTo(CASCADE.shatter.large * CASCADE.missileShare);
  });

  it('leaves none far out, where fragments fly away, or very low, where they burn up', () => {
    expect(shatterDebris('giant', 'laser', CASCADE.bandOuterRadius + 1)).toBe(0);
    expect(shatterDebris('giant', 'laser', PLANET_RADIUS + 1)).toBe(0);
  });
});

describe('orbit health', () => {
  it('falls with debris and stays between 0 and 100', () => {
    expect(orbitHealth(25)).toBeCloseTo(100 - 25 * CASCADE.healthPerTonne, 6);
    expect(orbitHealth(25)).toBe(80);
    expect(orbitHealth(1000)).toBe(0);
  });

  it('starts the runaway only past the tipping point', () => {
    expect(growthRate(80)).toBe(0);
    expect(growthRate(CASCADE.tippingHealth)).toBe(0);
    expect(growthRate(10)).toBeGreaterThan(0);
    expect(growthRate(0)).toBeCloseTo(CASCADE.maxGrowthPerSecond);
  });

  it('lets drag clear low debris quickly and high debris slowly', () => {
    expect(dragRate(5)).toBeGreaterThan(dragRate(60) * 10);
    const low = stepCloudMass(10, 8, 90, 60);
    const high = stepCloudMass(10, 80, 90, 60);
    expect(low).toBeLessThan(high);
    expect(high).toBeLessThan(10);
  });

  it('makes a high cloud grow once orbit is past the Singularity point', () => {
    expect(stepCloudMass(10, 90, 5, 60)).toBeGreaterThan(10);
  });
});

describe('flying through debris', () => {
  it('is nearly harmless at a crawl and punishing at speed', () => {
    expect(debrisDamageScale(3)).toBe(0.1);
    expect(debrisDamageScale(30)).toBeGreaterThan(1);
  });

  it('sweeps debris only at gentle speeds, never more than is there', () => {
    expect(sweptTonnes(SWEEP.maxRelativeSpeed + 1, 10, 1)).toBe(0);
    expect(sweptTonnes(2, 10, 1)).toBeCloseTo(SWEEP.tonnesPerSecond);
    expect(sweptTonnes(2, 0.3, 1)).toBeCloseTo(0.3);
  });

  it('makes thicker clouds wider and deadlier to satellites', () => {
    expect(cloudRadius(20)).toBeGreaterThan(cloudRadius(2));
    expect(strikeChancePerSecond(20)).toBeGreaterThan(strikeChancePerSecond(2));
    expect(strikeChancePerSecond(1000)).toBe(0.5);
  });
});

describe('orbit through a point', () => {
  it('passes through the point, moving the way the debris was going', () => {
    for (const [position, velocity] of [
      [[50, 10, -20], [1, 4, 2]],
      [[0, 0, 70], [3, 0, 0]],
      [[-40, 30, 15], [0, -1, 5]],
    ] as [[number, number, number], [number, number, number]][]) {
      const orbit = orbitThrough(position, velocity);
      const state = orbitState(orbit, 0);
      for (let axis = 0; axis < 3; axis += 1) {
        expect(state.position[axis]).toBeCloseTo(position[axis], 6);
      }
      // Moving the same way round: angular momentum points the same way.
      const h1 = [position[1] * velocity[2] - position[2] * velocity[1], position[2] * velocity[0] - position[0] * velocity[2], position[0] * velocity[1] - position[1] * velocity[0]];
      const v = state.velocity;
      const h2 = [position[1] * v[2] - position[2] * v[1], position[2] * v[0] - position[0] * v[2], position[0] * v[1] - position[1] * v[0]];
      expect(h1[0] * h2[0] + h1[1] * h2[1] + h1[2] * h2[2]).toBeGreaterThan(0);
    }
  });

  it('copes with debris moving straight up', () => {
    const orbit = orbitThrough([0, 60, 0], [0, 5, 0]);
    expect(orbitState(orbit, 0).position[1]).toBeCloseTo(60, 6);
  });
});
