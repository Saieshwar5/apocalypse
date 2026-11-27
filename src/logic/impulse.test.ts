import { describe, expect, it } from 'vitest';
import { asteroidMass, deflectionScore, hitSpeedChange } from './impulse';

describe('hit impulses', () => {
  it('moves heavy asteroids far less than light ones', () => {
    expect(asteroidMass(2)).toBe(8);
    expect(hitSpeedChange('missile', 4.6)).toBeCloseTo(0.308, 2);
    expect(hitSpeedChange('missile', 2.2)).toBeGreaterThan(hitSpeedChange('missile', 4.6));
  });

  it('caps the shove on tiny rocks and makes lasers negligible on big ones', () => {
    expect(hitSpeedChange('missile', 0.4)).toBe(2.5);
    expect(hitSpeedChange('laser', 4.6)).toBeLessThan(0.01);
  });

  it('pushes a loose rubble pile much further than iron of the same size', () => {
    expect(hitSpeedChange('missile', 5, 0.2)).toBeGreaterThan(hitSpeedChange('missile', 5, 2.6) * 10);
  });

  it('pays less for a deflection than a kill', () => {
    expect(deflectionScore(500)).toBe(375);
  });
});
