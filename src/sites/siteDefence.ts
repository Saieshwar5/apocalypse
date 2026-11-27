import * as THREE from 'three';
import type { Asteroid } from '../asteroids/asteroidField';
import type { AsteroidSize } from '../logic/asteroidClasses';
import {
  IMPACT_REACH,
  SITE_DEFINITIONS,
  SITE_MAX_HEALTH,
  repairedHealth,
  siteDamage,
  type SiteDefinition,
  type SiteKind,
} from '../logic/prioritySites';
import type { RandomSource } from '../logic/random';
import { latLonToLocalDirection, type Earth } from '../scene/earth';

export interface SiteState {
  definition: SiteDefinition;
  /** Direction of the site in the planet's own (rotating) frame. */
  localDirection: THREE.Vector3;
  health: number;
  /** Seconds until the soonest asteroid that would damage it, or null. */
  threatenedIn: number | null;
}

export interface SiteHit {
  site: SiteState;
  damage: number;
  destroyed: boolean;
}

/**
 * The priority sites on Earth: their health, which incoming asteroids
 * threaten them (allowing for the planet turning before impact) and what
 * each impact does to them.
 */
export class SiteDefence {
  readonly sites: SiteState[];

  constructor(private readonly earth: Earth) {
    this.sites = SITE_DEFINITIONS.map((definition) => ({
      definition,
      localDirection: latLonToLocalDirection(definition.latitude, definition.longitude),
      health: SITE_MAX_HEALTH,
      threatenedIn: null,
    }));
  }

  reset(): void {
    for (const site of this.sites) {
      site.health = SITE_MAX_HEALTH;
      site.threatenedIn = null;
    }
  }

  isStanding(kind: SiteKind): boolean {
    return this.sites.some((site) => site.definition.kind === kind && site.health > 0);
  }

  get citiesStanding(): number {
    return this.sites.filter((site) => site.definition.kind === 'city' && site.health > 0).length;
  }

  get cityCount(): number {
    return this.sites.filter((site) => site.definition.kind === 'city').length;
  }

  /** Marks which asteroids threaten which sites. Call once per frame. */
  updateThreats(asteroids: readonly Asteroid[]): void {
    for (const site of this.sites) {
      site.threatenedIn = null;
    }
    for (const asteroid of asteroids) {
      asteroid.targetSite = null;
      asteroid.threatensSite = false;
      if (asteroid.timeToImpact === null) {
        continue;
      }
      const impact = asteroid.mesh.position.clone().addScaledVector(asteroid.velocity, asteroid.timeToImpact);
      const local = this.earth.worldToLocalDirectionAt(impact, asteroid.timeToImpact);
      const site = this.nearestWithin(local, IMPACT_REACH[asteroid.size].radius);
      if (site) {
        asteroid.targetSite = site.definition.name;
        asteroid.threatensSite = true;
        site.threatenedIn = Math.min(site.threatenedIn ?? Infinity, asteroid.timeToImpact);
      }
    }
  }

  /** Applies an impact at a world-space surface point to every site in reach. */
  applyImpact(worldPoint: THREE.Vector3, size: AsteroidSize): SiteHit[] {
    const local = this.earth.worldToLocalDirection(worldPoint);
    const hits: SiteHit[] = [];
    for (const site of this.sites) {
      if (site.health <= 0) {
        continue;
      }
      const damage = siteDamage(local.angleTo(site.localDirection), size);
      if (damage > 0) {
        site.health = Math.max(0, site.health - damage);
        hits.push({ site, damage, destroyed: site.health === 0 });
      }
    }
    return hits;
  }

  repairSurvivors(): void {
    for (const site of this.sites) {
      site.health = repairedHealth(site.health);
    }
  }

  pickStanding(rng: RandomSource): SiteState | null {
    const standing = this.sites.filter((site) => site.health > 0);
    return standing.length > 0 ? standing[Math.floor(rng() * standing.length)] : null;
  }

  private nearestWithin(local: THREE.Vector3, reach: number): SiteState | null {
    let best: SiteState | null = null;
    let bestAngle = reach;
    for (const site of this.sites) {
      if (site.health <= 0) {
        continue;
      }
      const angle = local.angleTo(site.localDirection);
      if (angle < bestAngle) {
        bestAngle = angle;
        best = site;
      }
    }
    return best;
  }
}
