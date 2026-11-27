import { buildOrbitPlan, type Sector } from '../logic/orbitPlan';
import type { RandomSource } from '../logic/random';
import { planWave, type AsteroidSpawnPlan, type WavePlan } from '../logic/waves';

export type WaveEvent =
  | { type: 'sector-started'; index: number; sector: Sector; plan: WavePlan | null }
  | { type: 'spawn'; spawn: AsteroidSpawnPlan }
  | { type: 'wave-cleared'; wave: number }
  | { type: 'orbit-complete' };

/** Pause between two debris fields that have no calm zone between them. */
export const GAP_SECONDS = 6;

/**
 * Walks the planet through one orbit: calm zones that simply run down a
 * timer, and debris fields that release their asteroids on schedule and end
 * once every asteroid is gone. It has no scene access, so it can be tested
 * on its own.
 */
export class WaveDirector {
  sectors: Sector[] = buildOrbitPlan();
  index = -1;
  phase: 'calm' | 'field' | 'gap' | 'complete' = 'gap';
  /** Seconds left in a calm zone or gap. */
  remaining = 0;
  /** Wave number of the current or most recent field, for the HUD. */
  wave = 0;
  private pending: AsteroidSpawnPlan[] = [];
  private elapsed = 0;
  private fieldDuration = 1;

  constructor(private readonly rng: RandomSource) {}

  get sector(): Sector | null {
    return this.sectors[this.index] ?? null;
  }

  get nextSector(): Sector | null {
    return this.sectors[this.index + 1] ?? null;
  }

  /** Fraction of the orbit travelled, 0..1. */
  get progress(): number {
    if (this.phase === 'complete') {
      return 1;
    }
    const sector = this.sector;
    let within = 0;
    if (sector && this.phase === 'calm') {
      within = 1 - this.remaining / Math.max(sector.seconds, 1);
    } else if (sector && this.phase === 'field') {
      // A field is only finished once it is cleared, so stop short of its end.
      within = Math.min(0.92, this.elapsed / this.fieldDuration);
    } else if (this.phase === 'gap') {
      within = 1;
    }
    return clamp01((Math.max(this.index, 0) + within) / this.sectors.length);
  }

  reset(difficulty = 0): void {
    this.sectors = buildOrbitPlan(difficulty);
    this.index = -1;
    this.phase = 'gap';
    this.remaining = 0;
    this.wave = 0;
    this.pending = [];
    this.elapsed = 0;
  }

  /** Cuts a calm zone short when the pilot is ready. */
  skipCalm(): boolean {
    if (this.phase !== 'calm' || this.remaining <= 3) {
      return false;
    }
    this.remaining = 3;
    return true;
  }

  /** `liveAsteroids` is how many asteroids are still in flight. */
  update(deltaSeconds: number, liveAsteroids: number): WaveEvent[] {
    const events: WaveEvent[] = [];
    if (this.phase === 'complete') {
      return events;
    }
    if (this.phase === 'calm' || this.phase === 'gap') {
      this.remaining -= deltaSeconds;
      if (this.remaining <= 0) {
        this.advance(events);
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
    if (this.pending.length === 0 && liveAsteroids + events.length === 0) {
      events.push({ type: 'wave-cleared', wave: this.wave });
      if (this.index >= this.sectors.length - 1) {
        this.phase = 'complete';
        events.push({ type: 'orbit-complete' });
      } else if (this.nextSector?.kind === 'calm') {
        this.advance(events);
      } else {
        this.phase = 'gap';
        this.remaining = GAP_SECONDS;
      }
    }
    return events;
  }

  private advance(events: WaveEvent[]): void {
    this.index += 1;
    const sector = this.sectors[this.index];
    if (!sector) {
      this.phase = 'complete';
      events.push({ type: 'orbit-complete' });
      return;
    }
    if (sector.kind === 'calm') {
      this.phase = 'calm';
      this.remaining = sector.seconds;
      events.push({ type: 'sector-started', index: this.index, sector, plan: null });
      return;
    }
    const plan = planWave(sector.wave, this.rng);
    this.wave = sector.wave;
    this.pending = [...plan.spawns];
    this.elapsed = 0;
    this.fieldDuration = plan.durationSeconds + 25;
    this.phase = 'field';
    events.push({ type: 'sector-started', index: this.index, sector, plan });
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
