import type { StationId } from './stations';

/**
 * The orbit's small economy: two goods, fuel and parts. Ceres Works makes
 * both from hauled asteroids (and a trickle from its own mining drones);
 * automatic shuttles carry them to whichever station is running shortest;
 * Aegis builds missiles from parts and Vulcan Yard repairs satellites with
 * them. Prices follow stock, so fuel is cheap where it is plentiful.
 */
export type Good = 'fuel' | 'parts';
export type Stock = Record<Good, number>;

export interface StationMarketDefinition {
  capacity: Stock;
  start: Stock;
  /** Price of a unit at half stock, in credits. */
  basePrice: Stock;
  /** Goods the station sells to pilots. */
  sells: readonly Good[];
}

export const MARKETS: Record<StationId, StationMarketDefinition> = {
  aegis: { capacity: { fuel: 400, parts: 60 }, start: { fuel: 260, parts: 20 }, basePrice: { fuel: 2, parts: 8 }, sells: ['fuel'] },
  vulcan: { capacity: { fuel: 200, parts: 80 }, start: { fuel: 80, parts: 30 }, basePrice: { fuel: 2.4, parts: 7 }, sells: ['fuel'] },
  ceres: { capacity: { fuel: 500, parts: 150 }, start: { fuel: 320, parts: 60 }, basePrice: { fuel: 1.2, parts: 5 }, sells: ['fuel'] },
  halo: { capacity: { fuel: 250, parts: 40 }, start: { fuel: 120, parts: 10 }, basePrice: { fuel: 2.2, parts: 8 }, sells: ['fuel'] },
  // The great stations hold far more, and use it (see logic/cities).
  meridian: { capacity: { fuel: 700, parts: 160 }, start: { fuel: 420, parts: 90 }, basePrice: { fuel: 2.1, parts: 7 }, sells: ['fuel'] },
  anchor: { capacity: { fuel: 600, parts: 90 }, start: { fuel: 330, parts: 50 }, basePrice: { fuel: 1.4, parts: 7 }, sells: ['fuel'] },
  farwatch: { capacity: { fuel: 320, parts: 110 }, start: { fuel: 190, parts: 60 }, basePrice: { fuel: 2.6, parts: 8 }, sells: ['fuel'] },
};

/** Prices run from 0.7x the base price with a full store to 1.6x when it is nearly empty. */
export function unitPrice(basePrice: number, stock: number, capacity: number): number {
  const share = capacity > 0 ? Math.min(1, Math.max(0, stock / capacity)) : 0;
  return Math.round(basePrice * (0.7 + 0.9 * (1 - share)) * 10) / 10;
}

/** What Ceres makes from a tonne of hauled rock. */
export const REFINERY = { fuelPerTonne: 8, partsPerTonne: 2 } as const;
/** Ceres's own mining drones: a trickle per second, so the economy runs if nobody hauls. */
export const DRONE_OUTPUT: Stock = { fuel: 0.6, parts: 0.11 };
/** Ceres pays this per tonne of rock delivered to its intake. */
export const HAUL_PAY_PER_TONNE = 40;

/** Aegis turns parts into missiles at this rate while it has parts and room. */
export const MISSILE_WORKSHOP = { partsPerMissile: 1, secondsPerMissile: 12 } as const;
/** Vulcan Yard uses this many parts per satellite; without them the repair is slower. */
export const YARD_PARTS = { perRepair: 6, slowdownWithout: 3 } as const;

/** Each working satellite pays the pilot this much when a field is cleared. */
export const SATELLITE_INCOME = 15;

export const SHUTTLE = { capacity: 40, intervalSeconds: 35, travelSeconds: 30 } as const;

export interface ShuttleRoute {
  from: StationId;
  to: StationId;
  good: Good;
  amount: number;
}

/**
 * The next shuttle run: from Ceres to the station whose store of fuel or
 * parts is emptiest (as a share of capacity), if any is below 60%.
 */
export function planShuttle(stocks: Record<StationId, Stock>): ShuttleRoute | null {
  let best: { station: StationId; good: Good; share: number } | null = null;
  for (const station of Object.keys(MARKETS) as StationId[]) {
    if (station === 'ceres') {
      continue;
    }
    for (const good of ['fuel', 'parts'] as const) {
      const share = stocks[station][good] / MARKETS[station].capacity[good];
      if (share < 0.6 && (!best || share < best.share)) {
        best = { station, good, share };
      }
    }
  }
  if (!best) {
    return null;
  }
  const available = stocks.ceres[best.good];
  const room = MARKETS[best.station].capacity[best.good] - stocks[best.station][best.good];
  const amount = Math.floor(Math.min(SHUTTLE.capacity * (best.good === 'parts' ? 0.5 : 1), available * 0.5, room));
  return amount >= 2 ? { from: 'ceres', to: best.station, good: best.good, amount } : null;
}

/** Tonnes in a rock of this radius: loose, light material for haul jobs. */
export function haulTonnes(radius: number): number {
  return Math.round(radius * radius * radius * 6 * 10) / 10;
}

/** The rock's mass on the tow line, relative to the ship: hauls are very heavy. */
export function haulLoadMass(tonnes: number): number {
  return Math.max(1, tonnes * 0.45);
}
