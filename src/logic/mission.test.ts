import { describe, expect, it } from 'vitest';
import { duties, ENDINGS, weakestDuty, type MissionReadings } from './mission';

const healthy: MissionReadings = {
  earth: 100,
  sitesStanding: 6,
  sitesTotal: 6,
  orbitHealth: 100,
  satellitesWorking: 8,
  satellitesTotal: 8,
  aegis: { fuel: 0.65, missiles: 0.6 },
  licence: { stage: 'good', score: 60 },
};

describe('the pilot\'s mission', () => {
  it('lists five duties, each with what it means, the work and the cost', () => {
    const list = duties(null);
    expect(list.map((duty) => duty.id)).toEqual(['earth', 'orbit', 'satellites', 'stations', 'people']);
    for (const duty of list) {
      expect(duty.why.length).toBeGreaterThan(20);
      expect(duty.how.length).toBeGreaterThan(20);
      expect(duty.cost.length).toBeGreaterThan(20);
      expect(duty.reading).toBeNull();
    }
  });

  it('shows every duty in good shape on a fresh run', () => {
    const list = duties(healthy);
    expect(list.every((duty) => duty.reading?.state === 'good')).toBe(true);
    expect(weakestDuty(list)).toBeNull();
    expect(list[0].reading?.text).toBe('Earth 100% · 6 of 6 sites standing');
    expect(list[2].reading?.text).toBe('8 of 8 satellites working');
  });

  it('points at the duty in the worst state', () => {
    const list = duties({ ...healthy, earth: 82, orbitHealth: 44, satellitesWorking: 7 });
    expect(list[1].reading?.state).toBe('bad');
    expect(list[2].reading?.state).toBe('watch');
    expect(weakestDuty(list)).toBe('orbit');
  });

  it('flags a lost site even while Earth itself is healthy', () => {
    const list = duties({ ...healthy, earth: 92, sitesStanding: 5 });
    expect(list[0].reading?.state).toBe('watch');
    expect(weakestDuty(list)).toBe('earth');
  });

  it('warns when Aegis is nearly out of missiles', () => {
    const list = duties({ ...healthy, aegis: { fuel: 0.8, missiles: 0.1 } });
    expect(list[3].reading).toEqual({ text: 'Aegis: fuel 80% · missiles 10%', state: 'bad' });
  });

  it('leaves the station reading out where there is no station', () => {
    expect(duties({ ...healthy, aegis: null })[3].reading).toBeNull();
  });

  it('follows the licence stages', () => {
    expect(duties({ ...healthy, licence: { stage: 'warning', score: 34 } })[4].reading).toEqual({ text: 'Licence: warning (34)', state: 'watch' });
    expect(duties({ ...healthy, licence: { stage: 'probation', score: 12 } })[4].reading?.state).toBe('bad');
  });

  it('has one way to win and four ways to lose', () => {
    expect(ENDINGS.filter((ending) => ending.win)).toHaveLength(1);
    expect(ENDINGS.filter((ending) => !ending.win)).toHaveLength(4);
  });
});
