import { describe, expect, it } from 'vitest';
import { hudVisibility, type HudSituation } from './hudFocus';

const fighting: HudSituation = {
  density: 'standard',
  calm: false,
  tactical: false,
  integrity: 100,
  orbitHealth: 95,
  licenceGood: true,
  moneySeconds: 60,
  leagueSeconds: 60,
  threatenedSites: 0,
  damagedSites: 0,
  needsStation: false,
  altitudeMatters: false,
  laserHeat: 0,
  boost: 100,
  mouseCaptured: true,
  autopilot: false,
  assist: true,
  berthed: false,
  braking: false,
  towing: false,
  newPilot: false,
};

const shown = (visibility: ReturnType<typeof hudVisibility>) =>
  Object.entries(visibility).filter(([, value]) => value === true || (typeof value === 'string' && value !== 'none')).map(([key]) => key);

describe('HUD focus', () => {
  it('keeps a healthy fight almost clean', () => {
    const visibility = hudVisibility(fighting);
    expect(shown(visibility)).toEqual([]);
    expect(visibility.boardRows).toBe(2);
  });

  it('brings readings up when they matter', () => {
    const visibility = hudVisibility({ ...fighting, integrity: 80, orbitHealth: 50, licenceGood: false, threatenedSites: 1, needsStation: true, laserHeat: 40, assist: false });
    expect(visibility.integrity && visibility.orbitHealth && visibility.licence).toBe(true);
    expect(visibility.sites).toBe('alert');
    expect(visibility.position && visibility.stationRows && visibility.heat && visibility.assistChip).toBe(true);
  });

  it('flashes money and the league briefly after a change', () => {
    expect(hudVisibility({ ...fighting, moneySeconds: 1 }).balance).toBe(true);
    expect(hudVisibility({ ...fighting, leagueSeconds: 2 }).league).toBe(true);
    expect(hudVisibility({ ...fighting, density: 'minimal', leagueSeconds: 2 }).league).toBe(false);
  });

  it('shows the planning view in calm zones', () => {
    const visibility = hudVisibility({ ...fighting, calm: true, damagedSites: 2 });
    expect(visibility.balance && visibility.earned && visibility.league && visibility.licence).toBe(true);
    expect(visibility.sites).toBe('all');
    expect(visibility.boardRows).toBe(5);
  });

  it('shows everything at full density', () => {
    const visibility = hudVisibility({ ...fighting, density: 'full' });
    expect(visibility.position && visibility.league && visibility.allWorldLabels && visibility.controlsLine).toBe(true);
    expect(visibility.sites).toBe('all');
    expect(visibility.boardRows).toBe(8);
  });

  it('gives the tactical map the planning readings and keeps the flying ones out of its way', () => {
    for (const density of ['minimal', 'standard', 'full'] as const) {
      const visibility = hudVisibility({ ...fighting, density, tactical: true });
      expect(visibility.integrity && visibility.orbitHealth && visibility.licence && visibility.balance && visibility.league).toBe(true);
      expect(visibility.allWorldLabels).toBe(true);
      expect(visibility.boardRows).toBe(8);
      expect(visibility.position || visibility.heat || visibility.boost || visibility.controlsLine || visibility.steerChip).toBe(false);
      expect(visibility.sites).toBe('none');
    }
  });

  it('still lists threatened sites on the map', () => {
    expect(hudVisibility({ ...fighting, tactical: true, threatenedSites: 1 }).sites).toBe('alert');
  });

  it('keeps the controls line for new pilots', () => {
    expect(hudVisibility({ ...fighting, newPilot: true }).controlsLine).toBe(true);
  });
});
