import { describe, expect, it } from 'vitest';
import { SWELL, inPlanetShadow, secondsUntilBurn } from './spaceWeather';

describe('solar storm shelter', () => {
  const sun: [number, number, number] = [1, 0, 0];

  it('finds the shadow behind the planet', () => {
    expect(inPlanetShadow([-60, 10, 0], sun, 40)).toBe(true);
    expect(inPlanetShadow([-60, 45, 0], sun, 40)).toBe(false);
    expect(inPlanetShadow([60, 0, 0], sun, 40)).toBe(false);
  });
});

describe('swollen atmosphere', () => {
  it('gives a sinking satellite a clear deadline', () => {
    expect(secondsUntilBurn(50, 50 - SWELL.sinkPerSecond * 30)).toBeCloseTo(30);
    expect(secondsUntilBurn(40, 45)).toBe(0);
  });
});
