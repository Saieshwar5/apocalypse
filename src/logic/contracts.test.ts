import { describe, expect, it } from 'vitest';
import { CONTRACT_PAY, contractPayout, contractValue, formatCredits } from './contracts';
import { EMERGENCY_FUEL_LEVEL, PRICES, STARTING_BALANCE, Wallet, buyUnits, emergencyFuel } from './economy';
import { impactDamage } from './planetDamage';

describe('defence contracts', () => {
  it('pays nothing for a rock that burns up or misses', () => {
    expect(contractValue(0, false)).toBe(0);
    expect(contractValue(0, true)).toBe(0);
  });

  it('pays by danger, not size: a small iron rock beats a big rubble pile', () => {
    const smallIron = contractValue(impactDamage('small', 'iron'), false);
    const largeRubble = contractValue(impactDamage('large', 'rubble'), false);
    expect(smallIron).toBeGreaterThan(0);
    expect(contractValue(impactDamage('medium', 'iron'), false)).toBeGreaterThan(contractValue(impactDamage('medium', 'rocky'), false));
    expect(largeRubble).toBeLessThan(contractValue(impactDamage('large', 'rocky'), false));
  });

  it('rounds to 5 credits and pays more for a rock aimed at a site', () => {
    expect(contractValue(6, false)).toBe(180);
    expect(contractValue(6, true)).toBe(270);
    expect(contractValue(1, false) % 5).toBe(0);
  });

  it('adds a bonus for meeting a threat early', () => {
    expect(contractPayout(200, 'destroyed', 60)).toEqual({ amount: 250, early: true, clean: false });
    expect(contractPayout(200, 'destroyed', 10)).toEqual({ amount: 200, early: false, clean: false });
    expect(contractPayout(200, 'deflected', null).early).toBe(true);
  });

  it('adds a bonus for stopping a rock without leaving debris', () => {
    expect(contractPayout(200, 'deflected', 10)).toEqual({ amount: 240, early: false, clean: true });
    expect(contractPayout(200, 'destroyed', 10, false)).toEqual({ amount: 240, early: false, clean: true });
    expect(contractPayout(200, 'destroyed', 60, false).amount).toBe(290);
  });

  it('pays part of the contract when a laser splits a rock', () => {
    expect(contractPayout(400, 'split', 5).amount).toBe(400 * CONTRACT_PAY.splitShare);
    expect(contractPayout(0, 'destroyed', 90).amount).toBe(0);
  });

  it('formats credits for the HUD', () => {
    expect(formatCredits(1250)).toBe('1,250 cr');
    expect(formatCredits(59.6)).toBe('60 cr');
  });
});

describe('station prices', () => {
  it('buys what the pilot wants, or what the pilot can afford', () => {
    expect(buyUnits(10, PRICES.fuelPerUnit, 100)).toEqual({ units: 10, cost: 20 });
    expect(buyUnits(100, PRICES.fuelPerUnit, 50)).toEqual({ units: 25, cost: 50 });
    expect(buyUnits(10, PRICES.fuelPerUnit, 0)).toEqual({ units: 0, cost: 0 });
    expect(buyUnits(0, PRICES.fuelPerUnit, 100)).toEqual({ units: 0, cost: 0 });
  });

  it('never strands a broke pilot: emergency fuel tops up to a minimum', () => {
    expect(emergencyFuel(5, 100)).toBe(EMERGENCY_FUEL_LEVEL - 5);
    expect(emergencyFuel(5, 3)).toBe(3);
    expect(emergencyFuel(EMERGENCY_FUEL_LEVEL + 1, 50)).toBe(0);
  });
});

describe('wallet', () => {
  it('starts with a balance and tracks income separately from it', () => {
    const wallet = new Wallet();
    expect(wallet.balance).toBe(STARTING_BALANCE);
    wallet.earn(200);
    expect(wallet.balance).toBe(STARTING_BALANCE + 200);
    expect(wallet.earned).toBe(200);
  });

  it('refuses purchases it cannot cover', () => {
    const wallet = new Wallet();
    expect(wallet.spend(STARTING_BALANCE + 1)).toBe(false);
    expect(wallet.balance).toBe(STARTING_BALANCE);
    expect(wallet.spend(100)).toBe(true);
    expect(wallet.spent).toBe(100);
  });

  it('takes fines down to zero but never below', () => {
    const wallet = new Wallet();
    wallet.spend(STARTING_BALANCE - 40);
    expect(wallet.fine(150)).toBe(40);
    expect(wallet.balance).toBe(0);
    wallet.reset();
    expect(wallet.balance).toBe(STARTING_BALANCE);
    expect(wallet.fines).toBe(0);
  });
});
