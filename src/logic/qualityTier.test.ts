import { describe, expect, it } from 'vitest';
import { AUTO_QUALITY, createSampler, effectiveQuality, sampleFrame } from './qualityTier';

function run(frameSeconds: number, seconds: number) {
  const sampler = createSampler();
  const results: (string | null)[] = [];
  for (let time = 0; time < seconds; time += frameSeconds) {
    results.push(sampleFrame(sampler, frameSeconds));
  }
  return results.filter((result) => result !== null);
}

describe('automatic graphics quality', () => {
  it('keeps high quality on a fast computer', () => {
    expect(run(1 / 60, 20)).toEqual([]);
  });

  it('drops to low once on a slow computer, after warming up', () => {
    expect(run(1 / 20, 20)).toEqual(['low']);
    const sampler = createSampler();
    expect(sampleFrame(sampler, AUTO_QUALITY.warmUpSeconds - 0.1)).toBeNull();
  });

  it('respects a quality the player chose', () => {
    expect(effectiveQuality('high', 'low')).toBe('high');
    expect(effectiveQuality('low', 'high')).toBe('low');
    expect(effectiveQuality('auto', 'low')).toBe('low');
  });
});
