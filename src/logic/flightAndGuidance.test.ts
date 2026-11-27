import { describe, expect, it } from 'vitest';
import { FLIGHT, gravityAt, orbitSpeedAt, stepVelocity, stoppingDistance, stoppingTime, type FlightCommand, type FlightFrame } from './flightModel';
import { choosePriority, interceptVerdict, travelTime, turnCue } from './guidance';
import type { Vec3Tuple } from './random';
import { PLANET_RADIUS } from './units';

const IDLE: FlightCommand = { thrust: 0, brake: 0, strafe: 0, lift: 0, boost: false };

function frame(velocity: Vec3Tuple, assist: boolean, position: Vec3Tuple = [0, 0, 100]): FlightFrame {
  return { velocity, forward: [0, 0, -1], right: [1, 0, 0], up: [0, 1, 0], position, assist, power: 1 };
}

function fly(start: Vec3Tuple, assist: boolean, command: FlightCommand, seconds: number, position?: Vec3Tuple): Vec3Tuple {
  let velocity = start;
  for (let time = 0; time < seconds; time += 1 / 60) {
    velocity = stepVelocity(frame(velocity, assist, position), command, 1 / 60);
  }
  return velocity;
}

describe('flight model', () => {
  it('keeps the ship moving when the engines are off: nothing slows it in space', () => {
    const velocity = fly([0, 0, -15], true, IDLE, 10);
    expect(velocity[2]).toBeCloseTo(-15, 6);
  });

  it('accelerates to cruise speed and no further', () => {
    const velocity = fly([0, 0, 0], true, { ...IDLE, thrust: 1 }, 10);
    expect(-velocity[2]).toBeCloseTo(FLIGHT.cruiseSpeed, 6);
  });

  it('goes faster with boost, then settles back to cruise with the assist on', () => {
    const boosted = fly([0, 0, 0], true, { ...IDLE, thrust: 1, boost: true }, 10);
    expect(-boosted[2]).toBeCloseTo(FLIGHT.boostSpeed, 6);
    const settled = fly(boosted, true, IDLE, 12);
    expect(-settled[2]).toBeLessThan(FLIGHT.cruiseSpeed + 0.5);
    expect(-settled[2]).toBeGreaterThanOrEqual(FLIGHT.cruiseSpeed);
  });

  it('keeps boost speed with the assist off', () => {
    const coasting = fly([0, 0, -FLIGHT.boostSpeed], false, IDLE, 5, [0, 0, 1e9]);
    expect(-coasting[2]).toBeCloseTo(FLIGHT.boostSpeed, 3);
  });

  it('brakes to a stop from any direction and never reverses', () => {
    const stopped = fly([6, -3, -20], false, { ...IDLE, brake: 1 }, 3, [0, 0, 1e9]);
    expect(Math.hypot(...stopped)).toBeLessThan(1e-3);
    expect(stoppingTime(FLIGHT.cruiseSpeed)).toBeCloseTo(1, 6);
    expect(stoppingDistance(18)).toBeCloseTo(9, 6);
  });

  it('removes sideways drift with the assist on and keeps it with the assist off', () => {
    const assisted = fly([8, 0, -10], true, IDLE, 4);
    expect(Math.abs(assisted[0])).toBeLessThan(0.01);
    expect(assisted[2]).toBeCloseTo(-10, 6);
    const free = fly([8, 0, -10], false, IDLE, 4, [0, 0, 1e9]);
    expect(free[0]).toBeCloseTo(8, 3);
  });

  it('slides sideways and up on the side thrusters, up to their limit', () => {
    const sliding = fly([0, 0, 0], true, { ...IDLE, strafe: 1, lift: -1 }, 5);
    expect(sliding[0]).toBeCloseTo(FLIGHT.sideSpeed, 6);
    expect(sliding[1]).toBeCloseTo(-FLIGHT.sideSpeed, 6);
  });

  it('holds the ship against gravity with the assist on and lets it fall with it off', () => {
    const position: Vec3Tuple = [0, PLANET_RADIUS + 20, 0];
    expect(fly([0, 0, 0], true, IDLE, 3, position)).toEqual([0, 0, 0]);
    const falling = fly([0, 0, 0], false, IDLE, 3, position);
    expect(falling[1]).toBeCloseTo(-gravityAt(PLANET_RADIUS + 20) * 3, 1);
  });

  it('weakens gravity with the square of distance and gives a slow orbit speed', () => {
    expect(gravityAt(PLANET_RADIUS)).toBe(FLIGHT.surfaceGravity);
    expect(gravityAt(PLANET_RADIUS * 2)).toBeCloseTo(FLIGHT.surfaceGravity / 4, 10);
    expect(orbitSpeedAt(PLANET_RADIUS * 1.5)).toBeLessThan(FLIGHT.cruiseSpeed);
  });

  it('coasts around the planet at orbit speed with the assist off', () => {
    const radius = PLANET_RADIUS + 20;
    let position: Vec3Tuple = [radius, 0, 0];
    let velocity: Vec3Tuple = [0, 0, -orbitSpeedAt(radius)];
    const step = 1 / 120;
    for (let time = 0; time < 120; time += step) {
      velocity = stepVelocity({ ...frame(velocity, false, position) }, IDLE, step);
      position = [position[0] + velocity[0] * step, position[1] + velocity[1] * step, position[2] + velocity[2] * step];
      const distance = Math.hypot(...position);
      expect(Math.abs(distance - radius)).toBeLessThan(0.5);
    }
  });

  it('loses engine power with an empty tank', () => {
    const weak = stepVelocity({ ...frame([0, 0, 0], true), power: 0.25 }, { ...IDLE, thrust: 1 }, 1);
    expect(-weak[2]).toBeCloseTo(FLIGHT.thrust * 0.25, 6);
  });
});

describe('guidance', () => {
  it('is already there when the target is inside weapon range', () => {
    expect(travelTime(0, 0, 48, 30)).toBe(0);
    expect(travelTime(-5, 0, 48, 30)).toBe(0);
  });

  it('counts acceleration and then top speed', () => {
    // From rest at 10/s² to 20: 2 s and 20 units, then 80 more units at 20.
    expect(travelTime(100, 0, 20, 10)).toBeCloseTo(6, 6);
    expect(travelTime(5, 0, 20, 10)).toBeCloseTo(1, 6);
    expect(travelTime(100, 20, 20, 10)).toBeCloseTo(5, 6);
    // Flying away does not count as negative progress.
    expect(travelTime(100, -30, 20, 10)).toBeCloseTo(6, 6);
  });

  it('judges whether the ship arrives before the asteroid lands', () => {
    expect(interceptVerdict(0, 30)).toBe('in-range');
    expect(interceptVerdict(10, 60)).toBe('in-time');
    expect(interceptVerdict(25, 30)).toBe('tight');
    expect(interceptVerdict(40, 30)).toBe('too-late');
  });

  it('picks the most urgent threat that can still be reached', () => {
    const choice = choosePriority([
      { item: 'lost', reachSeconds: 50, impactSeconds: 20 },
      { item: 'close call', reachSeconds: 20, impactSeconds: 26 },
      { item: 'easy', reachSeconds: 5, impactSeconds: 90 },
    ]);
    expect(choice?.item).toBe('close call');
    expect(choice?.verdict).toBe('tight');
  });

  it('still shows the most urgent threat when nothing can be reached', () => {
    const choice = choosePriority([
      { item: 'first', reachSeconds: 50, impactSeconds: 20 },
      { item: 'second', reachSeconds: 90, impactSeconds: 30 },
    ]);
    expect(choice?.item).toBe('first');
    expect(choice?.verdict).toBe('too-late');
    expect(choosePriority([])).toBeNull();
  });

  it('tells the pilot which way to turn', () => {
    expect(turnCue(0, 0, -100)).toBe('AHEAD');
    expect(turnCue(0, 0, 100)).toBe('BEHIND');
    expect(turnCue(50, 2, -10)).toBe('RIGHT');
    expect(turnCue(-50, 2, 10)).toBe('LEFT');
    expect(turnCue(3, 60, -10)).toBe('UP');
    expect(turnCue(-40, -40, -10)).toBe('DOWN LEFT');
  });
});
