import { describe, expect, it } from 'vitest';
import { EVIDENCE_SECTOR, SEASON_ONE, beatForSector, storyEnding } from './story';
import { buildOrbitPlan } from './orbitPlan';

describe('season one', () => {
  it('tells its beats in order, inside the 14 sectors', () => {
    const sectors = SEASON_ONE.map((beat) => beat.sector);
    expect(sectors).toEqual([...sectors].sort((a, b) => a - b));
    expect(Math.max(...sectors)).toBeLessThan(buildOrbitPlan().length);
    expect(beatForSector(0)?.speaker).toBe('control');
    expect(beatForSector(1)).toBeNull();
  });

  it('brings in the people of the great stations', () => {
    const speakers = new Set(SEASON_ONE.map((beat) => beat.speaker));
    expect(speakers.has('farwatch')).toBe(true);
    expect(speakers.has('meridian')).toBe(true);
  });

  it('finds the strange rock in a calm sector, so there is time to tow it', () => {
    expect(buildOrbitPlan()[EVIDENCE_SECTOR].kind).toBe('calm');
  });

  it('ends differently for each way the story can stand', () => {
    const endings = (['rock-found', 'proof-held', 'gave-to-authority', 'sold-to-company'] as const).map(storyEnding);
    expect(new Set(endings).size).toBe(4);
    expect(storyEnding('unaware')).toBe('');
  });
});
