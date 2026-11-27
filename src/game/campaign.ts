import * as THREE from 'three';
import type { AsteroidField } from '../asteroids/asteroidField';
import type { SoundEffects } from '../audio/soundEffects';
import type { Hud } from '../hud/hud';
import { OrbitMap } from '../hud/orbitMap';
import { WorkshopPanel } from '../hud/workshopPanel';
import type { InputState } from '../input/inputState';
import { SECTOR_LABEL } from '../logic/orbitPlan';
import { siteTargetingChance } from '../logic/prioritySites';
import { randomUnitVector, type RandomSource } from '../logic/random';
import { waveClearBonus } from '../logic/scoring';
import { UPGRADES, loadoutFor, noUpgrades, purchase, type UpgradeLevels } from '../logic/upgrades';
import { PASSER_BY_RATIO, chooseMaterial, type AsteroidSpawnPlan } from '../logic/waves';
import { EARTH_RADIUS, type Earth } from '../scene/earth';
import type { ShipController } from '../ship/shipController';
import type { SiteDefence } from '../sites/siteDefence';
import { STATION_NAME, type StationOperations } from '../station/stationOperations';
import type { LaserCannon } from '../weapons/laserCannon';
import type { MissileLauncher } from '../weapons/missileLauncher';
import type { GameSession } from './gameSession';
import { WaveDirector, type WaveEvent } from './waveDirector';

/** Hints shown in the first minute: [from second, to second, text]. */
const TIPS: readonly [number, number, string][] = [
  [1, 9, 'Tip: the 3D scanner shows contacts on stalks. Stalk up means above you'],
  [9, 17, 'Tip: red rings on the planet mark where asteroids will land. Guard the labelled sites'],
  [17, 25, 'Tip: press Tab for the tactical map. Time slows while it is open'],
  [25, 33, 'Tip: stay out of the atmosphere. Watch "Above atmosphere" on the left'],
];

export interface CampaignDependencies {
  field: AsteroidField;
  sites: SiteDefence;
  stationOps: StationOperations;
  earth: Earth;
  hud: Hud;
  sound: SoundEffects;
  session: GameSession;
  rng: RandomSource;
  input: InputState;
  ship: ShipController;
  laser: LaserCannon;
  missiles: MissileLauncher;
}

/**
 * The shape of one play-through: the orbit's calm zones and debris fields,
 * what each one triggers (warnings, bonuses, repairs, supply rockets), the
 * upgrades bought at the station, and the opening tips.
 */
export class Campaign {
  readonly director: WaveDirector;
  levels: UpgradeLevels = noUpgrades();
  orbitComplete = false;
  private readonly orbitMap: OrbitMap;
  private readonly workshop: WorkshopPanel;
  private seconds = 0;
  /** Seconds until each harmless passer-by of the current field appears. */
  private passerByDelays: number[] = [];

  constructor(private readonly deps: CampaignDependencies) {
    this.director = new WaveDirector(deps.rng);
    const find = <T extends HTMLElement>(selector: string): T => {
      const found = document.querySelector<T>(selector);
      if (!found) {
        throw new Error(`Campaign element ${selector} is missing from index.html`);
      }
      return found;
    };
    this.orbitMap = new OrbitMap(find<HTMLCanvasElement>('#orbit-map'), find('#orbit-label'));
    this.workshop = new WorkshopPanel(find('#workshop'), find('#workshop-credits'), find<HTMLOListElement>('#workshop-list'));
  }

  get credits(): number {
    return this.deps.session.score - this.deps.session.spent;
  }

  reset(difficulty = 0, keepUpgrades = false): void {
    this.director.reset(difficulty);
    if (!keepUpgrades) {
      this.levels = noUpgrades();
    }
    this.orbitComplete = false;
    this.seconds = 0;
    this.passerByDelays = [];
    this.applyLoadout();
  }

  update(deltaSeconds: number): void {
    const { input, hud, stationOps } = this.deps;
    this.seconds += deltaSeconds;
    this.handleEvents(this.director.update(deltaSeconds, this.deps.field.threatCount));
    this.releasePassersBy(deltaSeconds);

    const docked = stationOps.docking.state === 'docked';
    if (docked) {
      this.handleWorkshopKeys();
    }
    if (input.consumePress('Enter') && this.director.skipCalm()) {
      hud.showMessage('Leaving the calm zone', 'info', 2);
    }
    const tip = TIPS.find(([from, to]) => this.seconds >= from && this.seconds < to);
    hud.setHint(stationOps.docking.hint ?? (tip ? tip[2] : null));
    this.workshop.update(docked, this.levels, this.credits);
    this.orbitMap.draw(this.director);
  }

  private handleWorkshopKeys(): void {
    const { input, hud, sound, session } = this.deps;
    UPGRADES.forEach((upgrade, index) => {
      if (!input.consumePress(`Digit${index + 1}`)) {
        return;
      }
      const result = purchase(this.levels, upgrade.id, this.credits);
      if (!result.ok) {
        hud.showMessage(result.reason === 'maxed' ? `${upgrade.name} is fully upgraded` : `Not enough credits for ${upgrade.name}`, 'warning', 2);
        return;
      }
      this.levels = result.levels;
      session.spent += result.cost;
      this.applyLoadout();
      hud.showMessage(`${upgrade.name} upgraded: ${upgrade.effect}`, 'success', 2.5);
      sound.chime();
    });
  }

  /** Pushes upgrade effects into the systems that use them. */
  private applyLoadout(): void {
    const { ship, laser, missiles, stationOps } = this.deps;
    const loadout = loadoutFor(this.levels);
    ship.fuelCapacity = loadout.fuelCapacity;
    ship.shieldCapacity = loadout.shieldCapacity;
    ship.thrustMultiplier = loadout.thrustMultiplier;
    laser.damageMultiplier = loadout.laserDamageMultiplier;
    laser.coolingMultiplier = loadout.laserCoolingMultiplier;
    missiles.capacity = loadout.missileCapacity;
    stationOps.station.shieldCapacity = loadout.stationShieldCapacity;
  }

  private handleEvents(events: readonly WaveEvent[]): void {
    const { session, hud, sound, sites, stationOps } = this.deps;
    for (const event of events) {
      if (event.type === 'sector-started') {
        session.impactsThisWave = 0;
        session.destroyedThisWave = 0;
        const plan = event.plan;
        if (!plan) {
          const dock = stationOps.present ? ` Dock at ${STATION_NAME} to refuel and upgrade.` : '';
          hud.showMessage(`Calm zone.${dock} Enter moves on when ready`, 'info', 5);
          continue;
        }
        const passersBy = Math.max(1, Math.round(plan.spawns.length * PASSER_BY_RATIO));
        this.passerByDelays = Array.from({ length: passersBy }, () => this.deps.rng() * plan.durationSeconds);
        if (plan.hasGiant) {
          hud.showMessage('Giant asteroid detected. Intercept it far out, or push it off course with missiles', 'danger', 6);
          sound.alarm();
        } else {
          hud.showMessage(`${SECTOR_LABEL[event.sector.kind]}: ${plan.spawns.length} contacts. Scan them to see which matter`, 'warning', 4);
        }
      } else if (event.type === 'spawn') {
        this.spawnAsteroid(event.spawn);
      } else if (event.type === 'wave-cleared') {
        const bonus = waveClearBonus(event.wave, session.destroyedThisWave, session.impactsThisWave);
        session.score += bonus;
        session.wavesCleared += 1;
        const clean = session.impactsThisWave === 0 ? ' No impacts.' : '';
        const reward = bonus > 0 ? ` +${bonus} points.` : '';
        sites.repairSurvivors(loadoutFor(this.levels).siteRepairMultiplier);
        const launchSite = sites.sites.find((site) => site.definition.kind === 'launch' && site.health > 0);
        const supply = stationOps.sendSupplies(launchSite?.localDirection ?? null);
        hud.showMessage(`Field cleared.${reward}${clean}${supply}`, 'success', 5);
        sound.chime();
      } else {
        this.orbitComplete = true;
      }
    }
  }

  /** Traffic that never threatens the planet, so the sky is not only incoming fire. */
  private releasePassersBy(deltaSeconds: number): void {
    const { rng, field } = this.deps;
    this.passerByDelays = this.passerByDelays.map((delay) => delay - deltaSeconds);
    for (const delay of this.passerByDelays) {
      if (delay <= 0) {
        const roll = rng();
        field.spawnPasserBy(roll < 0.5 ? 'small' : roll < 0.85 ? 'medium' : 'large', chooseMaterial(Math.max(1, this.director.wave), rng));
      }
    }
    this.passerByDelays = this.passerByDelays.filter((delay) => delay > 0);
  }

  /** Aims some later-wave asteroids at a standing site, allowing for Earth's rotation. */
  private spawnAsteroid(spawn: AsteroidSpawnPlan): void {
    const { earth, rng, field, sites } = this.deps;
    const site = rng() < siteTargetingChance(this.director.wave) ? sites.pickStanding(rng) : null;
    if (!site) {
      field.spawnIncoming(spawn.size, spawn.material, spawn.direction);
      return;
    }
    // Approach from the site's side of the planet so the path is not blocked.
    const overSite = earth.localToWorldDirectionAt(site.localDirection, 45);
    const direction = overSite.add(new THREE.Vector3(...randomUnitVector(rng)).multiplyScalar(0.5)).normalize();
    field.spawnAt(spawn.size, spawn.material, direction.multiplyScalar(185), 1, (flightSeconds) =>
      earth.localToWorldDirectionAt(site.localDirection, flightSeconds).multiplyScalar(EARTH_RADIUS),
    );
  }
}
