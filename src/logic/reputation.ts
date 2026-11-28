/**
 * Reputation is the pilot's licence to fly. It rises with good work and
 * falls with failures; the licence has stages so the end never arrives
 * without warning: good standing, warning (rivals stop giving way), probation
 * (a set task within a time limit) and recalled (the career is over).
 */
export type LicenceStage = 'good' | 'warning' | 'probation' | 'recalled';

export const REPUTATION = {
  start: 60,
  max: 100,
  /** At or above this, the licence is in good standing. */
  goodFrom: 45,
  /** Below this the licence goes on probation. */
  probationBelow: 30,
  /** Passing probation restores reputation to this (still a warning). */
  afterProbation: 38,
} as const;

/** The probation task: this many contracts within this many seconds. */
export const PROBATION = { contracts: 2, seconds: 180 } as const;

export type ReputationEvent =
  | { type: 'contract-completed'; clean: boolean }
  | { type: 'contract-lost'; site: boolean }
  | { type: 'satellite-job-completed' }
  | { type: 'satellite-job-failed' }
  | { type: 'satellite-destroyed-by-player' }
  | { type: 'rival-hit' }
  | { type: 'debris-left'; tonnes: number }
  | { type: 'ship-lost' }
  | { type: 'crew-lost' };

/** How much each event moves reputation. */
export function reputationChange(event: ReputationEvent): number {
  switch (event.type) {
    case 'contract-completed':
      return event.clean ? 3 : 2;
    case 'contract-lost':
      return event.site ? -6 : -2;
    case 'satellite-job-completed':
      return 5;
    case 'satellite-job-failed':
      return -5;
    case 'satellite-destroyed-by-player':
      return -8;
    case 'rival-hit':
      return -2;
    case 'debris-left':
      return -0.25 * event.tonnes;
    case 'ship-lost':
      return -15;
    case 'crew-lost':
      return -25;
  }
}

export function applyReputation(reputation: number, event: ReputationEvent): number {
  return Math.min(REPUTATION.max, Math.max(0, reputation + reputationChange(event)));
}

/** The licence stage for a reputation, ignoring probation in progress. */
export function standingFor(reputation: number): Exclude<LicenceStage, 'probation' | 'recalled'> | 'probation' {
  if (reputation >= REPUTATION.goodFrom) {
    return 'good';
  }
  return reputation >= REPUTATION.probationBelow ? 'warning' : 'probation';
}

export interface Probation {
  secondsLeft: number;
  contractsDone: number;
}

export function startProbation(): Probation {
  return { secondsLeft: PROBATION.seconds, contractsDone: 0 };
}

/** Advances probation; 'passed', 'failed' or 'running'. */
export function stepProbation(probation: Probation, deltaSeconds: number, contractsCompleted: number): 'passed' | 'failed' | 'running' {
  probation.contractsDone += contractsCompleted;
  probation.secondsLeft -= deltaSeconds;
  if (probation.contractsDone >= PROBATION.contracts) {
    return 'passed';
  }
  return probation.secondsLeft <= 0 ? 'failed' : 'running';
}

/** Losing the ship: what a replacement costs, with and without insurance. */
export const SHIP_LOSS = { replacementFee: 900, insuredFee: 200, insurancePremium: 250 } as const;

/** The one emergency loan Halo grants per career. */
export const LOAN = { amount: 1000, owed: 1250, repaymentShare: 0.3 } as const;

export function replacementFee(insured: boolean): number {
  return insured ? SHIP_LOSS.insuredFee : SHIP_LOSS.replacementFee;
}
