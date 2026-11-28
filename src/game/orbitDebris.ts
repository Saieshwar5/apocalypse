import type { ModuleEffects } from '../logic/shipModules';
import * as THREE from 'three';
import type { Asteroid } from '../asteroids/asteroidField';
import type { SoundEffects } from '../audio/soundEffects';
import type { Hud } from '../hud/hud';
import type { WeaponKind } from '../logic/asteroidClasses';
import {
  CASCADE,
  SWEEP,
  debrisDamageScale,
  orbitHealth,
  shatterDebris,
  stepCloudMass,
  strikeChancePerSecond,
  sweptTonnes,
} from '../logic/cascade';
import { formatCredits } from '../logic/contracts';
import type { Wallet } from '../logic/economy';
import type { RandomSource } from '../logic/random';
import { DEBRIS_DAMAGE_PER_SECOND } from '../logic/satellites';
import { EARTH_RADIUS } from '../scene/earth';
import type { SatelliteTraffic } from '../satellites/satelliteTraffic';
import type { ShipController } from '../ship/shipController';
import type { CombatResolver } from './combatResolver';
import type { JobRow } from './satelliteJobHelpers';

export interface OrbitDebrisDependencies {
  traffic: SatelliteTraffic;
  ship: ShipController;
  combat: CombatResolver;
  wallet: Wallet;
  hud: Hud;
  sound: SoundEffects;
  rng: RandomSource;
  /** What the fitted modules do (the sweeper net). */
  fit: () => ModuleEffects;
}

/** The ship's hit sphere against debris. */
const SHIP_RADIUS = 0.55;
/** Debris from a new shatter joins a cloud whose centre is this close. */
const MERGE_DISTANCE = 4;
/** Labels are drawn for clouds within this distance. */
const LABEL_RANGE = 140;
/** Health levels that get a warning when orbit falls through them. */
const WARNINGS: readonly [number, string][] = [
  [70, 'Orbit health falling: debris is building up. Sweep it, or deflect rocks instead of shattering them'],
  [50, 'Orbit health poor. Satellites are at risk from debris'],
  [CASCADE.tippingHealth, 'Orbit is past the Singularity point: debris is multiplying by itself. Clean it up now'],
  [15, 'Cascade critical: orbit is closing'],
];

/**
 * The Cascade in play: debris clouds left by shattered rocks and broken
 * satellites, their drag and (past the tipping point) runaway growth,
 * satellites broken by debris, the ship's damage inside a cloud, and the
 * clean-up job of sweeping debris slowly with the ship's net.
 */
export class OrbitDebris {
  /** Current Orbit Health, 0 to 100. */
  health = 100;
  /** Tonnes swept and credits earned this run, for the end screen. */
  swept = 0;
  private sweepPay = 0;
  private sweepMessageTimer = 0;
  /** Warning levels already announced; re-armed when health recovers well above them. */
  private readonly warned = new Set<number>();
  private damageWarned = false;

  constructor(private readonly deps: OrbitDebrisDependencies) {}

  reset(): void {
    this.health = 100;
    this.swept = 0;
    this.sweepPay = 0;
    this.sweepMessageTimer = 0;
    this.warned.clear();
    this.damageWarned = false;
  }

  get totalMass(): number {
    return this.deps.traffic.fleet.debris.totalMass;
  }

  /** Debris left by destroying a rock here; returns the tonnes added. */
  /** `share` scales the debris: rivals, as licensed professionals, leave half. */
  shatter(asteroid: Asteroid, weapon: WeaponKind, position: THREE.Vector3, share = 1): number {
    const tonnes = shatterDebris(asteroid.size, weapon, position.length(), EARTH_RADIUS) * share;
    if (tonnes <= 0) {
      return 0;
    }
    const { fleet } = this.deps.traffic;
    const nearby = fleet.debris.clouds.find((cloud) => cloud.position.distanceTo(position) < MERGE_DISTANCE);
    if (nearby) {
      nearby.mass += tonnes;
    } else {
      fleet.debris.add(fleet.orbitAt(position, asteroid.velocity), tonnes, 'rock', fleet.clock);
    }
    return tonnes;
  }

  update(deltaSeconds: number, shipActive: boolean): void {
    const { traffic } = this.deps;
    const clouds = traffic.fleet.debris.clouds;
    this.health = orbitHealth(this.totalMass);
    for (const cloud of clouds) {
      cloud.mass = stepCloudMass(cloud.mass, cloud.position.length() - EARTH_RADIUS, this.health, deltaSeconds);
    }
    this.breakSatellites(deltaSeconds);
    if (shipActive) {
      this.flyThrough(deltaSeconds);
    }
    this.announce();
  }

  /** The clean-up job's row on the contract board, when there is debris worth sweeping. */
  rows(): JobRow[] {
    const total = this.totalMass;
    if (total < 2) {
      return [];
    }
    const count = this.deps.traffic.fleet.debris.clouds.length;
    return [
      {
        title: `Orbit clean-up · ${formatCredits(SWEEP.payPerTonne)} per tonne`,
        detail: `${count} cloud${count === 1 ? '' : 's'} · ${Math.round(total)} t in orbit · fly through slowly to sweep`,
        pay: Math.round(total * SWEEP.payPerTonne),
        urgent: this.health < CASCADE.tippingHealth,
      },
    ];
  }

  /** On-screen labels for nearby clouds. */
  labels(viewer: THREE.Vector3): { world: THREE.Vector3; text: string }[] {
    return this.deps.traffic.fleet.debris.clouds
      .filter((cloud) => cloud.position.distanceTo(viewer) < LABEL_RANGE)
      .map((cloud) => ({ world: cloud.position, text: `DEBRIS ${cloud.mass < 10 ? cloud.mass.toFixed(1) : Math.round(cloud.mass)} t` }));
  }

  /** Satellites passing through debris can be struck: the chain reaction. */
  private breakSatellites(deltaSeconds: number): void {
    const { traffic, rng } = this.deps;
    for (const satellite of traffic.fleet.satellites) {
      if (!satellite.alive || satellite.mode === 'yard') {
        continue;
      }
      for (const cloud of traffic.fleet.debris.clouds) {
        if (cloud.position.distanceTo(satellite.position) > cloud.radius + satellite.radius) {
          continue;
        }
        if (rng() < strikeChancePerSecond(cloud.mass) * deltaSeconds) {
          traffic.lose(satellite, 'Debris tore a satellite apart: the cascade grows');
          break;
        }
      }
    }
  }

  /** Damage at speed, sweeping at a crawl. */
  private flyThrough(deltaSeconds: number): void {
    const { ship, combat, wallet, hud, traffic } = this.deps;
    let inside = false;
    for (const cloud of traffic.fleet.debris.clouds) {
      if (cloud.position.distanceTo(ship.position) > cloud.radius + SHIP_RADIUS) {
        continue;
      }
      inside = true;
      const relativeSpeed = ship.velocity.distanceTo(cloud.velocity);
      combat.applyEnvironmentDamage(
        DEBRIS_DAMAGE_PER_SECOND * debrisDamageScale(relativeSpeed) * deltaSeconds,
        'The interceptor was shredded by orbital debris',
      );
      const fit = this.deps.fit();
      const tonnes = sweptTonnes(relativeSpeed, cloud.mass, deltaSeconds, fit.sweepRate, fit.sweepSpeed);
      if (tonnes > 0) {
        cloud.mass -= tonnes;
        this.swept += tonnes;
        this.sweepPay += tonnes * SWEEP.payPerTonne;
        // Pay out in whole credits as they accumulate.
        const whole = Math.floor(this.sweepPay);
        if (whole > 0) {
          wallet.earn(whole);
          this.sweepPay -= whole;
        }
      } else if (!this.damageWarned) {
        hud.showMessage(`Too fast for the net: slow below ${Math.round(SWEEP.maxRelativeSpeed * this.deps.fit().sweepSpeed)} relative to the debris (brake with S)`, 'warning', 3);
        this.damageWarned = true;
      }
    }
    if (!inside) {
      this.damageWarned = false;
    }
    this.sweepMessageTimer -= deltaSeconds;
    if (inside && this.sweepMessageTimer <= 0 && this.swept > 0) {
      hud.showMessage(`Sweeping debris: ${this.swept.toFixed(1)} t collected this run (${formatCredits(SWEEP.payPerTonne)} a tonne)`, 'success', 2);
      this.sweepMessageTimer = 2.5;
    }
  }

  private announce(): void {
    for (const [level, text] of WARNINGS) {
      if (this.health < level && !this.warned.has(level)) {
        this.warned.add(level);
        this.deps.hud.showMessage(text, level <= CASCADE.tippingHealth ? 'danger' : 'warning', 5);
        this.deps.sound.alarm();
      } else if (this.health > level + 5) {
        this.warned.delete(level);
      }
    }
  }
}
