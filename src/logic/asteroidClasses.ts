export type AsteroidSize = 'small' | 'medium' | 'large' | 'giant';
export type AsteroidMaterial = 'rocky' | 'iron' | 'ice';
export type WeaponKind = 'laser' | 'missile';

export const ASTEROID_SIZES: readonly AsteroidSize[] = ['small', 'medium', 'large', 'giant'];

export interface AsteroidClass {
  size: AsteroidSize;
  /** Radius range in world units (Earth radius is 10). */
  radius: [number, number];
  health: number;
  /** Percentage of planet integrity removed on impact. */
  planetDamage: number;
  /** Speed range in world units per second. */
  speed: [number, number];
  score: number;
  /** Pieces left behind when a laser, not a missile, finishes it off. */
  fragments: { size: AsteroidSize; count: number } | null;
}

/** Starting values for play-testing, not final balance. */
export const ASTEROID_CLASSES: Record<AsteroidSize, AsteroidClass> = {
  small: {
    size: 'small',
    radius: [0.35, 0.6],
    health: 10,
    planetDamage: 1,
    speed: [4.2, 5.4],
    score: 10,
    fragments: null,
  },
  medium: {
    size: 'medium',
    radius: [0.9, 1.3],
    health: 45,
    planetDamage: 6,
    speed: [3.2, 4.0],
    score: 40,
    fragments: null,
  },
  large: {
    size: 'large',
    radius: [1.9, 2.5],
    health: 150,
    planetDamage: 16,
    speed: [2.3, 2.9],
    score: 120,
    fragments: { size: 'medium', count: 2 },
  },
  giant: {
    size: 'giant',
    radius: [4.2, 5.0],
    health: 520,
    planetDamage: 40,
    speed: [1.4, 1.7],
    score: 500,
    fragments: { size: 'large', count: 2 },
  },
};

export interface MaterialTraits {
  label: string;
  healthMultiplier: number;
  speedMultiplier: number;
  /** Damage multipliers per weapon: iron shrugs off lasers, ice shatters easily. */
  weaponMultiplier: Record<WeaponKind, number>;
  planetDamageMultiplier: number;
}

export const MATERIAL_TRAITS: Record<AsteroidMaterial, MaterialTraits> = {
  rocky: {
    label: 'Rock',
    healthMultiplier: 1,
    speedMultiplier: 1,
    weaponMultiplier: { laser: 1, missile: 1 },
    planetDamageMultiplier: 1,
  },
  iron: {
    label: 'Iron',
    healthMultiplier: 1.4,
    speedMultiplier: 0.85,
    weaponMultiplier: { laser: 0.25, missile: 1.25 },
    planetDamageMultiplier: 1.3,
  },
  ice: {
    label: 'Ice',
    healthMultiplier: 0.6,
    speedMultiplier: 1.6,
    weaponMultiplier: { laser: 1.5, missile: 1 },
    planetDamageMultiplier: 0.7,
  },
};

export function asteroidHealth(size: AsteroidSize, material: AsteroidMaterial): number {
  return Math.round(ASTEROID_CLASSES[size].health * MATERIAL_TRAITS[material].healthMultiplier);
}

export function weaponDamage(baseDamage: number, weapon: WeaponKind, material: AsteroidMaterial): number {
  return baseDamage * MATERIAL_TRAITS[material].weaponMultiplier[weapon];
}

/** Lasers break big rocks apart instead of vaporising them; missiles do not. */
export function fragmentsOnDestroy(size: AsteroidSize, finishingWeapon: WeaponKind): AsteroidClass['fragments'] {
  return finishingWeapon === 'laser' ? ASTEROID_CLASSES[size].fragments : null;
}
