import { describe, expect, it } from 'vitest';
import { isEngaged } from './engagement';

const base = { hasTarget: true, onScreen: true, rangeBand: 'optimal' as const, projectedRadius: 12 };

describe('close-in engagement', () => {
  it('starts when the target is on screen and within laser reach', () => {
    expect(isEngaged(base)).toBe(true);
    expect(isEngaged({ ...base, rangeBand: 'reduced' })).toBe(true);
  });

  it('does not start for a small target out of range', () => {
    expect(isEngaged({ ...base, rangeBand: 'out-of-range' })).toBe(false);
  });

  it('starts for a target that fills the view, even out of range', () => {
    expect(isEngaged({ ...base, rangeBand: 'out-of-range', projectedRadius: 60 })).toBe(true);
  });

  it('never starts without a target or with the target off screen', () => {
    expect(isEngaged({ ...base, hasTarget: false })).toBe(false);
    expect(isEngaged({ ...base, onScreen: false })).toBe(false);
  });
});
