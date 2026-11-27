import * as THREE from 'three';
import type { AsteroidField } from '../asteroids/asteroidField';
import type { SoundEffects } from '../audio/soundEffects';
import type { Explosions } from '../effects/explosions';
import type { CombatResolver } from '../game/combatResolver';
import type { GameSession } from '../game/gameSession';
import type { Hud } from '../hud/hud';
import {
  DEBRIS_DAMAGE_PER_SECOND,
  SATELLITE_COLLISION_DAMAGE,
  SATELLITE_LOSS_PENALTY,
  scannerRangeBonus,
} from '../logic/satellites';
import type { ShipController } from '../ship/shipController';
import { SatelliteFleet, type Satellite } from './satelliteFleet';

const SHIP_RADIUS = 0.55;

export interface SatelliteTrafficDependencies {
  scene: THREE.Scene;
  model: THREE.Object3D;
  rng: () => number;
  ship: ShipController;
  field: AsteroidField;
  combat: CombatResolver;
  explosions: Explosions;
  sound: SoundEffects;
  hud: Hud;
  session: GameSession;
  /** Groups holding the pilot's laser bolts and missiles, to catch friendly fire. */
  projectiles: readonly THREE.Object3D[];
}

/**
 * The satellites sharing the planet's orbits, and everything that can
 * happen to them: the ship flying into one, asteroids striking them, the
 * pilot's own shots, and the debris clouds they leave. Surviving satellites
 * relay data, which extends scanner range.
 */
export class SatelliteTraffic {
  readonly fleet: SatelliteFleet;
  private debrisWarned = false;
  private readonly world = new THREE.Vector3();

  constructor(private readonly deps: SatelliteTrafficDependencies) {
    this.fleet = new SatelliteFleet(deps.model, deps.rng);
    deps.scene.add(this.fleet.group);
  }

  /** Scanner range multiplier from the satellites still working. */
  get scannerBonus(): number {
    return scannerRangeBonus(this.fleet.aliveCount, this.fleet.satellites.length);
  }

  /** World positions of working satellites, for the scanner. */
  positions(): THREE.Vector3[] {
    return this.fleet.satellites.filter((satellite) => satellite.alive).map((satellite) => satellite.position);
  }

  reset(): void {
    this.fleet.reset();
    this.debrisWarned = false;
  }

  update(deltaSeconds: number, shipActive: boolean): void {
    const { ship, field, combat, hud, session } = this.deps;
    this.fleet.update(deltaSeconds);

    if (shipActive) {
      const struck = this.fleet.findOverlap(ship.position, SHIP_RADIUS);
      if (struck) {
        const point = this.lose(struck, 'You flew into a satellite');
        ship.velocity.addScaledVector(ship.position.clone().sub(point).normalize(), 6);
        combat.applyEnvironmentDamage(SATELLITE_COLLISION_DAMAGE, 'The interceptor was destroyed in a collision with a satellite');
      }
      const inDebris = this.fleet.debrisClouds.some((cloud) => cloud.position.distanceTo(ship.position) < cloud.radius + SHIP_RADIUS);
      if (inDebris) {
        combat.applyEnvironmentDamage(DEBRIS_DAMAGE_PER_SECOND * deltaSeconds, 'The interceptor was shredded by orbital debris');
        if (!this.debrisWarned) {
          hud.showMessage('Debris field: get clear', 'danger', 2.5);
        }
      }
      this.debrisWarned = inDebris;
    }

    for (const asteroid of field.all) {
      const hit = this.fleet.findOverlap(asteroid.mesh.position, asteroid.radius);
      if (hit) {
        this.lose(hit, 'An asteroid destroyed a satellite');
      }
    }

    // The pilot's own shots: a stray bolt or missile wrecks a satellite and costs points.
    for (const group of this.deps.projectiles) {
      for (const projectile of group.children) {
        const previous = projectile.userData.lastSatelliteCheck as THREE.Vector3 | undefined;
        if (!projectile.visible) {
          projectile.userData.lastSatelliteCheck = undefined;
          continue;
        }
        const current = projectile.getWorldPosition(this.world);
        // Bolts cover several units per frame, so test the path they swept,
        // not just where they are now. A long jump means the bolt was reused.
        const start = previous && previous.distanceTo(current) < 30 ? previous : current;
        const hit = this.fleet.findHit(start, current);
        projectile.userData.lastSatelliteCheck = current.clone();
        if (hit) {
          this.lose(hit, `You shot a satellite: -${SATELLITE_LOSS_PENALTY} points`);
          session.score = Math.max(session.spent, session.score - SATELLITE_LOSS_PENALTY);
        }
      }
    }
  }

  private lose(satellite: Satellite, message: string): THREE.Vector3 {
    const { explosions, sound, hud } = this.deps;
    const point = this.fleet.destroy(satellite);
    explosions.spawnExplosion(point, 0.8, 'fire', satellite.velocity);
    sound.explosion(0.25);
    const left = this.fleet.aliveCount;
    hud.showMessage(`${message}. ${left} of ${this.fleet.satellites.length} still relaying`, 'warning', 3.5);
    return point;
  }
}
