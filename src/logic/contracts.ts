/**
 * Defence contracts from the Earth Defence Authority. Every asteroid that
 * would hit the planet carries an open contract: whoever neutralises it, by
 * destroying it or pushing it off course, is paid. Pay follows danger, not
 * size: a small iron body pays more than a big rubble pile, and a rock that
 * would burn up in the atmosphere pays nothing.
 */

/** The client's name as shown on the board. */
export const DEFENCE_CLIENT = 'Earth Defence Authority';

export const CONTRACT_PAY = {
  /** Paid for any threat, however small. */
  base: 30,
  /** Per percentage point of planet integrity the impact would remove. */
  perDamagePoint: 25,
  /** A rock heading for a priority site pays this much more. */
  siteMultiplier: 1.5,
  /** Neutralised with at least this many seconds left before impact. */
  earlySeconds: 40,
  earlyBonus: 0.25,
  /**
   * A laser that splits a large rock is paid this share of its contract;
   * the fragments carry new contracts of their own.
   */
  splitShare: 0.4,
  /**
   * Stopping a rock without leaving debris in orbit (a deflection, or a kill
   * far from the orbits) pays this much more: the Authority rewards keeping
   * orbit clean.
   */
  cleanBonus: 0.2,
} as const;

/** Rounds pay to a whole 5 credits so the board stays readable. */
function roundPay(value: number): number {
  return Math.max(0, Math.round(value / 5) * 5);
}

/**
 * The contract value of a threat. `planetDamage` is the integrity it would
 * remove; zero means it burns up or misses, and there is no contract.
 */
export function contractValue(planetDamage: number, threatensSite: boolean): number {
  if (planetDamage <= 0) {
    return 0;
  }
  const value = CONTRACT_PAY.base + planetDamage * CONTRACT_PAY.perDamagePoint;
  return roundPay(threatensSite ? value * CONTRACT_PAY.siteMultiplier : value);
}

export type ContractOutcome = 'destroyed' | 'deflected' | 'split';

export interface Payout {
  amount: number;
  early: boolean;
  clean: boolean;
}

/**
 * What the pilot is paid on completing a contract. `secondsToImpact` is the
 * time the asteroid still had when neutralised (null if it was already on a
 * missing path, which only happens for deflections).
 */
export function contractPayout(value: number, outcome: ContractOutcome, secondsToImpact: number | null, leftDebris = true): Payout {
  if (value <= 0) {
    return { amount: 0, early: false, clean: false };
  }
  const early = secondsToImpact === null || secondsToImpact >= CONTRACT_PAY.earlySeconds;
  const share = outcome === 'split' ? CONTRACT_PAY.splitShare : 1;
  const clean = outcome === 'deflected' || !leftDebris;
  const bonus = 1 + (early ? CONTRACT_PAY.earlyBonus : 0) + (clean ? CONTRACT_PAY.cleanBonus : 0);
  return { amount: roundPay(value * share * bonus), early, clean };
}

/** A unit price: "2.6 cr" below 10 credits, whole credits above. */
export function formatPrice(price: number): string {
  return price < 10 ? `${price.toFixed(1)} cr` : formatCredits(price);
}

/** "1,250 cr". */
export function formatCredits(amount: number): string {
  return `${Math.round(amount).toLocaleString('en-US')} cr`;
}
