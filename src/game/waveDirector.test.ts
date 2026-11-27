import { describe, expect, it } from 'vitest';
import { createSeededRandom } from '../logic/random';
import { BREAK_SECONDS, WaveDirector, type WaveEvent } from './waveDirector';

/** Steps the director, counting spawned asteroids as live until `destroyAll`. */
class Simulation {
  live = 0;
  readonly events: WaveEvent[] = [];

  constructor(readonly director: WaveDirector) {}

  run(seconds: number): WaveEvent[] {
    const produced: WaveEvent[] = [];
    for (let time = 0; time < seconds; time += 0.1) {
      const events = this.director.update(0.1, this.live);
      this.live += events.filter((event) => event.type === 'spawn').length;
      produced.push(...events);
    }
    this.events.push(...produced);
    return produced;
  }
}

describe('WaveDirector', () => {
  it('starts the first wave after the break and releases every planned asteroid', () => {
    const director = new WaveDirector(createSeededRandom(5));
    director.reset(2);
    const simulation = new Simulation(director);
    expect(simulation.run(1)).toEqual([]);

    const events = simulation.run(200);
    const started = events.filter((event) => event.type === 'wave-started');
    expect(started).toHaveLength(1);
    const planned = started[0].type === 'wave-started' ? started[0].plan.spawns.length : -1;
    expect(events.filter((event) => event.type === 'spawn')).toHaveLength(planned);
  });

  it('waits for the last asteroid to be gone before clearing the wave', () => {
    const director = new WaveDirector(createSeededRandom(5));
    director.reset(0.1);
    const simulation = new Simulation(director);
    expect(simulation.run(120).some((event) => event.type === 'wave-cleared')).toBe(false);

    simulation.live = 0;
    expect(director.update(0.1, 0)).toEqual([{ type: 'wave-cleared', wave: 1 }]);
    expect(director.phase).toBe('break');
    expect(director.breakRemaining).toBe(BREAK_SECONDS);
  });
});
