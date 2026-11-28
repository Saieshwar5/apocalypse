import type { RandomSource } from './random';
import { MARKETS, type Good, type Stock } from './stationEconomy';
import type { StationId } from './stations';

/**
 * Cargo and passenger transfers between the stations: berth at one, the
 * load goes aboard; berth at the other, it is paid. Routine runs carry the
 * fuel and parts the stations really use, so a delivery changes prices and
 * what a station can do. Urgent runs race a clock, fragile loads lose value
 * with every hard knock, and passengers want a gentle ride with no boost.
 */
export type CargoKind = 'routine' | 'urgent' | 'fragile' | 'passengers';
export type CargoGood = Good | 'instruments' | 'people';

export const CARGO = {
  /** Fuel or parts in one load. */
  units: 60,
  /** Mass a full hold adds to the ship (the bare ship is 1). */
  mass: 0.3,
  basePay: 90,
  payPerUnitDistance: 0.9,
  /** Extra for a station that is nearly empty, falling to nothing for a full one. */
  shortagePay: 140,
  rate: { routine: 1, urgent: 1.5, fragile: 1.35, passengers: 1.4 } satisfies Record<CargoKind, number>,
  /** An urgent load delivered late is still wanted, at this share of its pay. */
  lateShare: 0.5,
  /** A fragile load loses this share of its pay per hard knock, down to the floor. */
  knockLoss: 0.15,
  fragileFloor: 0.4,
  /** Passengers dock this share per rough moment (a hard knock, or the boost), down to the floor. */
  roughLoss: 0.1,
  passengerFloor: 0.5,
} as const;

export const CARGO_KIND_NAME: Record<CargoKind, string> = { routine: 'Cargo', urgent: 'Urgent cargo', fragile: 'Fragile cargo', passengers: 'Passengers' };
export const CARGO_GOOD_NAME: Record<CargoGood, string> = { fuel: 'fuel', parts: 'parts', instruments: 'instruments', people: 'passengers' };

/** Seconds a well-flown run takes: loading to delivery. Also an urgent load's deadline. */
export function cargoParSeconds(distance: number): number {
  return Math.round(30 + Math.max(0, distance) / 3.5);
}

export interface CargoPayInput {
  kind: CargoKind;
  /** Straight-line distance between the stations when the job was posted. */
  distance: number;
  /** How empty the destination is of this good: 0 full, 1 empty. 0 for loads that are not stock. */
  shortage: number;
  /** Hard knocks (fragile) or rough moments (passengers) on the way. */
  knocks?: number;
  /** An urgent load that missed its deadline. */
  late?: boolean;
  /** The fitted modules' pay multiplier for this load. */
  moduleRate?: number;
}

export function cargoPay(input: CargoPayInput): number {
  const base = CARGO.basePay + Math.max(0, input.distance) * CARGO.payPerUnitDistance + Math.min(1, Math.max(0, input.shortage)) * CARGO.shortagePay;
  const knocks = Math.max(0, input.knocks ?? 0);
  let care = 1;
  if (input.kind === 'fragile') {
    care = Math.max(CARGO.fragileFloor, 1 - knocks * CARGO.knockLoss);
  } else if (input.kind === 'passengers') {
    care = Math.max(CARGO.passengerFloor, 1 - knocks * CARGO.roughLoss);
  }
  const late = input.kind === 'urgent' && input.late ? CARGO.lateShare : 1;
  return Math.round((base * CARGO.rate[input.kind] * care * late * (input.moduleRate ?? 1)) / 5) * 5;
}

export interface CargoPlan {
  kind: CargoKind;
  good: CargoGood;
  from: StationId;
  to: StationId;
  /** Units of fuel or parts; 0 for instruments and people. */
  units: number;
  /** How empty the destination is of the good, 0..1. */
  shortage: number;
}

/** The station (not Ceres, the depot) shortest of fuel or parts, and of which. */
export function neediest(stocks: Record<StationId, Stock>, stations: readonly StationId[]): { station: StationId; good: Good; share: number } | null {
  let best: { station: StationId; good: Good; share: number } | null = null;
  for (const station of stations) {
    if (station === 'ceres') {
      continue;
    }
    for (const good of ['fuel', 'parts'] as const) {
      const share = stocks[station][good] / MARKETS[station].capacity[good];
      if (!best || share < best.share) {
        best = { station, good, share };
      }
    }
  }
  return best;
}

const KIND_WEIGHT: Record<CargoKind, number> = { routine: 5, urgent: 2, fragile: 1.5, passengers: 1.5 };

/**
 * The next transfer on offer. `stations` are those that exist (Aegis can be
 * lost); `kinds` are those the pilot's rank allows. Stock runs go from the
 * depot at Ceres to whichever station is shortest.
 */
export function planCargo(stocks: Record<StationId, Stock>, stations: readonly StationId[], kinds: readonly CargoKind[], rng: RandomSource): CargoPlan | null {
  if (kinds.length === 0 || stations.length < 2) {
    return null;
  }
  const total = kinds.reduce((sum, kind) => sum + KIND_WEIGHT[kind], 0);
  let roll = rng() * total;
  let kind = kinds[kinds.length - 1];
  for (const candidate of kinds) {
    roll -= KIND_WEIGHT[candidate];
    if (roll < 0) {
      kind = candidate;
      break;
    }
  }
  if (kind === 'routine' || kind === 'urgent') {
    const need = stations.includes('ceres') ? neediest(stocks, stations) : null;
    if (!need) {
      return null;
    }
    const room = MARKETS[need.station].capacity[need.good] - stocks[need.station][need.good];
    const units = Math.floor(Math.min(CARGO.units, room, stocks.ceres[need.good]));
    if (units < 10) {
      return null;
    }
    return { kind, good: need.good, from: 'ceres', to: need.station, units, shortage: 1 - need.share };
  }
  // People live on Halo; instruments are built at Vulcan Yard. Either may be going out or coming home.
  const home: StationId = kind === 'passengers' ? 'halo' : 'vulcan';
  const others = stations.filter((station) => station !== home);
  if (!stations.includes(home) || others.length === 0) {
    return null;
  }
  const other = others[Math.floor(rng() * others.length)];
  const outbound = rng() < 0.5;
  return { kind, good: kind === 'passengers' ? 'people' : 'instruments', from: outbound ? home : other, to: outbound ? other : home, units: 0, shortage: 0 };
}
