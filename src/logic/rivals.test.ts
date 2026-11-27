import { describe, expect, it } from 'vitest';
import { autopilotCommand } from './autopilot';
import { stepVelocity } from './flightModel';
import type { Vec3Tuple } from './random';
import { RADIO, mayTalk, needsRefuel, rateContract, splitPay, type ContractOption } from './rivals';

const option = (overrides: Partial<ContractOption> = {}): ContractOption => ({
  kind: 'asteroid',
  pay: 200,
  travelSeconds: 10,
  deadlineSeconds: 40,
  bigGame: false,
  someoneCloser: false,
  ...overrides,
});

describe('rival choices', () => {
  it('ignores contracts it cannot reach in time or that someone closer will take', () => {
    expect(rateContract('hunter', option({ travelSeconds: 50 }))).toBe(-Infinity);
    expect(rateContract('hunter', option({ someoneCloser: true }))).toBe(-Infinity);
    expect(rateContract('hunter', option({ pay: 0 }))).toBe(-Infinity);
  });

  it('prefers close, well-paid work', () => {
    expect(rateContract('hunter', option({ travelSeconds: 5 }))).toBeGreaterThan(rateContract('hunter', option({ travelSeconds: 30 })));
    expect(rateContract('hunter', option({ pay: 400 }))).toBeGreaterThan(rateContract('hunter', option({ pay: 100 })));
  });

  it('gives each rival its speciality', () => {
    const satellite = option({ kind: 'satellite', deadlineSeconds: Infinity });
    const bigRock = option({ bigGame: true });
    expect(rateContract('hunter', bigRock)).toBeGreaterThan(rateContract('hunter', satellite));
    expect(rateContract('hunter', satellite)).toBe(0);
    expect(rateContract('hauler', satellite)).toBeGreaterThan(rateContract('hauler', bigRock));
  });

  it('heads home for fuel below a third of the tank', () => {
    expect(needsRefuel(20, 100)).toBe(true);
    expect(needsRefuel(50, 100)).toBe(false);
  });
});

describe('shared pay', () => {
  it('splits by damage dealt and loses nothing to rounding', () => {
    const shares = splitPay(180, { player: 30, kestrel: 15 });
    expect(shares.player).toBe(120);
    expect(shares.kestrel).toBe(60);
    const odd = splitPay(100, { player: 1, kestrel: 1, moth: 1 });
    expect((odd.player ?? 0) + (odd.kestrel ?? 0) + (odd.moth ?? 0)).toBe(100);
  });

  it('pays one pilot everything when only they did damage', () => {
    expect(splitPay(55, { moth: 9, player: 0 })).toEqual({ moth: 55 });
    expect(splitPay(55, {})).toEqual({});
    expect(splitPay(0, { player: 5 })).toEqual({});
  });
});

describe('radio rationing', () => {
  it('spaces out lines per rival and overall', () => {
    expect(mayTalk(100, 100 - RADIO.perRivalSeconds, 100 - RADIO.anySeconds)).toBe(true);
    expect(mayTalk(100, 95, 0)).toBe(false);
    expect(mayTalk(100, 0, 98)).toBe(false);
  });
});

describe('autopilot', () => {
  /** Flies a point-mass ship whose nose snaps to the command's aim. */
  function fly(start: Vec3Tuple, targetVelocity: Vec3Tuple, standOff: number, seconds: number) {
    let position: Vec3Tuple = [0, 0, 0];
    let velocity: Vec3Tuple = [0, 0, 0];
    let target = start;
    let forward: Vec3Tuple = [0, 0, -1];
    let arrivedAt: number | null = null;
    const step = 1 / 60;
    for (let time = 0; time < seconds; time += step) {
      const offset: Vec3Tuple = [target[0] - position[0], target[1] - position[1], target[2] - position[2]];
      const command = autopilotCommand({ offset, shipVelocity: velocity, targetVelocity, forward, standOff });
      if (command.arrived && arrivedAt === null) {
        arrivedAt = time;
      }
      forward = command.aim;
      const up: Vec3Tuple = Math.abs(forward[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const right: Vec3Tuple = normal(cross(forward, up));
      velocity = stepVelocity(
        { velocity, forward, right, up: cross(right, forward), position: [0, 0, 1e9], assist: true, power: 1 },
        { thrust: command.thrust, brake: command.brake, strafe: 0, lift: 0, boost: command.boost },
        step,
      );
      position = [position[0] + velocity[0] * step, position[1] + velocity[1] * step, position[2] + velocity[2] * step];
      target = [target[0] + targetVelocity[0] * step, target[1] + targetVelocity[1] * step, target[2] + targetVelocity[2] * step];
    }
    const gap = Math.hypot(target[0] - position[0], target[1] - position[1], target[2] - position[2]);
    const relativeSpeed = Math.hypot(velocity[0] - targetVelocity[0], velocity[1] - targetVelocity[1], velocity[2] - targetVelocity[2]);
    return { gap, relativeSpeed, arrivedAt };
  }

  it('flies to a still point and stops there', () => {
    const result = fly([120, 30, -80], [0, 0, 0], 0, 40);
    expect(result.gap).toBeLessThan(2);
    expect(result.relativeSpeed).toBeLessThan(1.5);
    expect(result.arrivedAt).not.toBeNull();
  });

  it('matches a moving target and holds its stand-off distance', () => {
    const result = fly([60, 0, -60], [3, 1, 0], 12, 40);
    expect(Math.abs(result.gap - 12)).toBeLessThan(2.5);
    expect(result.relativeSpeed).toBeLessThan(1.5);
  });
});

function cross(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normal(a: Vec3Tuple): Vec3Tuple {
  const size = Math.hypot(...a);
  return [a[0] / size, a[1] / size, a[2] / size];
}
