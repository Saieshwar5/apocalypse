import type * as THREE from 'three';
import type { Asteroid } from '../asteroids/asteroidField';
import type { CombatFeedback } from '../hud/combatFeedback';
import type { Hud } from '../hud/hud';
import { ASTEROID_CLASSES } from '../logic/asteroidClasses';
import { contractPayout, contractValue, formatCredits, type ContractOutcome } from '../logic/contracts';
import { burnsUp } from '../logic/planetDamage';
import type { Wallet } from '../logic/economy';

export interface ContractBookDependencies {
  wallet: Wallet;
  hud: Hud;
  feedback: CombatFeedback;
}

/** One line on the contract board. */
export interface ContractListing {
  asteroid: Asteroid;
  /** What the board offers: exact once scanned, an estimate before. */
  pay: number;
  estimate: boolean;
}

/**
 * The Earth Defence Authority's open contracts: one for every asteroid on an
 * impact course. Keeps each contract's value up to date, pays the pilot when
 * a threat is neutralised and records what was lost when one gets through.
 */
export class ContractBook {
  /** Contract value per asteroid id, kept after a rock is knocked off course. */
  private readonly values = new Map<number, number>();
  /** Credits earned and lost in the current debris field. */
  fieldEarned = 0;
  fieldLost = 0;
  contractsCompleted = 0;
  contractsLost = 0;

  constructor(private readonly deps: ContractBookDependencies) {}

  reset(): void {
    this.values.clear();
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
          listings.push({ asteroid, pay, estimate: false });
        }
      } else {
        // Before a scan the Authority quotes the class average.
        listings.push({ asteroid, pay: contractValue(ASTEROID_CLASSES[asteroid.size].planetDamage, asteroid.threatensSite), estimate: true });
      }
    }
    return listings;
  }

  /** What the board shows for one asteroid; 0 when it carries no contract. */
  offerFor(asteroid: Asteroid): number {
    return this.listings([asteroid])[0]?.pay ?? 0;
  }

  /** Pays for a neutralised threat; returns the amount paid. */
  complete(asteroid: Asteroid, outcome: ContractOutcome, point: THREE.Vector3, label: string): number {
    const value = this.values.get(asteroid.id) ?? 0;
    this.values.delete(asteroid.id);
    const payout = contractPayout(value, outcome, asteroid.timeToImpact);
    const { wallet, feedback } = this.deps;
    if (payout.amount > 0) {
      wallet.earn(payout.amount);
      this.fieldEarned += payout.amount;
      this.contractsCompleted += 1;
      feedback.kill(point, `${label}  +${formatCredits(payout.amount)}${payout.early ? ' EARLY' : ''}`);
    } else {
      feedback.kill(point, `${label}  NO CONTRACT`);
    }
    return payout.amount;
  }

  /** An asteroid reached the planet: its contract is gone. Returns its value. */
  lose(asteroid: Asteroid): number {
    const value = this.values.get(asteroid.id) ?? 0;
    this.values.delete(asteroid.id);
    if (value > 0) {
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
  }
}

function trueValue(asteroid: Asteroid): number {
  if (burnsUp(asteroid.size, asteroid.material)) {
    return 0;
  }
  return contractValue(asteroid.planetDamage, asteroid.threatensSite);
}
