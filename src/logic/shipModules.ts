/**
 * Ship modules: equipment bolted to the interceptor's hardpoints at Vulcan
 * Yard. Each one makes a kind of work better and every one adds mass, so a
 * heavily fitted ship accelerates, brakes and turns more slowly. Choosing
 * what to carry is choosing what kind of pilot to be on this flight.
 */
export type ModuleId = 'cargoPod' | 'crewCabin' | 'auxTank' | 'heavyWinch' | 'sweeperNet' | 'missilePod' | 'longScanner';

export interface ModuleDefinition {
  id: ModuleId;
  name: string;
  /** One line for the yard panel. */
  effect: string;
  price: number;
  /** Mass relative to the bare ship (1). */
  mass: number;
}

/** Order sets the yard's 1-7 keys. */
export const MODULES: readonly ModuleDefinition[] = [
  { id: 'cargoPod', name: 'Cargo pod', effect: '+40% haul pay, ore rides in the pod', price: 1200, mass: 0.22 },
  { id: 'crewCabin', name: 'Crew cabin', effect: '+30% crew and rescue pay, passengers cushioned', price: 900, mass: 0.15 },
  { id: 'auxTank', name: 'Auxiliary tank', effect: '+50% fuel', price: 700, mass: 0.18 },
  { id: 'heavyWinch', name: 'Heavy winch', effect: 'line 60% stronger, steadies loads faster', price: 1000, mass: 0.12 },
  { id: 'sweeperNet', name: 'Sweeper net', effect: 'sweep twice as fast, at higher speed', price: 800, mass: 0.08 },
  { id: 'missilePod', name: 'Missile pod', effect: '+6 missiles', price: 1100, mass: 0.2 },
  { id: 'longScanner', name: 'Long-range scanner', effect: '+40% lock range', price: 950, mass: 0.04 },
];

/** Hardpoints on the ship; Senior Pilots get a third. */
export const HARDPOINTS = { base: 2, senior: 3 } as const;

/** Selling back at the yard returns this share of the price. */
export const RESALE_SHARE = 0.5;

export function moduleById(id: ModuleId): ModuleDefinition {
  const found = MODULES.find((module) => module.id === id);
  if (!found) {
    throw new Error(`Unknown module ${id}`);
  }
  return found;
}

export interface ModuleEffects {
  /** 1 for the bare ship; thrust is divided by it and turning by its square root. */
  massFactor: number;
  haulPay: number;
  crewPay: number;
  /** Crew hurt by hard hits only above this share of a normal hit. */
  crewCushion: number;
  fuelCapacity: number;
  lineStrength: number;
  lineSteadying: number;
  sweepRate: number;
  sweepSpeed: number;
  extraMissiles: number;
  lockRange: number;
}

export function moduleEffects(fitted: readonly ModuleId[]): ModuleEffects {
  const has = (id: ModuleId) => fitted.includes(id);
  const mass = fitted.reduce((total, id) => total + moduleById(id).mass, 0);
  return {
    massFactor: 1 + mass,
    haulPay: has('cargoPod') ? 1.4 : 1,
    crewPay: has('crewCabin') ? 1.3 : 1,
    crewCushion: has('crewCabin') ? 2 : 1,
    fuelCapacity: has('auxTank') ? 1.5 : 1,
    lineStrength: has('heavyWinch') ? 1.6 : 1,
    lineSteadying: has('heavyWinch') ? 1.8 : 1,
    sweepRate: has('sweeperNet') ? 2 : 1,
    sweepSpeed: has('sweeperNet') ? 10 / 6 : 1,
    extraMissiles: has('missilePod') ? 6 : 0,
    lockRange: has('longScanner') ? 1.4 : 1,
  };
}

/** Share of normal acceleration left with this load: 0.7 means 30% slower. */
export function handlingShare(massFactor: number): number {
  return 1 / Math.max(1, massFactor);
}

/** Turning suffers less than thrust: the mass sits near the centre line. */
export function turnShare(massFactor: number): number {
  return 1 / Math.sqrt(Math.max(1, massFactor));
}

export interface Hangar {
  owned: ModuleId[];
  fitted: ModuleId[];
}

export function emptyHangar(): Hangar {
  return { owned: [], fitted: [] };
}

export type YardResult =
  | { ok: true; hangar: Hangar; cost: number; action: 'bought' | 'fitted' | 'removed' }
  | { ok: false; reason: 'too-expensive' | 'no-hardpoint' };

/**
 * One key at the yard: buys a module not yet owned (and fits it when a
 * hardpoint is free), fits an owned one, or takes a fitted one off.
 */
export function yardAction(hangar: Hangar, id: ModuleId, credits: number, hardpoints: number): YardResult {
  if (hangar.fitted.includes(id)) {
    return { ok: true, hangar: { ...hangar, fitted: hangar.fitted.filter((fitted) => fitted !== id) }, cost: 0, action: 'removed' };
  }
  const free = hangar.fitted.length < hardpoints;
  if (hangar.owned.includes(id)) {
    if (!free) {
      return { ok: false, reason: 'no-hardpoint' };
    }
    return { ok: true, hangar: { ...hangar, fitted: [...hangar.fitted, id] }, cost: 0, action: 'fitted' };
  }
  const price = moduleById(id).price;
  if (credits < price) {
    return { ok: false, reason: 'too-expensive' };
  }
  return {
    ok: true,
    hangar: { owned: [...hangar.owned, id], fitted: free ? [...hangar.fitted, id] : hangar.fitted },
    cost: price,
    action: 'bought',
  };
}

/** Uninsured, the fitted modules go down with the ship; owned spares stay in the hangar. */
export function afterShipLoss(hangar: Hangar, insured: boolean): Hangar {
  if (insured) {
    return hangar;
  }
  return { owned: hangar.owned.filter((id) => !hangar.fitted.includes(id)), fitted: [] };
}

/** Stored hangars may be edited: keep known, unique modules, fitted ones owned. */
export function sanitizeHangar(value: unknown, hardpoints: number = HARDPOINTS.senior): Hangar {
  const candidate = (typeof value === 'object' && value !== null ? value : {}) as Partial<Record<keyof Hangar, unknown>>;
  const known = (list: unknown): ModuleId[] =>
    Array.isArray(list) ? [...new Set(list.filter((id): id is ModuleId => MODULES.some((module) => module.id === id)))] : [];
  const owned = known(candidate.owned);
  const fitted = known(candidate.fitted)
    .filter((id) => owned.includes(id))
    .slice(0, hardpoints);
  return { owned, fitted };
}
