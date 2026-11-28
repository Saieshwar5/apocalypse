import { describe, expect, it } from 'vitest';
import { cargoKindsFor, jobList, jobsOpenedAt, jobUnlocked } from './jobAccess';

describe('jobs by rank', () => {
  it('gives a Cadet three jobs: intercepts, cargo runs and debris sweeps', () => {
    expect(jobsOpenedAt('Cadet')).toEqual(['intercept', 'cargo', 'sweep']);
    expect(jobUnlocked('satelliteTow', 'Cadet')).toBe(false);
    expect(jobUnlocked('rescue', 'Cadet')).toBe(false);
  });

  it('opens towing, guarding, escorts and the harder cargo at Pilot', () => {
    expect(jobsOpenedAt('Pilot')).toEqual(['satelliteTow', 'guard', 'escort', 'urgentCargo', 'fragileCargo']);
    expect(jobUnlocked('intercept', 'Pilot')).toBe(true);
    expect(jobUnlocked('passengers', 'Pilot')).toBe(false);
  });

  it('opens rescues, passengers and deploying satellites at Senior Pilot, and keeps them at Commander', () => {
    expect(jobsOpenedAt('Senior Pilot')).toEqual(['rescue', 'passengers', 'deploy']);
    expect(jobsOpenedAt('Commander')).toEqual([]);
    expect(jobUnlocked('deploy', 'Commander')).toBe(true);
  });

  it('offers cargo kinds to match', () => {
    expect(cargoKindsFor('Cadet')).toEqual(['routine']);
    expect(cargoKindsFor('Pilot')).toEqual(['routine', 'urgent', 'fragile']);
    expect(cargoKindsFor('Senior Pilot')).toEqual(['routine', 'urgent', 'fragile', 'passengers']);
  });

  it('lists jobs in plain words', () => {
    expect(jobList(['rescue', 'passengers', 'deploy'])).toBe('rescues, passengers and deploying satellites');
    expect(jobList(['cargo'])).toBe('cargo runs');
    expect(jobList([])).toBe('');
  });
});
