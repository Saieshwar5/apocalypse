import { describe, expect, it } from 'vitest';
import { EMPTY_CAREER, nextRank, parseCareer, rankFor, recordCareerRun, recordMedal } from './career';
import { SEASON_ONE, beatForSector } from './story';

describe('career and ranks', () => {
  it('starts as a cadet and rises with earnings and seasons', () => {
    expect(rankFor(EMPTY_CAREER)).toBe('Cadet');
    expect(rankFor({ ...EMPTY_CAREER, earned: 2500 })).toBe('Pilot');
    expect(rankFor({ ...EMPTY_CAREER, earned: 9000 })).toBe('Pilot');
    expect(rankFor({ ...EMPTY_CAREER, earned: 9000, seasons: 1 })).toBe('Senior Pilot');
    expect(rankFor({ ...EMPTY_CAREER, earned: 30000, seasons: 3 })).toBe('Commander');
  });

  it('says what the next rank needs', () => {
    expect(nextRank(EMPTY_CAREER)).toEqual({ name: 'Pilot', earnedNeeded: 2000, seasonsNeeded: 0 });
    expect(nextRank({ ...EMPTY_CAREER, earned: 30000, seasons: 3 })).toBeNull();
  });

  it('adds runs to the career', () => {
    const after = recordCareerRun(EMPTY_CAREER, 1200, true);
    expect(after).toEqual({ ...EMPTY_CAREER, earned: 1200, seasons: 1, runs: 1 });
    expect(recordCareerRun(EMPTY_CAREER, 0, true, true).hardcoreSeasons).toBe(1);
    expect(recordCareerRun(after, -50, false).earned).toBe(1200);
  });

  it('survives missing or edited storage', () => {
    expect(parseCareer(null)).toEqual(EMPTY_CAREER);
    expect(parseCareer('not json')).toEqual(EMPTY_CAREER);
    expect(parseCareer('{"earned":-5,"seasons":2.7,"trainingDone":true}')).toEqual({ ...EMPTY_CAREER, seasons: 2, trainingDone: true });
    const medalled = parseCareer(JSON.stringify(recordMedal(EMPTY_CAREER, 'rescue', 'gold')));
    expect(medalled.medals.rescue.gold).toBe(1);
  });
});

describe('season one story', () => {
  it('has beats in sector order within the orbit', () => {
    const sectors = SEASON_ONE.map((beat) => beat.sector);
    expect([...sectors].sort((a, b) => a - b)).toEqual(sectors);
    expect(Math.max(...sectors)).toBeLessThan(14);
    expect(beatForSector(0)?.speaker).toBe('control');
    expect(beatForSector(1)).toBeNull();
  });
});
