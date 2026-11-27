import { describe, expect, it } from 'vitest';
import { parseRuns, recordRun, shareText, type RunRecord } from './bestRuns';
import { STAR_SYSTEMS, nextSystem } from './starSystems';

const run = (score: number, victory = false): RunRecord => ({
  score,
  planet: 'Earth',
  victory,
  stars: 2,
  citiesStanding: 9,
  cityCount: 11,
  date: '2026-11-27',
});

describe('best runs', () => {
  it('keeps the five best, highest first', () => {
    let runs: RunRecord[] = [];
    for (const score of [300, 900, 100, 700, 500, 800]) {
      runs = recordRun(runs, run(score));
    }
    expect(runs.map((entry) => entry.score)).toEqual([900, 800, 700, 500, 300]);
  });

  it('ignores stored data that is missing or malformed', () => {
    expect(parseRuns(null)).toEqual([]);
    expect(parseRuns('not json')).toEqual([]);
    expect(parseRuns('{"score":1}')).toEqual([]);
    expect(parseRuns(JSON.stringify([run(5), { score: 'x' }, null]))).toEqual([run(5)]);
  });

  it('writes a result line for sharing', () => {
    expect(shareText(run(17580, true))).toBe("Singularity: I held Earth's orbit ★★☆ with 17,580 points and 9 of 11 cities standing.");
    expect(shareText(run(1200))).toContain('lost Earth');
  });
});

describe('star systems', () => {
  it('starts at Earth and gets harder', () => {
    expect(STAR_SYSTEMS[0].planet).toBe('Earth');
    expect(nextSystem(0)?.difficulty).toBeGreaterThan(STAR_SYSTEMS[0].difficulty);
    expect(nextSystem(STAR_SYSTEMS.length - 1)).toBeNull();
  });

  it('gives every system cities, a launch site and a radar', () => {
    for (const system of STAR_SYSTEMS) {
      const kinds = system.sites.map((site) => site.kind);
      expect(kinds.filter((kind) => kind === 'city').length).toBeGreaterThanOrEqual(6);
      expect(kinds.filter((kind) => kind === 'launch')).toHaveLength(1);
      expect(kinds.filter((kind) => kind === 'radar')).toHaveLength(1);
      expect(new Set(system.sites.map((site) => site.id)).size).toBe(system.sites.length);
    }
  });
});
