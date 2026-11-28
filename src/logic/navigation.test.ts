import { describe, expect, it } from 'vitest';
import {
  arrivalSeconds,
  compassPoint,
  nextObjectiveMode,
  resolveObjective,
  scannerRange,
  steeringCue,
  type ObjectiveOptions,
} from './navigation';

describe('target compass', () => {
  it('puts what is ahead in the centre and marks it on target', () => {
    const point = compassPoint([0, 0, -10]);
    expect(point.onTarget).toBe(true);
    expect(Math.hypot(point.x, point.y)).toBeCloseTo(0);
    expect(steeringCue([0, 0, -10])).toBeNull();
  });

  it('shows which way to turn in screen terms', () => {
    const right = compassPoint([10, 0, -10]);
    expect(right.x).toBeGreaterThan(0);
    expect(right.behind).toBe(false);
    const up = compassPoint([0, 10, -10]);
    // Screen y grows downwards, so "up" is negative.
    expect(up.y).toBeLessThan(0);
    expect(steeringCue([0, 10, -10])?.direction).toBeCloseTo(-Math.PI / 2);
  });

  it('marks things behind and keeps them on the outer ring', () => {
    const behindLeft = compassPoint([-1, 0, 10]);
    expect(behindLeft.behind).toBe(true);
    expect(behindLeft.x).toBeLessThan(0);
    expect(Math.hypot(behindLeft.x, behindLeft.y)).toBeGreaterThan(0.78);
    // Dead astern still gives a direction to turn.
    const astern = compassPoint([0, 0, 10]);
    expect(astern.y).toBeCloseTo(1);
  });

  it('works out arrival time only while closing', () => {
    expect(arrivalSeconds(100, 10)).toBe(10);
    expect(arrivalSeconds(100, -3)).toBeNull();
  });
});

describe('objectives', () => {
  const all: ObjectiveOptions = { threat: true, job: true, station: true, home: true, needsHome: false };

  it('points at the priority rock, a job, or home when the ship needs it', () => {
    expect(resolveObjective('auto', all)).toBe('threat');
    expect(resolveObjective('auto', { ...all, threat: false })).toBe('job');
    expect(resolveObjective('auto', { ...all, needsHome: true })).toBe('home');
    expect(resolveObjective('auto', { ...all, threat: false, job: false })).toBeNull();
  });

  it('points at the delivery while something is on the tow line', () => {
    expect(resolveObjective('auto', { ...all, committed: true })).toBe('job');
    expect(resolveObjective('auto', { ...all, committed: true, needsHome: true })).toBe('job');
    // The pilot can still choose otherwise.
    expect(resolveObjective('home', { ...all, committed: true })).toBe('home');
  });

  it('keeps the pilot choice while it exists', () => {
    expect(resolveObjective('station', all)).toBe('station');
    expect(resolveObjective('job', { ...all, job: false })).toBe('threat');
  });

  it('cycles through what is available', () => {
    const noJob = { ...all, job: false };
    expect(nextObjectiveMode('auto', noJob)).toBe('threat');
    expect(nextObjectiveMode('threat', noJob)).toBe('station');
    expect(nextObjectiveMode('home', noJob)).toBe('auto');
  });
});

describe('scanner range', () => {
  it('zooms in automatically to keep the objective readable', () => {
    expect(scannerRange('auto', 390, 30)).toBe(70);
    expect(scannerRange('auto', 390, 120)).toBe(180);
    expect(scannerRange('auto', 390, 300)).toBe(390);
    expect(scannerRange('auto', 390, null)).toBe(390);
  });

  it('respects a chosen range and a damaged scanner', () => {
    expect(scannerRange('close', 390, 300)).toBe(70);
    expect(scannerRange('far', 390, 10)).toBe(390);
    expect(scannerRange('medium', 120, 10)).toBe(120);
  });
});
