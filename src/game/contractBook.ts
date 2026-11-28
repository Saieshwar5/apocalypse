import type * as THREE from 'three';
import type { Asteroid } from '../asteroids/asteroidField';
import type { CombatFeedback } from '../hud/combatFeedback';
import type { Hud } from '../hud/hud';
import { ASTEROID_CLASSES } from '../logic/asteroidClasses';
import { contractPayout, contractValue, formatCredits, type ContractOutcome } from '../logic/contracts';
import { burnsUp } from '../logic/planetDamage';
import type { Wallet } from '../logic/economy';
import type { GameEvents } from './gameEvents';
import type { RadioNet } from './radioNet';
import { pilotName, splitPay, type PilotId, type RivalId } from '../logic/rivals';

export interface ContractBookDependencies {
  walletOf: (pilot: PilotId) => Wallet;
  events: GameEvents;
  radio: RadioNet;
  hud: Hud;
  feedback: CombatFeedback;
}

/** One line on the contract board. */
export interface ContractListing {
  asteroid: Asteroid;
  /** What the board offers: exact once scanned, an estimate before. */
  pay: number;
  estimate: boolean;
  /** A rival heading for this rock, if any. */
  chasedBy: RivalId | null;
}

/**
 * The Earth Defence Authority's open contracts: one for every asteroid on an
 * impact course. Keeps each contract's value up to date, pays the pilot when
 * a threat is neutralised and records what was lost when one gets through.
 */
export class ContractBook {
  /** Contract value per asteroid id, kept after a rock is knocked off course. */
  private readonly values = new Map<number, number>();
  /** Damage each pilot has dealt to each asteroid, for sharing the pay. */
  private readonly damage = new Map<number, Partial<Record<PilotId, number>>>();
  /** Which rival is going for which asteroid; set by the rivals each frame. */
  readonly chasers = new Map<number, RivalId>();
  /** Contracts completed per pilot, for the league table. */
  readonly completedBy: Partial<Record<PilotId, number>> = {};
  /** Credits earned and lost in the current debris field. */
  fieldEarned = 0;
  fieldLost = 0;
  contractsCompleted = 0;
  contractsLost = 0;

  constructor(private readonly deps: ContractBookDependencies) {}

  reset(): void {
    this.values.clear();
    this.damage.clear();
    this.chasers.clear();
    for (const key of Object.keys(this.completedBy) as PilotId[]) {
      delete this.completedBy[key];
    }
    this.fieldEarned = 0;
    this.fieldLost = 0;
    this.contractsCompleted = 0;
    this.contractsLost = 0;
  }

  startField(): void {
    this.fieldEarned = 0;
    this.fieldLost = 0;
  }

  /** Refreshes values while asteroids are on an impact course. */
  update(asteroids: readonly Asteroid[]): void {
    for (const asteroid of asteroids) {
      if (asteroid.passerBy || asteroid.timeToImpact === null) {
        continue;
      }
      this.values.set(asteroid.id, trueValue(asteroid));
    }
  }

  /** Open contracts, in the order given (most urgent first). */
  listings(ranked: readonly Asteroid[]): ContractListing[] {
    const listings: ContractListing[] = [];
    for (const asteroid of ranked) {
      if (asteroid.passerBy || asteroid.timeToImpact === null) {
        continue;
      }
      if (asteroid.identified) {
        const pay = trueValue(asteroid);
        if (pay > 0) {
          listings.push({ asteroid, pay, estimate: false, chasedBy: this.chasers.get(asteroid.id) ?? null });
        }
      } else {
        // Before a scan the Authority quotes the class average.
        listings.push({
          asteroid,
          pay: contractValue(ASTEROID_CLASSES[asteroid.size].planetDamage, asteroid.threatensSite),
          estimate: true,
          chasedBy: this.chasers.get(asteroid.id) ?? null,
        });
      }
    }
    return listings;
  }

  /** What the board shows for one asteroid; 0 when it carries no contract. */
  offerFor(asteroid: Asteroid): number {
    return this.listings([asteroid])[0]?.pay ?? 0;
  }

  /** Records weapon damage so the contract can be shared by everyone who fought it. */
  recordDamage(asteroid: Asteroid, pilot: PilotId, amount: number): void {
    const dealt = this.damage.get(asteroid.id) ?? {};
    dealt[pilot] = (dealt[pilot] ?? 0) + Math.max(0, amount);
    this.damage.set(asteroid.id, dealt);
  }

  /**
   * Pays for a neutralised threat, shared by damage dealt. Returns the
   * player's share.
   */
  complete(asteroid: Asteroid, outcome: ContractOutcome, point: THREE.Vector3, label: string, leftDebris = true): number {
    const value = this.values.get(asteroid.id) ?? 0;
    const dealt = this.damage.get(asteroid.id) ?? { player: 1 };
    this.values.delete(asteroid.id);
    this.damage.delete(asteroid.id);
    this.chasers.delete(asteroid.id);
    const payout = contractPayout(value, outcome, asteroid.timeToImpact, leftDebris);
    const shares = splitPay(payout.amount, dealt);
    const { walletOf, feedback, hud } = this.deps;
    for (const [pilot, amount] of Object.entries(shares) as [PilotId, number][]) {
      walletOf(pilot).earn(amount);
    }
    const mine = shares.player ?? 0;
    const others = (Object.keys(shares) as PilotId[]).filter((pilot) => pilot !== 'player' && (shares[pilot] ?? 0) > 0);
    if (payout.amount > 0) {
      const best = (Object.keys(shares) as PilotId[]).reduce((top, pilot) => ((shares[pilot] ?? 0) > (shares[top] ?? 0) ? pilot : top));
      this.completedBy[best] = (this.completedBy[best] ?? 0) + 1;
    }
    if (mine > 0) {
      this.deps.events.emit({ type: 'contract-completed', clean: payout.clean, early: payout.early });
      if (asteroid.targetSite) {
        this.deps.radio.moment('big-save', { site: asteroid.targetSite });
      }
      this.fieldEarned += mine;
      this.contractsCompleted += 1;
      const shared = others.length > 0 ? ` (shared with ${others.map(pilotName).join(', ')})` : '';
      feedback.kill(point, `${label}  +${formatCredits(mine)}${payout.early ? ' EARLY' : ''}${payout.clean ? ' CLEAN' : ''}${shared}`);
    } else if (others.length > 0) {
      hud.showMessage(`${others.map(pilotName).join(' and ')} took the ${asteroid.size} ${asteroid.identified ? asteroid.material : 'rock'} (${formatCredits(payout.amount)})`, 'info', 3);
    } else if (dealt.player) {
      feedback.kill(point, `${label}  NO CONTRACT`);
    }
    return mine;
  }

  /** An asteroid reached the planet: its contract is gone. Returns its value. */
  lose(asteroid: Asteroid): number {
    const value = this.values.get(asteroid.id) ?? 0;
    this.values.delete(asteroid.id);
    this.damage.delete(asteroid.id);
    this.chasers.delete(asteroid.id);
    if (value > 0) {
      this.deps.events.emit({ type: 'contract-lost', site: asteroid.threatensSite });
      this.fieldLost += value;
      this.contractsLost += 1;
    }
    return value;
  }

  /** Line under the board: this field's earnings, or a note during calm. */
  summary(inField: boolean): string {
    if (!inField) {
      return 'Calm zone: defence contracts post when the next field arrives';
    }
    const lost = this.fieldLost > 0 ? ` · lost ${formatCredits(this.fieldLost)}` : '';
    return `This field: earned ${formatCredits(this.fieldEarned)}${lost}`;
  }

  /** Forget asteroids that left without anyone being paid. */
  forget(asteroid: Asteroid): void {
    this.values.delete(asteroid.id);
    this.damage.delete(asteroid.id);
  }
}

function trueValue(asteroid: Asteroid): number {
  if (burnsUp(asteroid.size, asteroid.material)) {
    return 0;
  }
  return contractValue(asteroid.planetDamage, asteroid.threatensSite);
}
