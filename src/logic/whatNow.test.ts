import { describe, expect, it } from 'vitest';
import { whatNow, type WhatNowSituation } from './whatNow';

const base: WhatNowSituation = {
  calm: false,
  threat: null,
  job: null,
  fuel: 80,
  hull: 100,
  missiles: 8,
  docked: false,
  berthedAt: null,
  towing: null,
  storm: 'clear',
  sheltered: false,
  licenceGood: true,
  orbitHealth: 90,
  objective: null,
};

describe('what now', () => {
  it('explains how to deal with the priority rock', () => {
    const advice = whatNow({
      ...base,
      threat: { name: 'A large iron rock', site: 'MUMBAI', seconds: 40, verdict: 'tight', distance: 60, needsMissiles: true },
      objective: 'PRIORITY ROCK',
    });
    expect(advice[0]).toContain('will hit MUMBAI in 0:40');
    expect(advice.join(' ')).toContain('boost');
    expect(advice.join(' ')).toContain('missiles (F)');
    expect(advice.at(-1)).toContain('N picks anything');
  });

  it('puts survival first', () => {
    const advice = whatNow({ ...base, storm: 'storm', hull: 20, fuel: 10 });
    expect(advice[0]).toContain('Solar storm');
    expect(advice[1]).toContain('Hull is low');
    expect(advice[2]).toContain('Fuel is low');
  });

  it('suggests what to do in a quiet calm zone', () => {
    expect(whatNow({ ...base, calm: true })[0]).toContain('Calm zone');
    expect(whatNow({ ...base, docked: true })[0]).toContain('docked at Aegis');
    expect(whatNow({ ...base, berthedAt: 'VULCAN YARD' })[0]).toContain('1-7');
  });

  it('describes the job when there is one', () => {
    const advice = whatNow({ ...base, job: { title: 'Asteroid haul', detail: 'connect to the carbon rock (T)' } });
    expect(advice[0]).toBe('Job: Asteroid haul. Connect to the carbon rock (T).');
  });
});
