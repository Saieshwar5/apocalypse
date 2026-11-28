import type { Asteroid } from '../asteroids/asteroidField';
import type { SoundEffects } from '../audio/soundEffects';

/**
 * Beeps that need no looking: a fast one for something about to hit the ship
 * (a rock or a satellite in its path), a slow one while a heavy rock is
 * seconds from the planet.
 */
export class WarningBeeps {
  private timer = 0;

  constructor(private readonly sound: SoundEffects) {}

  update(deltaSeconds: number, collisionAhead: boolean, asteroids: readonly Asteroid[]): void {
    this.timer -= deltaSeconds;
    if (this.timer > 0) {
      return;
    }
    if (collisionAhead) {
      this.sound.warningBeep(true);
      this.timer = 0.22;
      return;
    }
    const imminent = asteroids.some((asteroid) => asteroid.size !== 'small' && asteroid.timeToImpact !== null && asteroid.timeToImpact < 10);
    if (imminent) {
      this.sound.warningBeep(false);
      this.timer = 1.1;
    }
  }
}
