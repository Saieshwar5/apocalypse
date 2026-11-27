import { MAX_PLANET_INTEGRITY } from '../logic/planetDamage';
import { Wallet } from '../logic/economy';

/** Money and progress for one play-through. */
export class GameSession {
  integrity = MAX_PLANET_INTEGRITY;
  /** The pilot's money: contracts pay in, the station and fines take out. */
  readonly wallet = new Wallet();
  asteroidsDestroyed = 0;
  impactsThisWave = 0;
  destroyedThisWave = 0;
  totalImpacts = 0;
  wavesCleared = 0;
  sitesLost = 0;
  /** Asteroids that burned up harmlessly in the atmosphere. */
  burnUps = 0;

  /** New star system in the same campaign: the planet is fresh, the money carries on. */
  resetForNextSystem(): void {
    const { asteroidsDestroyed } = this;
    const { balance, earned, spent, fines } = this.wallet;
    this.reset();
    Object.assign(this.wallet, { balance, earned, spent, fines });
    this.asteroidsDestroyed = asteroidsDestroyed;
  }

  reset(): void {
    this.integrity = MAX_PLANET_INTEGRITY;
    this.wallet.reset();
    this.asteroidsDestroyed = 0;
    this.impactsThisWave = 0;
    this.destroyedThisWave = 0;
    this.totalImpacts = 0;
    this.wavesCleared = 0;
    this.sitesLost = 0;
    this.burnUps = 0;
  }
}
