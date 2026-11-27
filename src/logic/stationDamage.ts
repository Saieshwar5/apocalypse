import type { AsteroidSize } from './asteroidClasses';

export const STATION_DEFENCE = {
  shield: 100,
  health: 100,
  /** Seconds without a hit before the shield starts to recharge. */
  rechargeDelay: 6,
  rechargePerSecond: 8,
  /** Asteroids whose centre passes within this many units hit the station. */
  bodyRadius: 3,
} as const;

/** Damage an asteroid does when it strikes the station. */
export const STATION_IMPACT_DAMAGE: Record<AsteroidSize, number> = { small: 12, medium: 45, large: 110, giant: 400 };

export type StationCondition = 'operational' | 'damaged' | 'crippled' | 'destroyed';

/** Damage degrades the station in stages before it is lost. */
export function stationCondition(health: number): StationCondition {
  if (health <= 0) {
    return 'destroyed';
  }
  if (health < 30) {
    return 'crippled';
  }
  return health < 60 ? 'damaged' : 'operational';
}

/** How fast the station services a docked ship, and whether it can reload missiles. */
export function stationService(health: number): { rate: number; missiles: boolean } {
  const condition = stationCondition(health);
  if (condition === 'operational') {
    return { rate: 1, missiles: true };
  }
  if (condition === 'damaged') {
    return { rate: 0.5, missiles: true };
  }
  return { rate: condition === 'crippled' ? 0.3 : 0, missiles: false };
}

export interface StationDefenceState {
  shield: number;
  health: number;
}

/** The shield absorbs what it can; the rest reaches the structure. */
export function applyStationDamage(state: StationDefenceState, amount: number): StationDefenceState {
  const absorbed = Math.min(state.shield, Math.max(0, amount));
  return { shield: state.shield - absorbed, health: Math.max(0, state.health - (amount - absorbed)) };
}
