import { describe, expect, it } from 'vitest';
import { Wallet } from './economy';
import {
  LOAN,
  PROBATION,
  REPUTATION,
  SHIP_LOSS,
  applyReputation,
  replacementFee,
  reputationChange,
  standingFor,
  startProbation,
  stepProbation,
} from './reputation';

describe('reputation', () => {
  it('rewards good work and clean work more', () => {
    expect(reputationChange({ type: 'contract-completed', clean: true })).toBeGreaterThan(reputationChange({ type: 'contract-completed', clean: false }));
    expect(reputationChange({ type: 'satellite-job-completed' })).toBeGreaterThan(0);
  });

  it('punishes failures, and letting a rock hit a city most of all among impacts', () => {
    expect(reputationChange({ type: 'contract-lost', site: true })).toBeLessThan(reputationChange({ type: 'contract-lost', site: false }));
    expect(reputationChange({ type: 'ship-lost' })).toBeLessThan(-10);
    expect(reputationChange({ type: 'debris-left', tonnes: 8 })).toBe(-2);
  });

  it('stays between 0 and 100', () => {
    expect(applyReputation(99, { type: 'satellite-job-completed' })).toBe(REPUTATION.max);
    expect(applyReputation(5, { type: 'ship-lost' })).toBe(0);
  });

  it('maps reputation to licence stages', () => {
    expect(standingFor(REPUTATION.start)).toBe('good');
    expect(standingFor(REPUTATION.goodFrom)).toBe('good');
    expect(standingFor(REPUTATION.goodFrom - 1)).toBe('warning');
    expect(standingFor(REPUTATION.probationBelow - 1)).toBe('probation');
  });
});

describe('probation', () => {
  it('passes when enough contracts are done in time', () => {
    const probation = startProbation();
    expect(stepProbation(probation, 10, 1)).toBe('running');
    expect(stepProbation(probation, 10, PROBATION.contracts - 1)).toBe('passed');
  });

  it('fails when time runs out', () => {
    const probation = startProbation();
    expect(stepProbation(probation, PROBATION.seconds + 1, 0)).toBe('failed');
  });
});

describe('losing the ship and the loan', () => {
  it('costs far less with insurance', () => {
    expect(replacementFee(true)).toBe(SHIP_LOSS.insuredFee);
    expect(replacementFee(false)).toBe(SHIP_LOSS.replacementFee);
  });

  it('grants one loan, repaid from a share of later earnings', () => {
    const wallet = new Wallet();
    const start = wallet.balance;
    expect(wallet.borrow()).toBe(true);
    expect(wallet.balance).toBe(start + LOAN.amount);
    expect(wallet.borrow()).toBe(false);
    wallet.earn(100);
    expect(wallet.loanOwed).toBeCloseTo(LOAN.owed - 100 * LOAN.repaymentShare);
    expect(wallet.balance).toBeCloseTo(start + LOAN.amount + 100 * (1 - LOAN.repaymentShare));
    expect(wallet.earned).toBe(100);
  });

  it('stops taking repayments once the loan is paid off', () => {
    const wallet = new Wallet();
    wallet.borrow();
    wallet.earn(100000);
    expect(wallet.loanOwed).toBe(0);
    const before = wallet.balance;
    wallet.earn(100);
    expect(wallet.balance).toBe(before + 100);
  });
});
