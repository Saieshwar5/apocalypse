import * as THREE from 'three';
import {
  ASTEROID_CLASSES,
  MATERIAL_TRAITS,
  asteroidHealth,
  type AsteroidMaterial,
  type AsteroidSize,
} from '../logic/asteroidClasses';
import { impactDamage } from '../logic/planetDamage';
import { randomBetween, randomUnitVector, type RandomSource, type Vec3Tuple } from '../logic/random';
import { timeToImpact } from '../logic/threats';
import { AsteroidMeshFactory } from './asteroidMeshes';

export interface Asteroid {
  id: number;
  size: AsteroidSize;
  material: AsteroidMaterial;
  radius: number;
  health: number;
  maxHealth: number;
  /** Integrity percentage this asteroid removes on impact. */
  planetDamage: number;
  velocity: THREE.Vector3;
  mesh: THREE.Mesh;
  spinAxis: THREE.Vector3;
  spinRate: number;
  /** Seconds until it reaches the surface, or null when its path misses. */
  timeToImpact: number | null;
  alive: boolean;
  /** 0..1 white-hot flash after a hit; decays quickly. */
  hitFlash: number;
  /** 0..1 heating from atmospheric entry. */
  entryHeat: number;
  /** The weapon that last hit it, for the kill confirmation. */
  lastHitBy: 'laser' | 'missile' | null;
  /** Name of the priority site its impact would damage, if any. */
  targetSite: string | null;
  threatensSite: boolean;
}

export interface PlanetImpact {
  asteroid: Asteroid;
  /** World-space point on the surface. */
  point: THREE.Vector3;
}

const SPAWN_DISTANCE: [number, number] = [165, 205];
/** Asteroids start to glow inside this multiple of the planet radius. */
const ENTRY_HEAT_START = 1.9;
const HIT_FLASH_DECAY = 6;
const HIT_FLASH_COLOR = new THREE.Color(1.2, 0.9, 0.6);
const ENTRY_HEAT_COLOR = new THREE.Color(2.4, 0.7, 0.15);
/** Asteroids aim inside this fraction of the radius so every path hits. */
const AIM_SPREAD = 0.75;

/**
 * Owns every live asteroid: spawning, motion, surface impacts and removal.
 * Damage rules live in the logic modules; this class only applies them.
 */
export class AsteroidField {
  readonly group = new THREE.Group();
  private readonly asteroids: Asteroid[] = [];
  private readonly meshes = new AsteroidMeshFactory();
  private nextId = 1;
  private readonly scratch = new THREE.Vector3();

  constructor(
    private readonly planetRadius: number,
    private readonly rng: RandomSource,
  ) {}

  get all(): readonly Asteroid[] {
    return this.asteroids;
  }

  get count(): number {
    return this.asteroids.length;
  }

  /** Spawns far out along `direction`, on a path that will hit the planet. */
  spawnIncoming(size: AsteroidSize, material: AsteroidMaterial, direction: Vec3Tuple): Asteroid {
    const position = new THREE.Vector3(...direction).multiplyScalar(randomBetween(this.rng, ...SPAWN_DISTANCE));
    return this.spawnAt(size, material, position);
  }

  /**
   * Spawns at a position and aims at a random point on the planet, or at the
   * point `aimAt` returns for the estimated flight time (used to aim at a
   * site on the rotating surface).
   */
  spawnAt(
    size: AsteroidSize,
    material: AsteroidMaterial,
    position: THREE.Vector3,
    speedScale = 1,
    aimAt?: (flightSeconds: number) => THREE.Vector3,
  ): Asteroid {
    const definition = ASTEROID_CLASSES[size];
    const radius = randomBetween(this.rng, ...definition.radius);
    const speed =
      randomBetween(this.rng, ...definition.speed) * MATERIAL_TRAITS[material].speedMultiplier * speedScale;
    const aim = aimAt
      ? aimAt((position.length() - this.planetRadius) / speed)
      : new THREE.Vector3(...randomUnitVector(this.rng)).multiplyScalar(this.planetRadius * AIM_SPREAD * this.rng());
    const velocity = aim.sub(position).normalize().multiplyScalar(speed);
    const health = asteroidHealth(size, material);

    const mesh = this.meshes.createMesh(size, material, radius);
    mesh.position.copy(position);
    this.group.add(mesh);

    const asteroid: Asteroid = {
      id: this.nextId,
      size,
      material,
      radius,
      health,
      maxHealth: health,
      planetDamage: impactDamage(size, material),
      velocity,
      mesh,
      spinAxis: new THREE.Vector3(...randomUnitVector(this.rng)),
      spinRate: randomBetween(this.rng, 0.1, 0.6) / Math.sqrt(radius),
      timeToImpact: null,
      alive: true,
      hitFlash: 0,
      entryHeat: 0,
      lastHitBy: null,
      targetSite: null,
      threatensSite: false,
    };
    this.nextId += 1;
    this.asteroids.push(asteroid);
    this.refreshTimeToImpact(asteroid);
    return asteroid;
  }

  /** A piece of a broken asteroid: keeps the given velocity instead of aiming at the planet. */
  spawnFragment(size: AsteroidSize, material: AsteroidMaterial, position: THREE.Vector3, velocity: THREE.Vector3): Asteroid {
    const fragment = this.spawnAt(size, material, position);
    fragment.velocity.copy(velocity);
    this.refreshTimeToImpact(fragment);
    return fragment;
  }

  /**
   * Removes asteroids that can no longer hit the planet and are flying away,
   * and returns them so a deflection can be scored. Without this a deflected
   * rock would drift forever and its wave would never end.
   */
  collectEscaped(): Asteroid[] {
    const escaped = this.asteroids.filter(
      (asteroid) =>
        asteroid.timeToImpact === null &&
        asteroid.mesh.position.dot(asteroid.velocity) > 0 &&
        asteroid.mesh.position.length() > this.planetRadius * 5,
    );
    for (const asteroid of escaped) {
      this.remove(asteroid);
    }
    return escaped;
  }

  /** Pushes an asteroid and adds tumble, as from a weapon hit. */
  applyImpulse(asteroid: Asteroid, direction: THREE.Vector3, speedChange: number): void {
    asteroid.velocity.addScaledVector(direction, speedChange);
    asteroid.spinRate = Math.min(2.5, asteroid.spinRate + speedChange * 0.6);
    this.refreshTimeToImpact(asteroid);
  }

  /** Moves everything and returns the asteroids that reached the surface. */
  update(deltaSeconds: number): PlanetImpact[] {
    const impacts: PlanetImpact[] = [];
    for (const asteroid of this.asteroids) {
      asteroid.mesh.position.addScaledVector(asteroid.velocity, deltaSeconds);
      asteroid.mesh.rotateOnAxis(asteroid.spinAxis, asteroid.spinRate * deltaSeconds);
      this.refreshTimeToImpact(asteroid);
      this.updateGlow(asteroid, deltaSeconds);
      const surfaceDistance = asteroid.mesh.position.length() - this.planetRadius;
      if (surfaceDistance <= asteroid.radius * 0.25) {
        const point = this.scratch.copy(asteroid.mesh.position).setLength(this.planetRadius).clone();
        impacts.push({ asteroid, point });
      }
    }
    for (const impact of impacts) {
      this.remove(impact.asteroid);
    }
    return impacts;
  }

  /** Applies damage; returns true if this destroyed the asteroid. */
  damage(asteroid: Asteroid, amount: number, weapon: 'laser' | 'missile'): boolean {
    if (!asteroid.alive) {
      return false;
    }
    asteroid.health -= amount;
    asteroid.lastHitBy = weapon;
    // Resisted hits (iron against lasers) flash less, so the player sees it.
    asteroid.hitFlash = Math.min(1, asteroid.hitFlash + Math.min(1, amount / 12));
    if (asteroid.health > 0) {
      return false;
    }
    this.remove(asteroid);
    return true;
  }

  remove(asteroid: Asteroid): void {
    const index = this.asteroids.indexOf(asteroid);
    if (index === -1) {
      return;
    }
    asteroid.alive = false;
    this.asteroids.splice(index, 1);
    this.group.remove(asteroid.mesh);
    (asteroid.mesh.material as THREE.Material).dispose();
    for (const child of [...asteroid.mesh.children]) {
      asteroid.mesh.remove(child);
    }
  }

  clear(): void {
    for (const asteroid of [...this.asteroids]) {
      this.remove(asteroid);
    }
  }

  private updateGlow(asteroid: Asteroid, deltaSeconds: number): void {
    asteroid.hitFlash = Math.max(0, asteroid.hitFlash - HIT_FLASH_DECAY * deltaSeconds);
    const distance = asteroid.mesh.position.length();
    asteroid.entryHeat = THREE.MathUtils.clamp(
      (this.planetRadius * ENTRY_HEAT_START - distance) / (this.planetRadius * (ENTRY_HEAT_START - 1)),
      0,
      1,
    );
    const material = asteroid.mesh.material as THREE.MeshStandardMaterial;
    const heat = asteroid.entryHeat * asteroid.entryHeat;
    material.emissive.setRGB(
      HIT_FLASH_COLOR.r * asteroid.hitFlash + ENTRY_HEAT_COLOR.r * heat,
      HIT_FLASH_COLOR.g * asteroid.hitFlash + ENTRY_HEAT_COLOR.g * heat,
      HIT_FLASH_COLOR.b * asteroid.hitFlash + ENTRY_HEAT_COLOR.b * heat,
    );
  }

  private refreshTimeToImpact(asteroid: Asteroid): void {
    const position = asteroid.mesh.position;
    const velocity = asteroid.velocity;
    asteroid.timeToImpact = timeToImpact(
      [position.x, position.y, position.z],
      [velocity.x, velocity.y, velocity.z],
      this.planetRadius,
    );
  }
}
