import { describe, expect, it } from 'vitest';
import {
  HARDPOINTS,
  MODULES,
  afterShipLoss,
  emptyHangar,
  handlingShare,
  moduleEffects,
  sanitizeHangar,
  turnShare,
  yardAction,
} from './shipModules';
import {
  addMedal,
  contractScore,
  emptyTally,
  escortScore,
  medalBonus,
  medalFor,
  mergeTallies,
  passengerScore,
  placementScore,
  sanitizeTally,
  timeScore,
  totalMedals,
} from './medals';

describe('ship modules', () => {
  it('every module adds mass, so a fitted ship is slower', () => {
    expect(MODULES.every((module) => module.mass > 0)).toBe(true);
    const bare = moduleEffects([]);
    const loaded = moduleEffects(['cargoPod', 'missilePod']);
    expect(bare.massFactor).toBe(1);
    expect(loaded.massFactor).toBeCloseTo(1.42);
    expect(handlingShare(loaded.massFactor)).toBeLessThan(0.75);
    expect(turnShare(loaded.massFactor)).toBeGreaterThan(handlingShare(loaded.massFactor));
  });

  it('modules change only their own work', () => {
    const effects = moduleEffects(['heavyWinch']);
    expect(effects.lineStrength).toBeGreaterThan(1);
    expect(effects.haulPay).toBe(1);
    expect(moduleEffects(['missilePod']).extraMissiles).toBe(6);
    expect(moduleEffects(['longScanner']).lockRange).toBeCloseTo(1.4);
  });

  it('buys, fits and removes at the yard within the hardpoints', () => {
    let hangar = emptyHangar();
    const tooPoor = yardAction(hangar, 'cargoPod', 100, HARDPOINTS.base);
    expect(tooPoor).toEqual({ ok: false, reason: 'too-expensive' });
    const bought = yardAction(hangar, 'auxTank', 5000, HARDPOINTS.base);
    expect(bought.ok && bought.action).toBe('bought');
    hangar = bought.ok ? bought.hangar : hangar;
    hangar = (yardAction(hangar, 'sweeperNet', 5000, HARDPOINTS.base) as { hangar: typeof hangar }).hangar;
    expect(hangar.fitted).toEqual(['auxTank', 'sweeperNet']);
    // A third purchase is stored as a spare when the hardpoints are full.
    const spare = yardAction(hangar, 'longScanner', 5000, HARDPOINTS.base);
    expect(spare.ok && spare.hangar.fitted).toEqual(['auxTank', 'sweeperNet']);
    hangar = spare.ok ? spare.hangar : hangar;
    expect(yardAction(hangar, 'longScanner', 0, HARDPOINTS.base)).toEqual({ ok: false, reason: 'no-hardpoint' });
    const removed = yardAction(hangar, 'auxTank', 0, HARDPOINTS.base);
    expect(removed.ok && removed.action).toBe('removed');
    hangar = removed.ok ? removed.hangar : hangar;
    const fitted = yardAction(hangar, 'longScanner', 0, HARDPOINTS.base);
    expect(fitted.ok && fitted.cost).toBe(0);
  });

  it('uninsured losses take the fitted modules down with the ship', () => {
    const hangar = { owned: ['auxTank', 'cargoPod', 'longScanner'] as const, fitted: ['auxTank', 'cargoPod'] as const };
    const copy = { owned: [...hangar.owned], fitted: [...hangar.fitted] };
    expect(afterShipLoss(copy, true)).toEqual(copy);
    expect(afterShipLoss(copy, false)).toEqual({ owned: ['longScanner'], fitted: [] });
  });

  it('repairs stored hangars', () => {
    expect(sanitizeHangar({ owned: ['auxTank', 'auxTank', 'laser'], fitted: ['auxTank', 'cargoPod'] })).toEqual({ owned: ['auxTank'], fitted: ['auxTank'] });
    expect(sanitizeHangar('junk')).toEqual(emptyHangar());
  });
});

describe('medals', () => {
  it('grades scores and pays bonuses except on intercepts', () => {
    expect(medalFor(0.9)).toBe('gold');
    expect(medalFor(0.6)).toBe('silver');
    expect(medalFor(0.2)).toBe('bronze');
    expect(medalBonus('haul', 'gold', 400)).toBe(100);
    expect(medalBonus('contract', 'gold', 400)).toBe(0);
  });

  it('scores jobs by how they were done', () => {
    expect(medalFor(contractScore(true, true))).toBe('gold');
    expect(medalFor(contractScore(true, false))).toBe('silver');
    expect(medalFor(contractScore(false, false))).toBe('bronze');
    expect(timeScore(30, 40)).toBe(1);
    expect(timeScore(60, 40)).toBeCloseTo(0.5);
    expect(timeScore(100, 40)).toBe(0);
    expect(medalFor(placementScore(0.2))).toBe('gold');
    expect(medalFor(placementScore(5))).toBe('bronze');
    expect(medalFor(passengerScore(0, 20, 40))).toBe('gold');
    expect(medalFor(passengerScore(1, 20, 40))).toBe('silver');
    expect(medalFor(passengerScore(0, 120, 40))).toBe('silver');
    expect(medalFor(escortScore(9, 18))).toBe('gold');
    expect(medalFor(escortScore(1, 18))).toBe('bronze');
  });

  it('keeps a tally that survives storage', () => {
    let tally = addMedal(emptyTally(), 'rescue', 'gold');
    tally = addMedal(tally, 'haul', 'gold');
    expect(totalMedals(tally, 'gold')).toBe(2);
    expect(totalMedals(mergeTallies(tally, tally), 'gold')).toBe(4);
    expect(sanitizeTally(JSON.parse(JSON.stringify(tally)))).toEqual(tally);
    expect(sanitizeTally({ rescue: { gold: -3 } }).rescue.gold).toBe(0);
  });
});
