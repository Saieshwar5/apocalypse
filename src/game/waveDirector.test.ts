import { describe, expect, it } from 'vitest';
import { buildOrbitPlan, orbitRating } from '../logic/orbitPlan';
import { createSeededRandom } from '../logic/random';
import { loadoutFor, nextCost, noUpgrades, purchase } from '../logic/upgrades';
import { WaveDirector, type WaveEvent } from './waveDirector';

/** Runs an orbit with a pilot who destroys every asteroid `killDelay` seconds after it appears. */
function fly(director: WaveDirector, seconds: number, killDelay: number): WaveEvent[] {
  const events: WaveEvent[] = [];
  const live: number[] = [];
  for (let time = 0; time < seconds; time += 0.5) {
    const now = director.update(0.5, live.length);
    for (const event of now) {
      if (event.type === 'spawn') {
        live.push(time + killDelay);
      }
    }
    while (live.length > 0 && live[0] <= time) {
      live.shift();
    }
    events.push(...now);
  }
  return events;
}

describe('orbit plan', () => {
  it('starts calm, alternates fields with calm zones and ends on a giant', () => {
    const plan = buildOrbitPlan();
    expect(plan[0].kind).toBe('calm');
    expect(plan[plan.length - 1].kind).toBe('giant');
    expect(plan.filter((sector) => sector.kind === 'calm').length).toBeGreaterThanOrEqual(4);
    expect(plan.filter((sector) => sector.kind === 'giant')).toHaveLength(2);
  });

  it('makes later systems harder', () => {
    const easy = buildOrbitPlan(0).filter((sector) => sector.wave > 0);
    const hard = buildOrbitPlan(5).filter((sector) => sector.wave > 0);
    hard.forEach((sector, index) => expect(sector.wave).toBeGreaterThan(easy[index].wave));
  });

  it('rates a finished orbit by what survived', () => {
    expect(orbitRating(95, 11, 11)).toBe(3);
    expect(orbitRating(95, 10, 11)).toBe(2);
    expect(orbitRating(30, 4, 11)).toBe(1);
  });
});

describe('WaveDirector', () => {
  it('runs the whole orbit in order and reports completion once', () => {
    const director = new WaveDirector(createSeededRandom(5));
    director.reset();
    const events = fly(director, 3000, 4);
    const started = events.filter((event) => event.type === 'sector-started');
    expect(started).toHaveLength(director.sectors.length);
    expect(started.map((event) => (event.type === 'sector-started' ? event.index : -1))).toEqual(
      director.sectors.map((_, index) => index),
    );
    expect(events.filter((event) => event.type === 'orbit-complete')).toHaveLength(1);
    expect(director.phase).toBe('complete');
    expect(director.progress).toBe(1);
  });

  it('does not leave a field until every asteroid is gone', () => {
    const director = new WaveDirector(createSeededRandom(5));
    director.reset();
    const events = fly(director, 400, 100000);
    expect(events.some((event) => event.type === 'wave-cleared')).toBe(false);
    expect(director.phase).toBe('field');
    expect(director.progress).toBeLessThan(0.2);
  });

  it('lets the pilot cut a calm zone short', () => {
    const director = new WaveDirector(createSeededRandom(5));
    director.reset();
    director.update(0.1, 0);
    expect(director.phase).toBe('calm');
    expect(director.skipCalm()).toBe(true);
    expect(director.remaining).toBe(3);
    expect(director.skipCalm()).toBe(false);
  });
});

describe('upgrades', () => {
  it('charges rising prices and stops at the maximum level', () => {
    let levels = noUpgrades();
    const first = purchase(levels, 'fuelTank', 1000);
    expect(first).toMatchObject({ ok: true, cost: 300 });
    levels = first.ok ? first.levels : levels;
    expect(nextCost(levels, 'fuelTank')).toBe(600);
    expect(purchase(levels, 'fuelTank', 500)).toEqual({ ok: false, reason: 'too-expensive' });
    const second = purchase(levels, 'fuelTank', 600);
    levels = second.ok ? second.levels : levels;
    expect(purchase(levels, 'fuelTank', 9999)).toEqual({ ok: false, reason: 'maxed' });
  });

  it('turns levels into the numbers the game uses', () => {
    expect(loadoutFor(noUpgrades())).toMatchObject({ fuelCapacity: 100, missileCapacity: 8, thrustMultiplier: 1 });
    const upgraded = loadoutFor({ ...noUpgrades(), fuelTank: 2, missileRack: 1, stationShield: 1, repairCrews: 1 });
    expect(upgraded).toMatchObject({ fuelCapacity: 180, missileCapacity: 12, stationShieldCapacity: 200, siteRepairMultiplier: 2 });
  });
});
