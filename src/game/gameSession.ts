import { MAX_PLANET_INTEGRITY } from '../logic/planetDamage';

/** Score and progress for one play-through. */
export class GameSession {
  integrity = MAX_PLANET_INTEGRITY;
  score = 0;
  asteroidsDestroyed = 0;
  impactsThisWave = 0;
  destroyedThisWave = 0;
  totalImpacts = 0;
  wavesCleared = 0;
  sitesLost = 0;
  /** Asteroids that burned up harmlessly in the atmosphere. */
  burnUps = 0;
  /** Credits spent on upgrades; credits available are score minus this. */
  spent = 0;

  /** New star system in the same campaign: the planet is fresh, the score carries on. */
  resetForNextSystem(): void {
    const { score, spent, asteroidsDestroyed } = this;
    this.reset();
    this.score = score;
    this.spent = spent;
    this.asteroidsDestroyed = asteroidsDestroyed;
  }

  reset(): void {
    this.integrity = MAX_PLANET_INTEGRITY;
    this.score = 0;
    this.asteroidsDestroyed = 0;
    this.impactsThisWave = 0;
    this.destroyedThisWave = 0;
    this.totalImpacts = 0;
    this.wavesCleared = 0;
    this.sitesLost = 0;
    this.burnUps = 0;
    this.spent = 0;
  }
}
