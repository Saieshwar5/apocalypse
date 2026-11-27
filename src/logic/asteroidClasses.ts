export type AsteroidSize = 'small' | 'medium' | 'large' | 'giant';
export type AsteroidMaterial = 'rocky' | 'iron' | 'ice' | 'rubble' | 'carbon';
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
  /** Relative density: sets mass, and so how hard it hits and how easily it is pushed. */
  density: number;
  /** Loose, low-density bodies are larger for the same class. */
  radiusMultiplier: number;
  healthMultiplier: number;
  speedMultiplier: number;
  /** Damage multipliers per weapon: iron shrugs off lasers, ice shatters easily. */
  weaponMultiplier: Record<WeaponKind, number>;
  planetDamageMultiplier: number;
  /** One-line advice shown once the asteroid has been scanned. */
  advice: string;
}

/**
 * Size is not danger. A rubble pile is big, loose and mostly burns up; a
 * small iron body is dense and does real damage. Damage follows density.
 */
export const MATERIAL_TRAITS: Record<AsteroidMaterial, MaterialTraits> = {
  rocky: {
    label: 'Stony',
    density: 1,
    radiusMultiplier: 1,
    healthMultiplier: 1,
    speedMultiplier: 1,
    weaponMultiplier: { laser: 1, missile: 1 },
    planetDamageMultiplier: 1,
    advice: 'Laser or missile',
  },
  iron: {
    label: 'Iron',
    density: 2.6,
    radiusMultiplier: 0.9,
    healthMultiplier: 1.4,
    speedMultiplier: 0.85,
    weaponMultiplier: { laser: 0.25, missile: 1.25 },
    planetDamageMultiplier: 2.2,
    advice: 'Missiles only: resists lasers',
  },
  ice: {
    label: 'Ice',
    density: 0.5,
    radiusMultiplier: 1,
    healthMultiplier: 0.6,
    speedMultiplier: 1.6,
    weaponMultiplier: { laser: 1.5, missile: 1 },
    planetDamageMultiplier: 0.5,
    advice: 'Fast: laser, lead the shot',
  },
  rubble: {
    label: 'Rubble pile',
    density: 0.2,
    radiusMultiplier: 1.45,
    healthMultiplier: 0.5,
    speedMultiplier: 0.9,
    weaponMultiplier: { laser: 1.3, missile: 1 },
    planetDamageMultiplier: 0.15,
    advice: 'Loose and light: mostly burns up',
  },
  carbon: {
    label: 'Carbon-rich',
    density: 0.6,
    radiusMultiplier: 1.1,
    healthMultiplier: 0.65,
    speedMultiplier: 1.05,
    weaponMultiplier: { laser: 1.2, missile: 1 },
    planetDamageMultiplier: 0.5,
    advice: 'Crumbly: laser',
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
