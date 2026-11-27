import { describe, expect, it } from 'vitest';
import { rankThreats, threatUrgency, timeToImpact } from './threats';

describe('timeToImpact', () => {
  it('measures time to the surface, not the centre', () => {
    expect(timeToImpact([100, 0, 0], [-10, 0, 0], 10)).toBeCloseTo(9, 6);
  });

  it('returns null for paths that miss or move away', () => {
    expect(timeToImpact([100, 20, 0], [-10, 0, 0], 10)).toBeNull();
    expect(timeToImpact([100, 0, 0], [10, 0, 0], 10)).toBeNull();
    expect(timeToImpact([100, 0, 0], [0, 0, 0], 10)).toBeNull();
  });

  it('returns zero once inside the planet radius', () => {
    expect(timeToImpact([5, 0, 0], [-1, 0, 0], 10)).toBe(0);
  });
});

describe('rankThreats', () => {
  it('puts the most damage per second of warning first and misses last', () => {
    const threats = [
      { id: 'far-giant', timeToImpact: 100, planetDamage: 40 },
      { id: 'near-small', timeToImpact: 2, planetDamage: 1 },
      { id: 'miss', timeToImpact: null, planetDamage: 16 },
      { id: 'mid-medium', timeToImpact: 10, planetDamage: 6 },
    ];
    expect(rankThreats(threats).map((threat) => threat.id)).toEqual([
      'mid-medium',
      'near-small',
      'far-giant',
      'miss',
    ]);
    expect(threats[0].id).toBe('far-giant');
    expect(threatUrgency({ timeToImpact: 0.2, planetDamage: 5 })).toBe(5);
  });
});
