import type { RandomSource } from '../logic/random';
import { planWave, type AsteroidSpawnPlan, type WavePlan } from '../logic/waves';

export type WaveEvent =
  | { type: 'wave-started'; plan: WavePlan }
  | { type: 'spawn'; spawn: AsteroidSpawnPlan }
  | { type: 'wave-cleared'; wave: number };

/** Pause between waves. Later this becomes the safe zone of the orbit map. */
export const BREAK_SECONDS = 10;

/**
 * Turns wave plans into timed events: start a wave, release each asteroid on
 * schedule, and report the wave cleared once every asteroid is gone. It has
 * no scene access, so it can be tested on its own.
 */
export class WaveDirector {
  wave = 0;
  phase: 'break' | 'active' = 'break';
  breakRemaining = BREAK_SECONDS;
  private pending: AsteroidSpawnPlan[] = [];
  private elapsed = 0;

  constructor(private readonly rng: RandomSource) {}

  /** `liveAsteroids` is how many asteroids are still in flight. */
  update(deltaSeconds: number, liveAsteroids: number): WaveEvent[] {
    const events: WaveEvent[] = [];
    if (this.phase === 'break') {
      this.breakRemaining -= deltaSeconds;
      if (this.breakRemaining <= 0) {
        this.wave += 1;
        const plan = planWave(this.wave, this.rng);
        this.pending = [...plan.spawns];
        this.elapsed = 0;
        this.phase = 'active';
        events.push({ type: 'wave-started', plan });
      }
      return events;
    }

    this.elapsed += deltaSeconds;
    while (this.pending.length > 0 && this.pending[0].delaySeconds <= this.elapsed) {
      const spawn = this.pending.shift();
      if (spawn) {
        events.push({ type: 'spawn', spawn });
      }
    }
    const spawnedThisFrame = events.length;
    if (this.pending.length === 0 && liveAsteroids + spawnedThisFrame === 0) {
      events.push({ type: 'wave-cleared', wave: this.wave });
      this.phase = 'break';
      this.breakRemaining = BREAK_SECONDS;
    }
    return events;
  }

  reset(firstWaveDelay = BREAK_SECONDS): void {
    this.wave = 0;
    this.phase = 'break';
    this.breakRemaining = firstWaveDelay;
    this.pending = [];
    this.elapsed = 0;
  }
}
