import * as THREE from 'three';
import type { Asteroid, AsteroidField, PlanetImpact } from '../asteroids/asteroidField';
import type { SoundEffects } from '../audio/soundEffects';
import type { CameraRig } from '../camera/cameraRig';
import type { Explosions } from '../effects/explosions';
import type { Hud } from '../hud/hud';
import {
  fragmentsOnDestroy,
  weaponDamage,
  type AsteroidSize,
  type WeaponKind,
} from '../logic/asteroidClasses';
import { applyPlanetDamage, craterAngularRadius } from '../logic/planetDamage';
import { randomUnitVector, type RandomSource } from '../logic/random';
import { destroyScore } from '../logic/scoring';
import type { Earth } from '../scene/earth';
import { localDirectionToLatLon } from '../scene/earth';
import type { ShipController } from '../ship/shipController';
import type { WeaponHit } from '../weapons/laserCannon';
import type { GameSession } from './gameSession';

const SIZE_WEIGHT: Record<AsteroidSize, number> = { small: 0.1, medium: 0.3, large: 0.6, giant: 1 };
const SHIP_COLLISION_DAMAGE: Record<AsteroidSize, number> = { small: 12, medium: 30, large: 60, giant: 100 };
const SIZE_NAME: Record<AsteroidSize, string> = { small: 'Small', medium: 'Medium', large: 'Large', giant: 'Giant' };

export interface CombatDependencies {
  field: AsteroidField;
  earth: Earth;
  explosions: Explosions;
  sound: SoundEffects;
  hud: Hud;
  cameraRig: CameraRig;
  session: GameSession;
  rng: RandomSource;
}

/**
 * Applies the consequences of everything that touched something this frame:
 * weapon hits, asteroids reaching the surface and the ship ramming a rock.
 */
export class CombatResolver {
  constructor(private readonly deps: CombatDependencies) {}

  resolveWeaponHits(hits: readonly WeaponHit[], weapon: WeaponKind): void {
    const { field, explosions, sound, session } = this.deps;
    for (const hit of hits) {
      const asteroid = hit.asteroid;
      if (!asteroid.alive) {
        continue;
      }
      const damage = weaponDamage(hit.baseDamage, weapon, asteroid.material);
      const destroyed = field.damage(asteroid, damage);
      if (!destroyed) {
        explosions.spawnHitSpark(hit.point);
        sound.hit();
        if (weapon === 'laser' && asteroid.material === 'iron' && asteroid.health > asteroid.maxHealth * 0.6) {
          this.deps.hud.showMessage('Iron hull resists lasers. Use missiles (F)', 'warning', 2.5);
        }
        continue;
      }
      const position = asteroid.mesh.position;
      session.score += destroyScore(asteroid.size, weapon, position.length());
      session.asteroidsDestroyed += 1;
      session.destroyedThisWave += 1;
      explosions.spawnExplosion(position, asteroid.radius, asteroid.material === 'ice' ? 'ice' : 'fire');
      sound.explosion(SIZE_WEIGHT[asteroid.size]);
      this.spawnFragments(asteroid, weapon);
    }
  }

  resolvePlanetImpacts(impacts: readonly PlanetImpact[], listenerPosition: THREE.Vector3): void {
    const { earth, explosions, sound, hud, cameraRig, session } = this.deps;
    for (const { asteroid, point } of impacts) {
      session.integrity = applyPlanetDamage(session.integrity, asteroid.planetDamage);
      session.impactsThisWave += 1;
      session.totalImpacts += 1;
      earth.addImpact(point, craterAngularRadius(asteroid.size));
      explosions.spawnSurfaceImpact(point, asteroid.radius);
      const weight = SIZE_WEIGHT[asteroid.size];
      sound.planetImpact(weight);
      const distance = listenerPosition.distanceTo(point);
      cameraRig.addShake(weight * 1.2 * Math.max(0.25, 1 - distance / 60));
      const { latitude, longitude } = localDirectionToLatLon(earth.worldToLocalDirection(point));
      hud.showMessage(
        `${SIZE_NAME[asteroid.size]} impact at ${formatCoordinate(latitude, 'N', 'S')} ${formatCoordinate(longitude, 'E', 'W')}: integrity -${asteroid.planetDamage.toFixed(0)}%`,
        weight >= 0.6 ? 'danger' : 'warning',
        3.5,
      );
    }
  }

  /** Returns true if a collision destroyed the ship. */
  resolveShipCollisions(ship: ShipController): boolean {
    const { field, explosions, sound, cameraRig } = this.deps;
    for (const asteroid of [...field.all]) {
      const offset = ship.position.clone().sub(asteroid.mesh.position);
      const reach = asteroid.radius + 0.55;
      if (offset.lengthSq() > reach * reach) {
        continue;
      }
      const normal = offset.normalize();
      ship.position.copy(asteroid.mesh.position).addScaledVector(normal, reach + 0.05);
      ship.velocity.addScaledVector(normal, 10 + asteroid.velocity.length());
      cameraRig.addShake(0.6);
      sound.explosion(0.15);
      explosions.spawnHitSpark(ship.position);
      if (asteroid.size === 'small') {
        field.remove(asteroid);
        explosions.spawnExplosion(asteroid.mesh.position, asteroid.radius, 'fire');
      }
      if (ship.applyHullDamage(SHIP_COLLISION_DAMAGE[asteroid.size])) {
        return true;
      }
    }
    return false;
  }

  private spawnFragments(parent: Asteroid, weapon: WeaponKind): void {
    const fragments = fragmentsOnDestroy(parent.size, weapon);
    if (!fragments) {
      return;
    }
    for (let index = 0; index < fragments.count; index += 1) {
      const offset = new THREE.Vector3(...randomUnitVector(this.deps.rng)).multiplyScalar(parent.radius * 0.6);
      this.deps.field.spawnAt(fragments.size, parent.material, parent.mesh.position.clone().add(offset), 1.15);
    }
    this.deps.hud.showMessage(
      `${SIZE_NAME[parent.size]} asteroid split into ${fragments.count} fragments. Missiles destroy it whole`,
      'warning',
      3,
    );
  }
}

function formatCoordinate(value: number, positive: string, negative: string): string {
  return `${Math.abs(value).toFixed(0)}°${value >= 0 ? positive : negative}`;
}
