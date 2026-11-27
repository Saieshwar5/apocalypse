/** Ship fuel tank. Thrust and boost burn it; the laser does not. */
export const FUEL_CAPACITY = 100;
export const FUEL_BURN = { thrust: 0.9, boost: 3.2, strafe: 0.3 } as const;
/** With an empty tank the engines still give this share of their thrust. */
export const EMPTY_TANK_THRUST = 0.25;
export const LOW_FUEL = 25;

export function fuelBurned(thrust: number, strafe: number, boosting: boolean, deltaSeconds: number): number {
  const main = Math.abs(thrust) * (boosting ? FUEL_BURN.boost : FUEL_BURN.thrust);
  return (main + Math.abs(strafe) * FUEL_BURN.strafe) * deltaSeconds;
}

export function thrustScale(fuel: number): number {
  return fuel > 0 ? 1 : EMPTY_TANK_THRUST;
}

/** The ship must be this close to the station and this slow relative to it. */
export const DOCKING = { range: 9, promptRange: 22, maxRelativeSpeed: 7, approachSeconds: 3.5 } as const;

export type DockingReadiness = 'far' | 'too-fast' | 'ready';

export function dockingReadiness(distance: number, relativeSpeed: number): DockingReadiness {
  if (distance > DOCKING.promptRange) {
    return 'far';
  }
  return distance <= DOCKING.range && relativeSpeed <= DOCKING.maxRelativeSpeed ? 'ready' : 'too-fast';
}

export interface StationStock {
  fuel: number;
  missiles: number;
}

export const STATION_STOCK = {
  initial: { fuel: 260, missiles: 14 },
  capacity: { fuel: 400, missiles: 24 },
  /** Delivered by supply rocket after each wave while the Launch Complex stands. */
  delivery: { fuel: 110, missiles: 6 },
} as const;

/** Per second while docked. */
export const SERVICE_RATE = { fuel: 16, missilesPerSecond: 1.25, hull: 7, shield: 30 } as const;

export function deliverSupplies(stock: StationStock): StationStock {
  return {
    fuel: Math.min(STATION_STOCK.capacity.fuel, stock.fuel + STATION_STOCK.delivery.fuel),
    missiles: Math.min(STATION_STOCK.capacity.missiles, stock.missiles + STATION_STOCK.delivery.missiles),
  };
}

/** Moves up to `wanted` units from the stock; returns what was actually moved. */
export function drawFromStock(available: number, wanted: number): number {
  return Math.max(0, Math.min(available, wanted));
}
