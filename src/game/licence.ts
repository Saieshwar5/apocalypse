import type { SoundEffects } from '../audio/soundEffects';
import type { Hud } from '../hud/hud';
import { formatCredits } from '../logic/contracts';
import {
  LOAN,
  PROBATION,
  REPUTATION,
  SHIP_LOSS,
  applyReputation,
  replacementFee,
  standingFor,
  startProbation,
  stepProbation,
  type LicenceStage,
  type Probation,
  type ReputationEvent,
} from '../logic/reputation';
import { formatCountdown } from '../logic/units';
import type { GameSession } from './gameSession';

export interface LicenceDependencies {
  session: GameSession;
  hud: Hud;
  sound: SoundEffects;
}

const STAGE_LABEL: Record<LicenceStage, string> = { good: 'GOOD STANDING', warning: 'WARNING', probation: 'PROBATION', recalled: 'RECALLED' };

export type ShipLossOutcome = { replaced: true; fee: number; borrowed: boolean } | { replaced: false; reason: string };

/**
 * The pilot's licence: reputation from everything the pilot does, the stage
 * it puts the licence in, the probation task, insurance and what losing the
 * ship costs. Mission control announces every change of stage.
 */
export class Licence {
  reputation: number = REPUTATION.start;
  stage: LicenceStage = 'good';
  insured = false;
  shipsLost = 0;
  private probation: Probation | null = null;
  private contractsSinceUpdate = 0;

  constructor(private readonly deps: LicenceDependencies) {
    deps.session.events.on((event) => this.record(event));
  }

  reset(): void {
    this.reputation = REPUTATION.start;
    this.stage = 'good';
    this.insured = false;
    this.shipsLost = 0;
    this.probation = null;
    this.contractsSinceUpdate = 0;
  }

  get recalled(): boolean {
    return this.stage === 'recalled';
  }

  /** True while rivals give way to the pilot on contested work. */
  get inGoodStanding(): boolean {
    return this.stage === 'good';
  }

  /** One line for the HUD. */
  get summary(): string {
    if (this.stage === 'probation' && this.probation) {
      return `PROBATION ${formatCountdown(this.probation.secondsLeft)} · ${this.probation.contractsDone}/${PROBATION.contracts} contracts`;
    }
    return `${STAGE_LABEL[this.stage]} · ${Math.round(this.reputation)}`;
  }

  update(deltaSeconds: number): void {
    if (this.stage === 'recalled') {
      return;
    }
    const done = this.contractsSinceUpdate;
    this.contractsSinceUpdate = 0;
    if (this.probation) {
      const result = stepProbation(this.probation, deltaSeconds, done);
      if (result === 'passed') {
        this.probation = null;
        this.reputation = Math.max(this.reputation, REPUTATION.afterProbation);
        this.setStage('warning', 'Probation passed. Your licence stays under review: keep the work clean', 'success');
      } else if (result === 'failed') {
        this.probation = null;
        this.setStage('recalled', 'Licence revoked. You are ordered back to Earth', 'danger');
      }
      return;
    }
    const standing = standingFor(this.reputation);
    if (standing === this.stage) {
      return;
    }
    if (standing === 'probation') {
      this.probation = startProbation();
      this.setStage('probation', `Licence on probation: complete ${PROBATION.contracts} contracts within ${formatCountdown(PROBATION.seconds)}, or you are recalled`, 'danger');
    } else if (standing === 'warning') {
      this.setStage('warning', 'Your licence is under review. Rivals will no longer give way to you', 'warning');
    } else {
      this.setStage('good', 'Licence back in good standing', 'success');
    }
  }

  /** Insurance from Aegis: a cheaper replacement if the ship is lost. */
  buyInsurance(): void {
    const { session, hud } = this.deps;
    if (this.insured) {
      hud.showMessage('Already insured: a replacement ship would cost ' + formatCredits(SHIP_LOSS.insuredFee), 'info', 2.5);
      return;
    }
    if (!session.wallet.spend(SHIP_LOSS.insurancePremium)) {
      hud.showMessage(`Insurance costs ${formatCredits(SHIP_LOSS.insurancePremium)}: not enough money`, 'warning', 2.5);
      return;
    }
    this.insured = true;
    hud.showMessage(`Insured. If you lose the ship, a replacement costs ${formatCredits(SHIP_LOSS.insuredFee)} instead of ${formatCredits(SHIP_LOSS.replacementFee)}`, 'success', 4);
    this.deps.sound.chime();
  }

  /**
   * The ship was destroyed: pay for a replacement (insurance, then the
   * emergency loan, help) or go bankrupt. Reputation falls either way.
   */
  handleShipLoss(): ShipLossOutcome {
    const { wallet } = this.deps.session;
    this.shipsLost += 1;
    this.record({ type: 'ship-lost' });
    const fee = replacementFee(this.insured);
    let borrowed = false;
    if (wallet.balance < fee && wallet.borrow()) {
      borrowed = true;
    }
    if (!wallet.spend(fee)) {
      return { replaced: false, reason: `Bankrupt: you cannot pay ${formatCredits(fee)} for a replacement ship, and Halo's emergency loan is spent` };
    }
    this.insured = false;
    return { replaced: true, fee, borrowed };
  }

  private record(event: ReputationEvent): void {
    if (this.stage === 'recalled') {
      return;
    }
    if (event.type === 'contract-completed' || event.type === 'satellite-job-completed') {
      this.contractsSinceUpdate += 1;
    }
    this.reputation = applyReputation(this.reputation, event);
  }

  private setStage(stage: LicenceStage, message: string, tone: 'success' | 'warning' | 'danger'): void {
    this.stage = stage;
    this.deps.hud.showMessage(`Mission control: ${message}`, tone, 5);
    if (tone === 'danger') {
      this.deps.sound.alarm();
    } else {
      this.deps.sound.chime();
    }
  }
}

/** For the end screen and messages. */
export function loanNote(borrowed: boolean): string {
  return borrowed ? ` Halo lent you ${formatCredits(LOAN.amount)}; ${Math.round(LOAN.repaymentShare * 100)}% of your earnings go to repaying ${formatCredits(LOAN.owed)}.` : '';
}
