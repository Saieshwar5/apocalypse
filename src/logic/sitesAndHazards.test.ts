import { describe, expect, it } from 'vitest';
import { ATMOSPHERE, PULL_UP_FLOOR, altitudeReadout, atmosphereZone, entryDamagePerSecond, entryHeat,
  needsPullUp,
  pullUpComplete,
} from './atmosphere';
import { repairedHealth, siteCondition, siteDamage, siteTargetingChance, SITE_DEFINITIONS } from './prioritySites';
import { projectToScanner, SCANNER_TILT } from './scannerProjection';
import { rankThreats } from './threats';

describe('priority sites', () => {
  it('has eleven cities, including Tokyo and Shanghai, plus two installations', () => {
    const cities = SITE_DEFINITIONS.filter((site) => site.kind === 'city').map((site) => site.name);
    expect(cities).toHaveLength(11);
    expect(cities).toEqual(expect.arrayContaining(['Mumbai', 'Tokyo', 'Shanghai', 'New York', 'Lagos', 'Sydney']));
    expect(new Set(SITE_DEFINITIONS.map((site) => site.id)).size).toBe(SITE_DEFINITIONS.length);
    expect(SITE_DEFINITIONS.map((site) => site.kind)).toContain('launch');
    expect(SITE_DEFINITIONS.map((site) => site.kind)).toContain('radar');
  });

  it('damages a site fully near the impact and not at all outside its reach', () => {
    expect(siteDamage(0, 'medium')).toBe(38);
    expect(siteDamage(0.05, 'medium')).toBe(38);
    expect(siteDamage(0.0825, 'medium')).toBeCloseTo(19, 5);
    expect(siteDamage(0.11, 'medium')).toBe(0);
    expect(siteDamage(0.2, 'giant')).toBeGreaterThan(0);
    expect(siteDamage(0.2, 'large')).toBe(0);
  });

  it('lets a giant destroy a site outright but not a small rock', () => {
    expect(siteCondition(100 - siteDamage(0, 'giant'))).toBe('destroyed');
    expect(siteCondition(100 - siteDamage(0, 'small'))).toBe('damaged');
    expect(siteCondition(30)).toBe('critical');
  });

  it('repairs survivors between waves but never revives a destroyed site', () => {
    expect(repairedHealth(50)).toBe(65);
    expect(repairedHealth(95)).toBe(100);
    expect(repairedHealth(0)).toBe(0);
  });

  it('aims no asteroids at sites early and caps the share later', () => {
    expect(siteTargetingChance(1)).toBe(0);
    expect(siteTargetingChance(3)).toBeCloseTo(0.3);
    expect(siteTargetingChance(20)).toBe(0.45);
  });

  it('ranks an asteroid heading for a site above an equal one that is not', () => {
    const ranked = rankThreats([
      { id: 'ocean', timeToImpact: 20, planetDamage: 6, threatensSite: false },
      { id: 'city', timeToImpact: 20, planetDamage: 6, threatensSite: true },
    ]);
    expect(ranked[0].id).toBe('city');
  });
});

describe('atmosphere', () => {
  it('classifies altitude into zones', () => {
    expect(atmosphereZone(20)).toBe('space');
    expect(atmosphereZone(5)).toBe('warning');
    expect(atmosphereZone(1.5)).toBe('atmosphere');
    expect(atmosphereZone(0.3)).toBe('breakup');
  });

  it('heats the ship more the deeper it goes', () => {
    expect(entryDamagePerSecond(ATMOSPHERE.top * 5)).toBe(0);
    expect(entryHeat(ATMOSPHERE.top)).toBe(0);
    expect(entryDamagePerSecond(ATMOSPHERE.top)).toBe(3);
    expect(entryDamagePerSecond((ATMOSPHERE.top + ATMOSPHERE.breakup) / 2)).toBeCloseTo(18);
    expect(entryHeat(ATMOSPHERE.breakup * 0.6)).toBe(1);
  });

  it('gives a shielded ship many seconds at the edge before it is in danger', () => {
    // Shield 100 plus hull 100: more than a minute at the very top.
    expect(200 / entryDamagePerSecond(ATMOSPHERE.top)).toBeGreaterThan(60);
    expect(200 / entryDamagePerSecond(ATMOSPHERE.breakup * 1.2)).toBeGreaterThan(5);
  });

  it('pulls up automatically when deep in the atmosphere or falling too fast to stop', () => {
    expect(needsPullUp(PULL_UP_FLOOR - 0.3, 0)).toBe(true);
    // The ship may skim the top of the atmosphere by its own choice.
    expect(needsPullUp(ATMOSPHERE.top - 0.4, 0)).toBe(false);
    expect(needsPullUp(10, 0)).toBe(false);
    // Sinking fast from 10 up: too little room left to stop.
    expect(needsPullUp(10, 14)).toBe(true);
    expect(needsPullUp(10, 2)).toBe(false);
    expect(needsPullUp(10, -10)).toBe(false);
    expect(pullUpComplete(ATMOSPHERE.top + 1, -5)).toBe(false);
    expect(pullUpComplete(ATMOSPHERE.top + 6, 3)).toBe(false);
    expect(pullUpComplete(ATMOSPHERE.top + 6, -3)).toBe(true);
  });

  it('reports distance from the centre, the surface and the atmosphere', () => {
    const readout = altitudeReadout(57, 40);
    expect(readout.fromCentre).toBe(57);
    expect(readout.aboveSurface).toBe(17);
    expect(readout.aboveAtmosphere).toBeCloseTo(17 - ATMOSPHERE.top);
    expect(altitudeReadout(41, 40).aboveAtmosphere).toBeLessThan(0);
  });
});

describe('3D scanner projection', () => {
  it('puts contacts ahead up the screen and contacts to the right on the right', () => {
    const ahead = projectToScanner([0, 0, -50], 200, 100);
    expect(ahead.x).toBeCloseTo(0);
    expect(ahead.y).toBeCloseTo(-50 * SCANNER_TILT);
    expect(projectToScanner([50, 0, 0], 200, 100).x).toBeCloseTo(50);
  });

  it('raises a stalk for contacts above and hangs one for contacts below', () => {
    const above = projectToScanner([0, 40, -40], 200, 100);
    const below = projectToScanner([0, -40, -40], 200, 100);
    expect(above.above).toBe(true);
    expect(above.y).toBeLessThan(above.baseY);
    expect(below.above).toBe(false);
    expect(below.y).toBeGreaterThan(below.baseY);
  });

  it('pins contacts beyond range to the rim', () => {
    const far = projectToScanner([0, 0, -900], 200, 100);
    expect(far.beyondRange).toBe(true);
    expect(far.y).toBeCloseTo(-100 * SCANNER_TILT);
  });
});
