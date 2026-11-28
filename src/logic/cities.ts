import { MARKETS, type Stock } from './stationEconomy';
import type { StationId } from './stations';

/**
 * The three great stations, one in each orbit. Meridian is the city in the
 * middle; Anchor is the port low down, where supplies come up from Earth;
 * Farwatch is the lookout and shipyard far out. Each lives on fuel and
 * parts, uses them up every second, and shows how it is doing: lights
 * burn bright when it is well supplied and go dim as it runs short.
 */
export type CityId = 'meridian' | 'anchor' | 'farwatch';

export const CITY_IDS: readonly CityId[] = ['meridian', 'anchor', 'farwatch'];

export function isCity(station: StationId): station is CityId {
  return (CITY_IDS as readonly string[]).includes(station);
}

/** Fuel and parts used per second (negative: made). Anchor lifts fuel up from Earth while it is supplied with parts. */
export const CITY_USE: Record<CityId, Stock> = {
  meridian: { fuel: 0.7, parts: 0.1 },
  anchor: { fuel: -0.3, parts: 0.04 },
  farwatch: { fuel: 0.3, parts: 0.07 },
};

export type CityState = 'thriving' | 'steady' | 'short' | 'failing';

export const CITY_STATE_NAME: Record<CityState, string> = { thriving: 'thriving', steady: 'steady', short: 'running short', failing: 'failing' };

/** How well supplied a station is: its emptier store, as a share of full. */
export function supplyShare(station: StationId, stock: Stock): number {
  const capacity = MARKETS[station].capacity;
  return Math.min(1, Math.max(0, Math.min(stock.fuel / capacity.fuel, stock.parts / capacity.parts)));
}

export function cityState(share: number): CityState {
  if (share >= 0.55) {
    return 'thriving';
  }
  if (share >= 0.28) {
    return 'steady';
  }
  return share >= 0.1 ? 'short' : 'failing';
}

/** How brightly the station's windows burn, 0..1. */
export function cityLights(share: number): number {
  return 0.15 + 0.85 * Math.min(1, share / 0.55);
}

/**
 * Farwatch watches the stream: well supplied, the scanner sees further and
 * rocks are found sooner; starved, the lookout goes half blind.
 */
export const WATCH_RANGE: Record<CityState, number> = { thriving: 1.15, steady: 1, short: 0.85, failing: 0.7 };

/** One step of a city's use of its stores. Anchor only lifts fuel while it has parts to run on. */
export function stepCity(city: CityId, stock: Stock, deltaSeconds: number): Stock {
  const use = CITY_USE[city];
  const capacity = MARKETS[city].capacity;
  const parts = Math.max(0, stock.parts - use.parts * deltaSeconds);
  const working = use.fuel >= 0 || stock.parts > 0;
  const fuel = working ? Math.min(capacity.fuel, Math.max(0, stock.fuel - use.fuel * deltaSeconds)) : stock.fuel;
  return { fuel, parts };
}
