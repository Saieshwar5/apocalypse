import type { AsteroidSize } from './asteroidClasses';

export const SHIELD_CAPACITY = 100;
export const HULL_CAPACITY = 100;
/** The shield starts recharging only after this long without damage. */
export const SHIELD_RECHARGE_DELAY = 3;
export const SHIELD_RECHARGE_PER_SECOND = 18;

/** Missile warhead blast. Firing at a target this close hurts the ship. */
export const MISSILE_BLAST = { radius: 8, damage: 50 } as const;

/** Shrapnel thrown out when an asteroid is destroyed, measured from its surface. */
export const SHRAPNEL: Record<AsteroidSize, { radius: number; damage: number }> = {
  small: { radius: 2, damage: 4 },
  medium: { radius: 4, damage: 14 },
  large: { radius: 7, damage: 32 },
  giant: { radius: 12, damage: 65 },
};

/** Damage from ramming an asteroid, before the shield absorbs any of it. */
export const COLLISION_DAMAGE: Record<AsteroidSize, number> = { small: 12, medium: 30, large: 60, giant: 100 };

export interface DefenseState {
  shield: number;
  hull: number;
  secondsSinceDamage: number;
}

export interface DamageResult {
  state: DefenseState;
  absorbedByShield: number;
  hullDamage: number;
}

export function createDefenseState(shieldCapacity: number = SHIELD_CAPACITY): DefenseState {
  return { shield: shieldCapacity, hull: HULL_CAPACITY, secondsSinceDamage: SHIELD_RECHARGE_DELAY };
}

/** The shield takes damage first; whatever it cannot hold reaches the hull. */
export function applyShipDamage(state: DefenseState, amount: number): DamageResult {
  if (amount < 0) {
    throw new RangeError('Ship damage cannot be negative');
  }
  const absorbedByShield = Math.min(state.shield, amount);
  const hullDamage = Math.min(state.hull, amount - absorbedByShield);
  return {
    state: {
      shield: state.shield - absorbedByShield,
      hull: state.hull - hullDamage,
      secondsSinceDamage: amount > 0 ? 0 : state.secondsSinceDamage,
    },
    absorbedByShield,
    hullDamage,
  };
}

/** The hull is only repaired at the space base (a later stage). */
export function rechargeShield(state: DefenseState, deltaSeconds: number, capacity: number = SHIELD_CAPACITY): DefenseState {
  const secondsSinceDamage = state.secondsSinceDamage + deltaSeconds;
  const charging = secondsSinceDamage >= SHIELD_RECHARGE_DELAY && state.hull > 0;
  return {
    shield: charging ? Math.min(capacity, state.shield + SHIELD_RECHARGE_PER_SECOND * deltaSeconds) : state.shield,
    hull: state.hull,
    secondsSinceDamage,
  };
}
