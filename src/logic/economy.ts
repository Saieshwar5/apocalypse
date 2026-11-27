/**
 * What the pilot pays at a station. Fuel and missiles are bought, the hull
 * is repaired for a fee, and the shield recharges free. The station's stock
 * is limited separately (see stationSupply).
 */
export const PRICES = {
  fuelPerUnit: 2,
  missile: 60,
  hullPerPoint: 3,
} as const;

/** Money the pilot starts with: enough for one refill and a few missiles. */
export const STARTING_BALANCE = 500;

/**
 * Fuel the Defence Authority provides free when the pilot cannot pay, so a
 * broke pilot is never stranded. It only fills the tank up to this level.
 */
export const EMERGENCY_FUEL_LEVEL = 30;

export interface Purchase {
  /** Units actually bought (fuel units or hull points). */
  units: number;
  cost: number;
}

/**
 * Buys up to `wanted` units at `unitPrice` with `balance` available. Partial
 * units are allowed, so service can run smoothly a little each frame.
 */
export function buyUnits(wanted: number, unitPrice: number, balance: number): Purchase {
  if (wanted <= 0 || balance <= 0) {
    return { units: 0, cost: 0 };
  }
  const affordable = unitPrice > 0 ? balance / unitPrice : wanted;
  const units = Math.min(wanted, affordable);
  return { units, cost: units * unitPrice };
}

/** Free fuel the pilot is owed now: tops the tank up to the emergency level. */
export function emergencyFuel(fuel: number, wanted: number): number {
  return Math.max(0, Math.min(wanted, EMERGENCY_FUEL_LEVEL - fuel));
}

/** The pilot's money for one run: income, spending and the running balance. */
export class Wallet {
  balance = STARTING_BALANCE;
  /** Everything paid to the pilot this run (contracts and bonuses). */
  earned = 0;
  spent = 0;
  fines = 0;

  earn(amount: number): void {
    const paid = Math.max(0, amount);
    this.balance += paid;
    this.earned += paid;
  }

  /** Returns false (and charges nothing) when the pilot cannot afford it. */
  spend(amount: number): boolean {
    if (amount < 0 || amount > this.balance + 1e-9) {
      return false;
    }
    this.balance = Math.max(0, this.balance - amount);
    this.spent += amount;
    return true;
  }

  /** Fines are taken even if they leave the balance at zero. */
  fine(amount: number): number {
    const taken = Math.min(this.balance, Math.max(0, amount));
    this.balance -= taken;
    this.fines += taken;
    return taken;
  }

  reset(): void {
    this.balance = STARTING_BALANCE;
    this.earned = 0;
    this.spent = 0;
    this.fines = 0;
  }
}
