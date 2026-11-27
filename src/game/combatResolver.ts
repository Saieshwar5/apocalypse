import * as THREE from 'three';
import type { Asteroid, AsteroidField, PlanetImpact } from '../asteroids/asteroidField';
import type { SoundEffects } from '../audio/soundEffects';
import type { CameraRig } from '../camera/cameraRig';
import type { Explosions } from '../effects/explosions';
import type { ImpactPlumes } from '../effects/impactPlumes';
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
import { hitSpeedChange } from '../logic/impulse';
import { formatCredits } from '../logic/contracts';
import { applyPlanetDamage, burnsUp, craterAngularRadius } from '../logic/planetDamage';
import { randomUnitVector, type RandomSource } from '../logic/random';
import { COLLISION_DAMAGE, MISSILE_BLAST, SHRAPNEL } from '../logic/shipDefense';
import type { Earth } from '../scene/earth';
import { localDirectionToLatLon } from '../scene/earth';
import type { SiteDefence, SiteHit } from '../sites/siteDefence';
import type { ShieldBubble } from '../ship/shieldBubble';
import type { ShipController } from '../ship/shipController';
import type { WeaponHit } from '../weapons/laserCannon';
import { pilotName, type PilotId } from '../logic/rivals';
import type { ContractBook } from './contractBook';
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
  plumes: ImpactPlumes;
  sites: SiteDefence;
  sound: SoundEffects;
  hud: Hud;
  feedback: CombatFeedback;
  cameraRig: CameraRig;
  session: GameSession;
  contracts: ContractBook;
  ship: ShipController;
  shield: ShieldBubble;
  rng: RandomSource;
  /** False once the ship has been destroyed. */
  shipActive: () => boolean;
}

/**
 * Applies the consequences of everything that touched something this frame:
 * weapon hits (with range falloff and hit feedback), missile blasts and
 * shrapnel that can hurt the ship, asteroids reaching Earth, and collisions.
 */
export class CombatResolver {
  private shipLostCause: string | null = null;

  constructor(private readonly deps: CombatDependencies) {}

  /** Why the ship was destroyed, returned once; null if it was not. */
  consumeShipLost(): string | null {
    const cause = this.shipLostCause;
    this.shipLostCause = null;
    return cause;
  }

  /** Continuous damage such as atmospheric heating: no per-hit messages. */
  applyEnvironmentDamage(amount: number, causeIfFatal: string): void {
    const { ship, hud } = this.deps;
    if (!this.deps.shipActive() || ship.hull <= 0) {
      return;
    }
    const result = ship.applyDamage(amount);
    if (result.hullDamage > 0) {
      hud.flashDamage(new THREE.Vector3(0, 0, -1), 0.25);
    }
    if (ship.hull <= 0) {
      this.shipLostCause = causeIfFatal;
    }
  }

  destroyShip(cause: string): void {
    if (this.deps.shipActive() && this.shipLostCause === null) {
      this.deps.ship.applyDamage(1e6);
      this.shipLostCause = cause;
    }
  }

  /** `pilot` is whose weapon it was: hit feedback is the player's alone, pay is shared by damage. */
  resolveWeaponHits(hits: readonly WeaponHit[], weapon: WeaponKind, pilot: PilotId = 'player'): void {
    for (const hit of hits) {
      if (weapon === 'missile') {
        this.detonateMissile(hit, pilot);
      }
      if (hit.asteroid.alive) {
        this.applyHit(hit.asteroid, hit.point, hit.baseDamage, weapon, hit.range, hit.direction, pilot);
      }
    }
  }

  resolvePlanetImpacts(impacts: readonly PlanetImpact[], listenerPosition: THREE.Vector3): void {
    const { earth, explosions, sound, hud, cameraRig, session } = this.deps;
    for (const { asteroid, point } of impacts) {
      if (burnsUp(asteroid.size, asteroid.material)) {
        // Too small or too loose to reach the ground: a shooting star, no damage.
        const high = point.clone().multiplyScalar(1.035);
        explosions.spawnExplosion(high, Math.min(asteroid.radius, 1.2) * 0.6, 'fire', asteroid.velocity.clone().multiplyScalar(0.3));
        explosions.spawnHitSpark(high);
        session.burnUps += 1;
        if (asteroid.size !== 'small') {
          hud.showMessage(`${MATERIAL_TRAITS[asteroid.material].label} asteroid burned up in the atmosphere`, 'info', 2.5);
        }
        continue;
      }
      const lost = this.deps.contracts.lose(asteroid);
      session.integrity = applyPlanetDamage(session.integrity, asteroid.planetDamage);
      session.impactsThisWave += 1;
      session.totalImpacts += 1;
      earth.addImpact(point, craterAngularRadius(asteroid.size));
      this.deps.plumes.add(point, craterAngularRadius(asteroid.size));
      explosions.spawnSurfaceImpact(point, asteroid.radius);
      // Light bodies do less to a site than a dense one of the same size.
      const siteStrength = Math.min(1, MATERIAL_TRAITS[asteroid.material].planetDamageMultiplier);
      const siteHits = this.deps.sites.applyImpact(point, asteroid.size, siteStrength);
      const weight = SIZE_WEIGHT[asteroid.size];
      sound.planetImpact(weight);
      const distance = listenerPosition.distanceTo(point);
      cameraRig.addShake(weight * 1.2 * Math.max(0.25, 1 - distance / 60));
      if (siteHits.length > 0) {
        this.reportSiteHits(siteHits);
        continue;
      }
      const { latitude, longitude } = localDirectionToLatLon(earth.worldToLocalDirection(point));
      hud.showMessage(
        `${SIZE_NAME[asteroid.size]} impact at ${formatCoordinate(latitude, 'N', 'S')} ${formatCoordinate(longitude, 'E', 'W')}: integrity -${asteroid.planetDamage.toFixed(0)}%${lost > 0 ? `. Contract lost: ${formatCredits(lost)}` : ''}`,
        weight >= 0.6 ? 'danger' : 'warning',
        3.5,
      );
    }
  }

  private reportSiteHits(hits: readonly SiteHit[]): void {
    const { hud, sound, earth, session } = this.deps;
    // Report the worst hit; a destroyed site always wins.
    const worst = [...hits].sort((a, b) => Number(b.destroyed) - Number(a.destroyed) || b.damage - a.damage)[0];
    const name = worst.site.definition.name.toUpperCase();
    for (const hit of hits) {
      if (!hit.destroyed) {
        continue;
      }
      session.sitesLost += 1;
      // A wide dead zone: the city's lights go out for good.
      earth.addImpact(earth.localToWorldDirection(hit.site.localDirection), 0.09);
      sound.alarm();
    }
    if (!worst.destroyed) {
      hud.showMessage(`${name} HIT: ${Math.ceil(worst.site.health)}% standing`, 'danger', 4);
      return;
    }
    const consequence =
      worst.site.definition.kind === 'launch'
        ? ' No more supply rockets.'
        : worst.site.definition.kind === 'radar'
          ? ' Scanner range halved.'
          : ` ${worst.site.definition.population} million people lost.`;
    hud.showMessage(`${name} DESTROYED.${consequence}`, 'danger', 6);
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
      this.damageShip(COLLISION_DAMAGE[asteroid.size], asteroid.mesh.position, 'Collision', 'The interceptor was destroyed in a collision');
    }
  }

  /** Scores asteroids pushed onto a path that misses the planet. */
  resolveEscaped(escaped: readonly Asteroid[]): void {
    const { session, hud, sound } = this.deps;
    for (const asteroid of escaped) {
      // Only rocks the pilot actually hit count as deflections.
      if (asteroid.lastHitBy === null) {
        continue;
      }
      const paid = this.deps.contracts.complete(asteroid, 'deflected', asteroid.mesh.position, 'DEFLECTED');
      if (paid > 0) {
        session.asteroidsDestroyed += 1;
        session.destroyedThisWave += 1;
      }
      // A rival's deflection is reported by the contract book instead.
      if (paid > 0) {
        hud.showMessage(`${SIZE_NAME[asteroid.size]} asteroid deflected: it will miss the planet. Contract paid: ${formatCredits(paid)}`, 'success', 3.5);
        sound.killConfirm();
      }
    }
  }

  private applyHit(
    asteroid: Asteroid,
    point: THREE.Vector3,
    baseDamage: number,
    weapon: WeaponKind,
    range: number,
    direction: THREE.Vector3,
    pilot: PilotId,
  ): void {
    const { field, explosions, scorches, sound, feedback, hud } = this.deps;
    const mine = pilot === 'player';
    const rangeMultiplier = weapon === 'laser' ? laserRangeMultiplier(range) : 1;
    const damage = weaponDamage(baseDamage * rangeMultiplier, weapon, asteroid.material);
    const resisted = MATERIAL_TRAITS[asteroid.material].weaponMultiplier[weapon] < 1;
    const quality: HitQuality = resisted ? 'resisted' : rangeMultiplier < 0.75 ? 'weak-range' : 'solid';
    this.deps.contracts.recordDamage(asteroid, pilot, Math.min(damage, asteroid.health));
    const destroyed = field.damage(asteroid, damage, weapon);
    if (mine) {
      feedback.hit(point, damage, quality);
    }

    if (!destroyed) {
      const wasOnCourse = asteroid.timeToImpact !== null;
      field.applyImpulse(asteroid, direction, hitSpeedChange(weapon, asteroid.radius, MATERIAL_TRAITS[asteroid.material].density));
      if (mine && wasOnCourse && asteroid.timeToImpact === null) {
        hud.showMessage('Knocked off course: it will now miss the planet', 'success', 3);
      }
      if (mine) {
        sound.hit(asteroid.material === 'iron' || asteroid.material === 'ice' ? asteroid.material : 'rocky');
      }
      scorches.add(asteroid.mesh, point, resisted ? 0.35 : 0.6);
      if (resisted) {
        explosions.spawnHitSpark(point);
      } else {
        explosions.spawnRockChips(point, Math.min(1.5, damage / 20));
      }
      if (mine && resisted && weapon === 'laser' && asteroid.health > asteroid.maxHealth * 0.6) {
        hud.showMessage('Iron resists lasers. Use missiles (F)', 'warning', 2.5);
      }
      return;
    }
    this.destroyAsteroid(asteroid, weapon, pilot);
  }

  private destroyAsteroid(asteroid: Asteroid, weapon: WeaponKind, pilot: PilotId): void {
    const { explosions, sound, session, ship } = this.deps;
    const position = asteroid.mesh.position.clone();
    const splits = fragmentsOnDestroy(asteroid.size, weapon) !== null;
    this.deps.contracts.complete(asteroid, splits ? 'split' : 'destroyed', position, splits ? 'SPLIT' : 'DESTROYED');
    // The pilot's own record (and the field bonus) counts only the pilot's kills.
    if (pilot === 'player') {
      session.asteroidsDestroyed += 1;
      session.destroyedThisWave += 1;
    }
    explosions.spawnExplosion(position, asteroid.radius, asteroid.material === 'ice' ? 'ice' : 'fire', asteroid.velocity);
    explosions.spawnRockChips(position, 1 + SIZE_WEIGHT[asteroid.size] * 3);
    // Rivals' kills are heard less the further away they are.
    const hearing = pilot === 'player' ? 1 : Math.max(0.15, 1 - position.distanceTo(ship.position) / 150);
    sound.explosion(SIZE_WEIGHT[asteroid.size] * hearing);
    if (pilot === 'player') {
      sound.killConfirm();
    }
    this.deps.cameraRig.addShake(SIZE_WEIGHT[asteroid.size] * Math.max(0, 1 - position.distanceTo(ship.position) / 40));
    this.spawnFragments(asteroid, weapon);

    // Shrapnel: blowing up a big rock at point-blank range hurts.
    const shrapnel = SHRAPNEL[asteroid.size];
    const surfaceDistance = position.distanceTo(ship.position) - asteroid.radius;
    const damage = blastDamage(surfaceDistance, shrapnel.radius, shrapnel.damage);
    if (damage > 0) {
      this.damageShip(damage, position, 'Shrapnel', 'The interceptor was destroyed by shrapnel');
    }
  }

  /** Warhead blast: hurts nearby asteroids and the ship if it is too close. */
  private detonateMissile(hit: WeaponHit, pilot: PilotId): void {
    const { field, explosions, sound, ship } = this.deps;
    explosions.spawnExplosion(hit.point, 1.4, 'fire');
    sound.explosion(0.35 * Math.max(0.15, 1 - hit.point.distanceTo(ship.position) / 150));
    for (const other of [...field.all]) {
      if (other === hit.asteroid) {
        continue;
      }
      const distance = other.mesh.position.distanceTo(hit.point) - other.radius;
      const splash = blastDamage(distance, MISSILE_BLAST.radius, MISSILE_SPLASH_DAMAGE);
      if (splash > 0) {
        const away = other.mesh.position.clone().sub(hit.point).normalize();
        this.applyHit(other, other.mesh.position.clone().lerp(hit.point, 0.5), splash, 'missile', 0, away, pilot);
      }
    }
    const selfDamage = blastDamage(hit.point.distanceTo(ship.position), MISSILE_BLAST.radius, MISSILE_BLAST.damage);
    if (selfDamage > 0) {
      const own = pilot === 'player';
      this.damageShip(
        selfDamage,
        hit.point,
        own ? 'Own missile blast' : `${pilotName(pilot)}'s missile blast`,
        own ? 'The interceptor was destroyed by its own missile' : `The interceptor was caught in ${pilotName(pilot)}'s missile blast`,
      );
    }
  }

  private damageShip(amount: number, source: THREE.Vector3, cause: string, causeIfFatal: string): void {
    const { ship, shield, sound, feedback, cameraRig, hud } = this.deps;
    if (!this.deps.shipActive() || ship.hull <= 0) {
      return;
    }
    const result = ship.applyDamage(amount);
    const local = ship.object.worldToLocal(source.clone());
    hud.flashDamage(local, result.hullDamage > 0 ? 1 : 0.45);
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
      this.shipLostCause = causeIfFatal;
    }
  }

  private spawnFragments(parent: Asteroid, weapon: WeaponKind): void {
    const fragments = fragmentsOnDestroy(parent.size, weapon);
    if (!fragments) {
      return;
    }
    for (let index = 0; index < fragments.count; index += 1) {
      // Pieces keep the parent's momentum and drift apart, as real debris would.
      const outward = new THREE.Vector3(...randomUnitVector(this.deps.rng));
      const position = parent.mesh.position.clone().addScaledVector(outward, parent.radius * 0.6);
      const velocity = parent.velocity.clone().addScaledVector(outward, 0.35 + this.deps.rng() * 0.5);
      this.deps.field.spawnFragment(fragments.size, parent.material, position, velocity).identified = true;
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
