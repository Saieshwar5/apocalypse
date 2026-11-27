import * as THREE from 'three';
import type { Asteroid, AsteroidField } from '../asteroids/asteroidField';
import type { SoundEffects } from '../audio/soundEffects';
import type { CameraRig } from '../camera/cameraRig';
import type { Explosions } from '../effects/explosions';
import type { Hud } from '../hud/hud';
import { closestApproach } from '../logic/ballistics';
import { STATION_DEFENCE, STATION_IMPACT_DAMAGE, stationCondition } from '../logic/stationDamage';
import type { SpaceStation } from './spaceStation';

export interface StationDefenceDependencies {
  station: SpaceStation;
  field: AsteroidField;
  explosions: Explosions;
  sound: SoundEffects;
  hud: Hud;
  cameraRig: CameraRig;
  stationName: string;
}

/**
 * Asteroids against the station: flags rocks whose path will strike it, and
 * applies the damage when one does. The station's shield takes small hits;
 * bigger ones degrade it in stages until it is destroyed.
 */
export class StationDefence {
  /** Seconds until the soonest asteroid on a collision course, or null. */
  threatenedIn: number | null = null;

  constructor(private readonly deps: StationDefenceDependencies) {}

  /** Call after site threats are marked, so a station threat can override the label. */
  update(shipPosition: THREE.Vector3): void {
    const { station, field } = this.deps;
    this.threatenedIn = null;
    if (station.destroyed || !station.group.visible) {
      return;
    }
    for (const asteroid of [...field.all]) {
      const relativePosition = asteroid.mesh.position.clone().sub(station.position);
      const reach = STATION_DEFENCE.bodyRadius + asteroid.radius;
      if (relativePosition.lengthSq() <= reach * reach) {
        this.strike(asteroid, shipPosition);
        if (station.destroyed) {
          return;
        }
        continue;
      }
      const pass = closestApproach(relativePosition.toArray(), asteroid.velocity.clone().sub(station.velocity).toArray());
      // Only count rocks that reach the station before they would reach Earth.
      if (pass.distance < reach && (asteroid.timeToImpact === null || pass.time < asteroid.timeToImpact)) {
        asteroid.targetSite = this.deps.stationName;
        asteroid.threatensSite = true;
        this.threatenedIn = Math.min(this.threatenedIn ?? Infinity, pass.time);
      }
    }
  }

  private strike(asteroid: Asteroid, shipPosition: THREE.Vector3): void {
    const { station, field, explosions, sound, hud, cameraRig, stationName } = this.deps;
    const before = stationCondition(station.defence.health);
    const point = asteroid.mesh.position.clone();
    field.remove(asteroid);
    explosions.spawnExplosion(point, asteroid.radius, asteroid.material === 'ice' ? 'ice' : 'fire');
    station.takeDamage(STATION_IMPACT_DAMAGE[asteroid.size]);
    sound.explosion(0.4);
    cameraRig.addShake(Math.max(0, 0.8 - shipPosition.distanceTo(point) / 40));

    const after = stationCondition(station.defence.health);
    if (after === 'destroyed') {
      explosions.spawnExplosion(station.position, 4, 'fire');
      explosions.spawnRockChips(station.position, 4);
      sound.explosion(1);
      sound.alarm();
      hud.showMessage(`${stationName} STATION DESTROYED. No more refuelling or missiles`, 'danger', 7);
    } else if (station.defence.shield > 0 && after === before) {
      hud.showMessage(`${stationName} hit: shield at ${Math.round(station.defence.shield)}%`, 'warning', 3);
    } else if (after !== before) {
      const effect = after === 'damaged' ? 'Refuelling slowed' : 'Missile reloads offline';
      hud.showMessage(`${stationName} ${after.toUpperCase()}: structure ${Math.round(station.defence.health)}%. ${effect}`, 'danger', 5);
      sound.alarm();
    } else {
      hud.showMessage(`${stationName} hit: structure ${Math.round(station.defence.health)}%`, 'danger', 3.5);
    }
  }
}
