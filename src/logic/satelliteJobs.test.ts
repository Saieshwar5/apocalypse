import { describe, expect, it } from 'vitest';
import { closestApproach } from './ballistics';
import { dodgeApproach, satelliteJobPay } from './satelliteJobs';
import { PLANET_RADIUS } from './units';

describe('satellite dodge threat', () => {
  it('reaches the satellite position at the planned time', () => {
    const target: [number, number, number] = [30, 40, 20];
    const { position, velocity } = dodgeApproach(target, [0.3, -1, 0.5], 4, 40);
    for (let axis = 0; axis < 3; axis += 1) {
      expect(position[axis] + velocity[axis] * 40).toBeCloseTo(target[axis], 6);
    }
    expect(Math.hypot(...velocity)).toBeCloseTo(4, 6);
  });

  it('never threatens the planet', () => {
    for (const seed of [[1, 0, 0], [0, 1, 0], [0.2, 0.3, -0.9]] as [number, number, number][]) {
      const target: [number, number, number] = [0, 52, 0];
      const { position, velocity } = dodgeApproach(target, seed, 4, 40);
      const pass = closestApproach([-position[0], -position[1], -position[2]], [-velocity[0], -velocity[1], -velocity[2]]);
      expect(pass.distance).toBeGreaterThan(PLANET_RADIUS + 5);
    }
  });
});

describe('satellite job pay', () => {
  it('pays in full for exact placement and less at the edge of the zone', () => {
    expect(satelliteJobPay(480, 0)).toBe(480);
    expect(satelliteJobPay(480, null)).toBe(480);
    expect(satelliteJobPay(480, 6)).toBe(335);
  });
});
