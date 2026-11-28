import { describe, expect, it } from 'vitest';
import { bearingArrow, directorAdvice, meetingPoint, sortNavEntries, viaAround, type DirectorInput } from './flightDirector';

const trip: DirectorInput = {
  distance: 300,
  closingSpeed: 0,
  relativeSpeed: 0,
  angle: 0,
  brake: 18,
  cruiseSpeed: 18,
  boostSpeed: 38,
  arriveRange: 10,
  arriveSpeed: 3,
};

describe('flight director', () => {
  it('turns first, then burns, then coasts', () => {
    expect(directorAdvice({ ...trip, angle: 1 }).phase).toBe('turn');
    const burn = directorAdvice(trip);
    expect(burn.phase).toBe('burn');
    expect(burn.targetSpeed).toBe(38);
    const coast = directorAdvice({ ...trip, closingSpeed: 38, relativeSpeed: 38 });
    expect(coast.phase).toBe('coast');
    expect(coast.brakeIn).toBeGreaterThan(0);
  });

  it('calls for the brakes when the stopping distance runs out', () => {
    // 38 u/s needs about 46 units (with margin) to stop at 18 u/s²: 60 away still coasts, 55 away must brake.
    expect(directorAdvice({ ...trip, distance: 60, closingSpeed: 38, relativeSpeed: 38 }).phase).toBe('coast');
    expect(directorAdvice({ ...trip, distance: 55, closingSpeed: 38, relativeSpeed: 38 }).phase).toBe('brake');
    // Brake even while still turning: physics first.
    expect(directorAdvice({ ...trip, distance: 55, closingSpeed: 38, relativeSpeed: 38, angle: 1 }).phase).toBe('brake');
  });

  it('keeps short hops slow, and finishes by matching speed', () => {
    expect(directorAdvice({ ...trip, distance: 20 }).targetSpeed).toBeLessThan(18);
    expect(directorAdvice({ ...trip, distance: 8, relativeSpeed: 9 }).phase).toBe('arrive');
    expect(directorAdvice({ ...trip, distance: 8, relativeSpeed: 2 }).phase).toBe('arrived');
    // A little drift past the edge, slowly, still counts as arrived (no flicker back to BURN).
    expect(directorAdvice({ ...trip, distance: 11, relativeSpeed: 1 }).phase).toBe('arrived');
    expect(directorAdvice({ ...trip, distance: 11, relativeSpeed: 9 }).phase).not.toBe('arrived');
  });

  it('meets a moving target ahead of where it is now', () => {
    const meet = meetingPoint([0, 0, 0], [100, 0, 0], [0, 10, 0], 20);
    expect(meet.point[1]).toBeGreaterThan(40);
    expect(Math.hypot(...meet.point) / 20).toBeCloseTo(meet.seconds, 1);
    expect(meetingPoint([0, 0, 0], [100, 0, 0], [0, 50, 0], 1, 30).seconds).toBe(30);
  });
});

describe('routes round the planet', () => {
  it('goes straight when the planet is not in the way', () => {
    expect(viaAround([100, 0, 0], [100, 80, 0], 50, 8)).toBeNull();
    // Arriving at a low target, or leaving a low start: the closest approach is an end of the line.
    expect(viaAround([120, 0, 0], [48, 0, 0], 50, 8)).toBeNull();
  });

  it('steers for a point clear of the planet when the line crosses it', () => {
    const via = viaAround([90, 10, 0], [-90, 10, 0], 50, 8);
    expect(via).not.toBeNull();
    expect(Math.hypot(...(via as [number, number, number]))).toBeCloseTo(58);
    // On the side the line already leans towards.
    expect((via as [number, number, number])[1]).toBeGreaterThan(0);
    // Dead through the centre still gives a way round.
    expect(Math.hypot(...(viaAround([90, 0, 0], [-90, 0, 0], 50, 8) as [number, number, number]))).toBeCloseTo(58);
  });

  it('leads a ship all the way round without entering the safe radius', () => {
    let ship: [number, number, number] = [82, 0, 5];
    const target: [number, number, number] = [-70, 0, -8];
    let lowest = Infinity;
    for (let step = 0; step < 2000; step += 1) {
      const aim = viaAround(ship, target, 50, 8) ?? target;
      const offset = [aim[0] - ship[0], aim[1] - ship[1], aim[2] - ship[2]];
      const distance = Math.hypot(...offset);
      if (aim === target && distance < 1) {
        break;
      }
      ship = [ship[0] + (offset[0] / distance) * 0.5, ship[1] + (offset[1] / distance) * 0.5, ship[2] + (offset[2] / distance) * 0.5];
      lowest = Math.min(lowest, Math.hypot(...ship));
    }
    expect(Math.hypot(ship[0] - target[0], ship[1] - target[1], ship[2] - target[2])).toBeLessThan(1.5);
    expect(lowest).toBeGreaterThan(49);
  });
});

describe('navigation computer list', () => {
  it('puts jobs first, then stations, then the rest, nearest first', () => {
    const sorted = sortNavEntries([
      { group: 'satellite' as const, distance: 5 },
      { group: 'station' as const, distance: 50 },
      { group: 'job' as const, distance: 90 },
      { group: 'station' as const, distance: 20 },
    ]);
    expect(sorted.map((entry) => `${entry.group}${entry.distance}`)).toEqual(['job90', 'station20', 'station50', 'satellite5']);
  });

  it('draws small arrows for directions', () => {
    expect(bearingArrow(1, 0, false)).toBe('→');
    expect(bearingArrow(0, -1, false)).toBe('↑');
    expect(bearingArrow(-0.7, 0.7, true)).toBe('↙⟲');
    expect(bearingArrow(0, 0, false)).toBe('•');
  });
});
