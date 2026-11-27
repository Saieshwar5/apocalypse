import * as THREE from 'three';
import type { Asteroid, AsteroidField, PlanetImpact } from '../asteroids/asteroidField';
import type { SoundEffects } from '../audio/soundEffects';
import type { CameraRig } from '../camera/cameraRig';
import type { Explosions } from '../effects/explosions';
import type { ScorchMarks } from '../effects/scorchMarks';
import type { CombatFeedback, HitQuality } from '../hud/combatFeedback';
import type { Hud } from '../hud/hud';
import {
  MATERIAL_TRAITS,
  fragmentsOnDestroy,
  weaponDamage,
  type AsteroidSize,
  type WeaponKind,
} from '../logic/asteroidClasses';
import { blastDamage, laserRangeMultiplier } from '../logic/ballistics';
import { applyPlanetDamage, craterAngularRadius } from '../logic/planetDamage';
import { randomUnitVector, type RandomSource } from '../logic/random';
import { destroyScore } from '../logic/scoring';
import { COLLISION_DAMAGE, MISSILE_BLAST, SHRAPNEL } from '../logic/shipDefense';
import type { Earth } from '../scene/earth';
import { localDirectionToLatLon } from '../scene/earth';
import type { ShieldBubble } from '../ship/shieldBubble';
import type { ShipController } from '../ship/shipController';
import type { WeaponHit } from '../weapons/laserCannon';
import type { GameSession } from './gameSession';

const SIZE_WEIGHT: Record<AsteroidSize, number> = { small: 0.1, medium: 0.3, large: 0.6, giant: 1 };
const SIZE_NAME: Record<AsteroidSize, string> = { small: 'Small', medium: 'Medium', large: 'Large', giant: 'Giant' };
/** Splash damage a missile blast does to other asteroids caught in it. */
const MISSILE_SPLASH_DAMAGE = 60;

export interface CombatDependencies {
  field: AsteroidField;
  earth: Earth;
  explosions: Explosions;
  scorches: ScorchMarks;
  sound: SoundEffects;
  hud: Hud;
  feedback: CombatFeedback;
  cameraRig: CameraRig;
  session: GameSession;
  ship: ShipController;
  shield: ShieldBubble;
  rng: RandomSource;
  /** False while the ship is destroyed and waiting to relaunch. */
  shipActive: () => boolean;
}

/**
 * Applies the consequences of everything that touched something this frame:
 * weapon hits (with range falloff and hit feedback), missile blasts and
 * shrapnel that can hurt the ship, asteroids reaching Earth, and collisions.
 */
export class CombatResolver {
  private shipLost = false;

  constructor(private readonly deps: CombatDependencies) {}

  /** True once after the ship's hull reaches zero. */
  consumeShipLost(): boolean {
    const lost = this.shipLost;
    this.shipLost = false;
    return lost;
  }

  resolveWeaponHits(hits: readonly WeaponHit[], weapon: WeaponKind): void {
    for (const hit of hits) {
      if (weapon === 'missile') {
        this.detonateMissile(hit);
      }
      if (hit.asteroid.alive) {
        this.applyHit(hit.asteroid, hit.point, hit.baseDamage, weapon, hit.range);
      }
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

  resolveShipCollisions(): void {
    const { field, explosions, ship } = this.deps;
    if (!this.deps.shipActive()) {
      return;
    }
    for (const asteroid of [...field.all]) {
      const offset = ship.position.clone().sub(asteroid.mesh.position);
      const reach = asteroid.radius + 0.55;
      if (offset.lengthSq() > reach * reach) {
        continue;
      }
      const normal = offset.normalize();
      ship.position.copy(asteroid.mesh.position).addScaledVector(normal, reach + 0.05);
      ship.velocity.addScaledVector(normal, 10 + asteroid.velocity.length());
      explosions.spawnRockChips(ship.position, 1.5);
      if (asteroid.size === 'small') {
        field.remove(asteroid);
        explosions.spawnExplosion(asteroid.mesh.position, asteroid.radius, 'fire');
      }
      this.damageShip(COLLISION_DAMAGE[asteroid.size], asteroid.mesh.position, 'Collision');
    }
  }

  private applyHit(asteroid: Asteroid, point: THREE.Vector3, baseDamage: number, weapon: WeaponKind, range: number): void {
    const { field, explosions, scorches, sound, feedback, hud } = this.deps;
    const rangeMultiplier = weapon === 'laser' ? laserRangeMultiplier(range) : 1;
    const damage = weaponDamage(baseDamage * rangeMultiplier, weapon, asteroid.material);
    const resisted = MATERIAL_TRAITS[asteroid.material].weaponMultiplier[weapon] < 1;
    const quality: HitQuality = resisted ? 'resisted' : rangeMultiplier < 0.75 ? 'weak-range' : 'solid';
    const destroyed = field.damage(asteroid, damage, weapon);
    feedback.hit(point, damage, quality);

    if (!destroyed) {
      sound.hit(asteroid.material);
      scorches.add(asteroid.mesh, point, resisted ? 0.35 : 0.6);
      if (resisted) {
        explosions.spawnHitSpark(point);
      } else {
        explosions.spawnRockChips(point, Math.min(1.5, damage / 20));
      }
      if (resisted && weapon === 'laser' && asteroid.health > asteroid.maxHealth * 0.6) {
        hud.showMessage('Iron resists lasers. Use missiles (F)', 'warning', 2.5);
      }
      return;
    }
    this.destroyAsteroid(asteroid, weapon);
  }

  private destroyAsteroid(asteroid: Asteroid, weapon: WeaponKind): void {
    const { explosions, sound, session, feedback, ship } = this.deps;
    const position = asteroid.mesh.position.clone();
    const score = destroyScore(asteroid.size, weapon, position.length());
    session.score += score;
    session.asteroidsDestroyed += 1;
    session.destroyedThisWave += 1;
    explosions.spawnExplosion(position, asteroid.radius, asteroid.material === 'ice' ? 'ice' : 'fire');
    explosions.spawnRockChips(position, 1 + SIZE_WEIGHT[asteroid.size] * 3);
    sound.explosion(SIZE_WEIGHT[asteroid.size]);
    sound.killConfirm();
    feedback.kill(position, score, 'DESTROYED');
    this.deps.cameraRig.addShake(SIZE_WEIGHT[asteroid.size] * Math.max(0, 1 - position.distanceTo(ship.position) / 40));
    this.spawnFragments(asteroid, weapon);

    // Shrapnel: blowing up a big rock at point-blank range hurts.
    const shrapnel = SHRAPNEL[asteroid.size];
    const surfaceDistance = position.distanceTo(ship.position) - asteroid.radius;
    const damage = blastDamage(surfaceDistance, shrapnel.radius, shrapnel.damage);
    if (damage > 0) {
      this.damageShip(damage, position, 'Shrapnel');
    }
  }

  /** Warhead blast: hurts nearby asteroids and the ship if it is too close. */
  private detonateMissile(hit: WeaponHit): void {
    const { field, explosions, sound, ship } = this.deps;
    explosions.spawnExplosion(hit.point, 1.4, 'fire');
    sound.explosion(0.35);
    for (const other of [...field.all]) {
      if (other === hit.asteroid) {
        continue;
      }
      const distance = other.mesh.position.distanceTo(hit.point) - other.radius;
      const splash = blastDamage(distance, MISSILE_BLAST.radius, MISSILE_SPLASH_DAMAGE);
      if (splash > 0) {
        this.applyHit(other, other.mesh.position.clone().lerp(hit.point, 0.5), splash, 'missile', 0);
      }
    }
    const selfDamage = blastDamage(hit.point.distanceTo(ship.position), MISSILE_BLAST.radius, MISSILE_BLAST.damage);
    if (selfDamage > 0) {
      this.damageShip(selfDamage, hit.point, 'Own missile blast');
    }
  }

  private damageShip(amount: number, source: THREE.Vector3, cause: string): void {
    const { ship, shield, sound, feedback, cameraRig, hud } = this.deps;
    if (!this.deps.shipActive() || ship.hull <= 0) {
      return;
    }
    const result = ship.applyDamage(amount);
    const local = ship.object.worldToLocal(source.clone());
    if (result.absorbedByShield > 0) {
      shield.flash(local, result.absorbedByShield / amount);
      sound.shieldHit();
    }
    if (result.hullDamage > 0) {
      sound.hullHit();
      cameraRig.addShake(0.4 + result.hullDamage / 40);
      feedback.note(ship.position.clone().add(new THREE.Vector3(0, 0.6, 0)), `HULL -${Math.round(result.hullDamage)}`, '#ff5a4a');
      hud.showMessage(`${cause}: hull -${Math.round(result.hullDamage)}`, 'danger', 2);
    } else {
      cameraRig.addShake(0.25);
      hud.showMessage(`${cause}: shield absorbed ${Math.round(result.absorbedByShield)}`, 'warning', 1.6);
    }
    if (ship.hull <= 0) {
      this.shipLost = true;
    }
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
