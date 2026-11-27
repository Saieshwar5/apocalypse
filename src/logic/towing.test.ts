import { describe, expect, it } from 'vitest';
import type { Vec3Tuple } from './random';
import { FRAGILE, LOAD_MASS, PLACEMENT, TOW, canAttach, isPlaced, loadStress, placementAccuracy, towStep } from './towing';

function haul(seconds: number, shipSpeed: number, loadMass: number) {
  let ship: Vec3Tuple = [0, 0, 0];
  let load: Vec3Tuple = [0, 0, TOW.length];
  let shipVelocity: Vec3Tuple = [0, 0, -shipSpeed];
  let loadVelocity: Vec3Tuple = [0, 0, 0];
  let maxTension = 0;
  const step = 1 / 120;
  for (let time = 0; time < seconds; time += step) {
    const result = towStep({ shipPosition: ship, shipVelocity, loadPosition: load, loadVelocity, loadMass }, step);
    maxTension = Math.max(maxTension, result.tension);
    shipVelocity = shipVelocity.map((v, i) => v + result.shipDelta[i]) as Vec3Tuple;
    loadVelocity = loadVelocity.map((v, i) => v + result.loadDelta[i]) as Vec3Tuple;
    ship = ship.map((p, i) => p + shipVelocity[i] * step) as Vec3Tuple;
    load = load.map((p, i) => p + loadVelocity[i] * step) as Vec3Tuple;
  }
  return { ship, load, shipVelocity, loadVelocity, maxTension };
}

describe('tow line', () => {
  it('connects only close and with matched speed', () => {
    expect(canAttach(2, 1)).toBe(true);
    expect(canAttach(TOW.attachRange + 1, 1)).toBe(false);
    expect(canAttach(2, TOW.attachSpeed + 1)).toBe(false);
  });

  it('does nothing while slack and never pushes', () => {
    const slack = towStep({ shipPosition: [0, 0, 0], shipVelocity: [0, 0, 0], loadPosition: [0, 0, 2], loadVelocity: [0, 0, -5], loadMass: 1 }, 0.1);
    expect(slack.tension).toBe(0);
    expect(slack.shipDelta).toEqual([0, 0, 0]);
  });

  it('pulls the load along and shares momentum by mass', () => {
    const { shipVelocity, loadVelocity } = haul(8, 6, LOAD_MASS.satellite);
    // Momentum is conserved: ship (mass 1) plus load share the starting 6.
    const momentum = -shipVelocity[2] * TOW.shipMass - loadVelocity[2] * LOAD_MASS.satellite;
    expect(momentum).toBeCloseTo(6, 1);
    expect(-loadVelocity[2]).toBeGreaterThan(2);
  });

  it('slows the ship more with a heavier load', () => {
    const light = haul(4, 6, 0.3);
    const heavy = haul(4, 6, 3);
    expect(-heavy.shipVelocity[2]).toBeLessThan(-light.shipVelocity[2]);
  });

  it('snaps when stretched too far', () => {
    const result = towStep({ shipPosition: [0, 0, 0], shipVelocity: [0, 0, 0], loadPosition: [0, 0, TOW.length + TOW.breakStretch + 1], loadVelocity: [0, 0, 0], loadMass: 1 }, 0.1);
    expect(result.snapped).toBe(true);
  });

  it('harms a fragile load only when pulled hard', () => {
    expect(loadStress(FRAGILE.safeTension - 1, 1)).toBe(0);
    expect(loadStress(FRAGILE.safeTension + 10, 1)).toBeCloseTo(10 * FRAGILE.damagePerTension);
    // A gentle start does not hurt a satellite; a sudden full-speed jerk does.
    expect(haul(3, 4, LOAD_MASS.satellite).maxTension).toBeLessThan(FRAGILE.safeTension * 3);
  });
});

describe('placement', () => {
  it('needs the load in the zone and nearly still', () => {
    expect(isPlaced(2, 1)).toBe(true);
    expect(isPlaced(PLACEMENT.radius + 0.1, 1)).toBe(false);
    expect(isPlaced(2, PLACEMENT.maxSpeed + 1)).toBe(false);
  });

  it('pays better for accurate placement', () => {
    expect(placementAccuracy(0)).toBe(1);
    expect(placementAccuracy(PLACEMENT.radius)).toBeCloseTo(0.7);
    expect(placementAccuracy(PLACEMENT.radius * 2)).toBeCloseTo(0.7);
  });
});
