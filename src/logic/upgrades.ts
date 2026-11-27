import { SHIELD_CAPACITY } from './shipDefense';
import { STATION_DEFENCE } from './stationDamage';
import { FUEL_CAPACITY } from './stationSupply';

export type UpgradeId =
  | 'fuelTank'
  | 'engines'
  | 'laserPower'
  | 'laserCooling'
  | 'missileRack'
  | 'shield'
  | 'stationShield'
  | 'repairCrews';

export interface UpgradeDefinition {
  id: UpgradeId;
  name: string;
  effect: string;
  /** Cost of each level in credits; the length is the maximum level. */
  costs: readonly number[];
}

/** Bought at the station workshop while docked. Order sets the 1-8 keys. */
export const UPGRADES: readonly UpgradeDefinition[] = [
  { id: 'fuelTank', name: 'Fuel tank', effect: '+40% fuel', costs: [300, 600] },
  { id: 'engines', name: 'Engines', effect: '+18% thrust', costs: [400, 800] },
  { id: 'laserPower', name: 'Laser power', effect: '+25% damage', costs: [450, 900] },
  { id: 'laserCooling', name: 'Laser cooling', effect: '+35%', costs: [300, 600] },
  { id: 'missileRack', name: 'Missile rack', effect: '+4 missiles', costs: [350, 700] },
  { id: 'shield', name: 'Ship shield', effect: '+40% shield', costs: [400, 800] },
  { id: 'stationShield', name: 'Station shield', effect: '+100%', costs: [500, 1000] },
  { id: 'repairCrews', name: 'Repair crews', effect: '2x site repair', costs: [350] },
];

export type UpgradeLevels = Record<UpgradeId, number>;

export function noUpgrades(): UpgradeLevels {
  return { fuelTank: 0, engines: 0, laserPower: 0, laserCooling: 0, missileRack: 0, shield: 0, stationShield: 0, repairCrews: 0 };
}

/** Price of the next level, or null when the upgrade is at its maximum. */
export function nextCost(levels: UpgradeLevels, id: UpgradeId): number | null {
  const definition = UPGRADES.find((upgrade) => upgrade.id === id);
  return definition?.costs[levels[id]] ?? null;
}

export type PurchaseResult =
  | { ok: true; levels: UpgradeLevels; cost: number }
  | { ok: false; reason: 'maxed' | 'too-expensive' };

export function purchase(levels: UpgradeLevels, id: UpgradeId, credits: number): PurchaseResult {
  const cost = nextCost(levels, id);
  if (cost === null) {
    return { ok: false, reason: 'maxed' };
  }
  if (credits < cost) {
    return { ok: false, reason: 'too-expensive' };
  }
  return { ok: true, levels: { ...levels, [id]: levels[id] + 1 }, cost };
}

/** The numbers the game systems read, derived from upgrade levels. */
export interface Loadout {
  fuelCapacity: number;
  thrustMultiplier: number;
  laserDamageMultiplier: number;
  laserCoolingMultiplier: number;
  missileCapacity: number;
  shieldCapacity: number;
  stationShieldCapacity: number;
  siteRepairMultiplier: number;
}

export const BASE_MISSILE_CAPACITY = 8;

export function loadoutFor(levels: UpgradeLevels): Loadout {
  return {
    fuelCapacity: FUEL_CAPACITY * (1 + 0.4 * levels.fuelTank),
    thrustMultiplier: 1 + 0.18 * levels.engines,
    laserDamageMultiplier: 1 + 0.25 * levels.laserPower,
    laserCoolingMultiplier: 1 + 0.35 * levels.laserCooling,
    missileCapacity: BASE_MISSILE_CAPACITY + 4 * levels.missileRack,
    shieldCapacity: SHIELD_CAPACITY * (1 + 0.4 * levels.shield),
    stationShieldCapacity: STATION_DEFENCE.shield * (1 + levels.stationShield),
    siteRepairMultiplier: 1 + levels.repairCrews,
  };
}
