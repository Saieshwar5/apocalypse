import { jobUnlocked } from '../logic/jobAccess';
import { LOCK_RANGE } from '../weapons/missileLauncher';
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
import { formatCredits } from '../logic/contracts';
import { SATELLITE_INCOME } from '../logic/stationEconomy';
import { EARTH_RADIUS, type Earth } from '../scene/earth';
import type { ContractBook } from './contractBook';
import type { SatelliteWork } from './satelliteWork';
import type { RadioNet } from './radioNet';
import { TrainingFlight } from './trainingFlight';
import { beatForSector } from '../logic/story';
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
  contracts: ContractBook;
  /** Satellite contracts: posted in calm zones, sometimes during fields. */
  work: SatelliteWork;
  /** A hint from berthing at an outpost, shown like the docking hint. */
  extraHint: () => string | null;
  /** Hauls, crew calls and the odd solar storm, posted in calm zones. */
  calmZoneWork: (sector: number) => void;
  /** Working satellites, which pay the pilot a fee when a field is cleared. */
  workingSatellites: () => number;
  radio: RadioNet;
  /** Records that the training flight was completed. */
  onTrainingComplete: () => void;
}

/**
 * The shape of one play-through: the orbit's calm zones and debris fields,
 * what each one triggers (warnings, bonuses, repairs, supply rockets), the
 * upgrades bought at the station, and the opening tips.
 */
export class Campaign {
  readonly director: WaveDirector;
  /** The guided first flight; fields wait while it runs. */
  readonly training: TrainingFlight;
  levels: UpgradeLevels = noUpgrades();
  orbitComplete = false;
  private readonly orbitMap: OrbitMap;
  private readonly workshop: WorkshopPanel;
  private seconds = 0;
  /** Seconds until each harmless passer-by of the current field appears. */
  private passerByDelays: number[] = [];
  /** Seconds until a solar flare starts in this field; Infinity when none is due. */
  private flareIn = Infinity;
  /** Seconds until a satellite dodge threat is posted; Infinity when none is due. */
  private dodgeIn = Infinity;
  private flareRemaining = 0;

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
    this.training = new TrainingFlight({
      ship: deps.ship,
      field: deps.field,
      stationOps: deps.stationOps,
      input: deps.input,
      hud: deps.hud,
      sound: deps.sound,
      radio: deps.radio,
      onComplete: deps.onTrainingComplete,
    });
    this.workshop = new WorkshopPanel(find('#workshop'), find('#workshop-credits'), find<HTMLOListElement>('#workshop-list'));
  }

  /** True while a solar flare is blinding the scanner and path predictions. */
  get scannerBlind(): boolean {
    return this.flareRemaining > 0;
  }

  get credits(): number {
    return this.deps.session.wallet.balance;
  }

  reset(difficulty = 0, keepUpgrades = false, training = false): void {
    this.director.reset(difficulty);
    this.training.stop();
    if (training) {
      this.training.start();
    }
    if (!keepUpgrades) {
      this.levels = noUpgrades();
    }
    this.orbitComplete = false;
    this.seconds = 0;
    this.passerByDelays = [];
    this.flareIn = Infinity;
    this.flareRemaining = 0;
    this.dodgeIn = Infinity;
    this.applyLoadout();
  }

  update(deltaSeconds: number): void {
    const { input, hud, stationOps } = this.deps;
    if (this.training.active) {
      this.training.update(deltaSeconds);
      this.workshop.update(stationOps.docking.state === 'docked', this.levels, this.credits);
      return;
    }
    this.seconds += deltaSeconds;
    this.handleEvents(this.director.update(deltaSeconds, this.deps.field.threatCount));
    this.releasePassersBy(deltaSeconds);
    this.updateFlare(deltaSeconds);
    this.updateSatelliteJobs(deltaSeconds);
    this.updateTension();

    const docked = stationOps.docking.state === 'docked';
    if (docked) {
      this.handleWorkshopKeys();
    }
    if (input.consumePress('Enter') && this.director.skipCalm()) {
      hud.showMessage('Leaving the calm zone', 'info', 2);
    }
    const tip = TIPS.find(([from, to]) => this.seconds >= from && this.seconds < to);
    hud.setHint(stationOps.docking.hint ?? this.deps.extraHint() ?? (tip && hud.newPilot ? tip[2] : null));
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
        hud.showMessage(result.reason === 'maxed' ? `${upgrade.name} is fully upgraded` : `Not enough money for ${upgrade.name}`, 'warning', 2);
        return;
      }
      session.wallet.spend(result.cost);
      this.levels = result.levels;
      this.applyLoadout();
      hud.showMessage(`${upgrade.name} upgraded: ${upgrade.effect}`, 'success', 2.5);
      sound.chime();
    });
  }

  /** Pushes upgrade and module effects into the systems that use them. */
  applyLoadout(): void {
    const { ship, laser, missiles, stationOps, session } = this.deps;
    const loadout = loadoutFor(this.levels);
    const fit = session.fit;
    ship.fuelCapacity = loadout.fuelCapacity * fit.fuelCapacity;
    ship.fuel = Math.min(ship.fuel, ship.fuelCapacity);
    ship.shieldCapacity = loadout.shieldCapacity;
    ship.thrustMultiplier = loadout.thrustMultiplier;
    ship.massFactor = fit.massFactor + session.cargoMass;
    laser.damageMultiplier = loadout.laserDamageMultiplier;
    laser.coolingMultiplier = loadout.laserCoolingMultiplier;
    missiles.capacity = loadout.missileCapacity + fit.extraMissiles;
    missiles.ammunition = Math.min(missiles.ammunition, missiles.capacity);
    missiles.lockRange = LOCK_RANGE * fit.lockRange;
    stationOps.station.shieldCapacity = loadout.stationShieldCapacity;
  }

  private handleEvents(events: readonly WaveEvent[]): void {
    const { session, hud, sound, sites, stationOps } = this.deps;
    for (const event of events) {
      if (event.type === 'sector-started') {
        session.impactsThisWave = 0;
        session.destroyedThisWave = 0;
        this.deps.contracts.startField();
        const beat = beatForSector(event.index);
        if (beat) {
          this.deps.radio.say(beat.speaker, beat.line);
        }
        const plan = event.plan;
        if (!plan) {
          const dock = stationOps.present ? ` Dock at ${STATION_NAME} to refuel and upgrade.` : '';
          hud.showMessage(`Calm zone.${dock} Enter moves on when ready`, 'info', 5);
          // Calm stretches are when satellite operators post work.
          this.deps.radio.setCalm(true);
          this.deps.radio.moment('calm-start');
          this.calmZoneJobs();
          continue;
        }
        this.deps.radio.setCalm(false);
        this.deps.radio.moment('field-start');
        const passersBy = Math.max(1, Math.round(plan.spawns.length * PASSER_BY_RATIO));
        this.passerByDelays = Array.from({ length: passersBy }, () => this.deps.rng() * plan.durationSeconds);
        // Dense fields sometimes bring a solar flare that blinds the scanner for a while.
        this.dodgeIn = this.deps.rng() < 0.25 ? 10 + this.deps.rng() * plan.durationSeconds * 0.5 : Infinity;
        this.flareIn = event.sector.kind === 'dense' && this.deps.rng() < 0.6 ? 12 + this.deps.rng() * 25 : Infinity;
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
        const income = this.deps.workingSatellites() * SATELLITE_INCOME;
        session.wallet.earn(bonus + income);
        session.wavesCleared += 1;
        const { fieldEarned, fieldLost } = this.deps.contracts;
        const clean = session.impactsThisWave === 0 ? ' No impacts.' : '';
        const lost = fieldLost > 0 ? `, lost ${formatCredits(fieldLost)}` : '';
        const satellites = income > 0 ? `, satellite fees ${formatCredits(income)}` : '';
        const reward = ` Earned ${formatCredits(fieldEarned + bonus + income)}${bonus > 0 ? ` (bonus ${formatCredits(bonus)}${satellites})` : satellites ? ` (${satellites.slice(2)})` : ''}${lost}.`;
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

  private calmZoneJobs(): void {
    const { work, rng, session } = this.deps;
    // Satellite work comes with the Pilot rank; replacing a lost satellite with Senior Pilot.
    const replaced = jobUnlocked('deploy', session.rank) && rng() < 0.6 && work.postDeploy();
    if (!replaced && jobUnlocked('satelliteTow', session.rank) && !work.yardBusy && rng() < 0.75 && work.postRepairTow()) {
      this.deps.radio.moment('repair-posted');
    }
    if (jobUnlocked('guard', session.rank) && rng() < 0.5) {
      this.dodgeIn = 6 + rng() * 6;
    }
    this.deps.calmZoneWork(this.director.index);
  }

  private updateSatelliteJobs(deltaSeconds: number): void {
    this.dodgeIn -= deltaSeconds;
    if (this.dodgeIn <= 0) {
      this.dodgeIn = Infinity;
      this.deps.work.postDodge();
    }
  }

  private updateFlare(deltaSeconds: number): void {
    const { hud, sound } = this.deps;
    if (this.flareRemaining > 0) {
      this.flareRemaining -= deltaSeconds;
      if (this.flareRemaining <= 0) {
        hud.showMessage('Solar flare has passed. Scanner back online', 'success', 3);
      }
      return;
    }
    const before = this.flareIn;
    this.flareIn -= deltaSeconds;
    if (before > 5 && this.flareIn <= 5) {
      hud.showMessage('Solar flare in 5 seconds. The scanner will go dark: note your targets', 'danger', 4.5);
      sound.alarm();
    } else if (this.flareIn <= 0) {
      this.flareIn = Infinity;
      this.flareRemaining = 8;
      hud.showMessage('Solar flare: scanner and path predictions offline', 'warning', 4);
    }
  }

  /** Music follows the most pressing identified danger. */
  private updateTension(): void {
    let tension = this.director.phase === 'field' ? 0.25 : 0;
    for (const asteroid of this.deps.field.all) {
      if (asteroid.timeToImpact !== null && asteroid.assessedDamage > 0) {
        tension = Math.max(tension, Math.min(1, asteroid.assessedDamage / 16) * Math.max(0, 1 - asteroid.timeToImpact / 60));
      }
    }
    this.deps.sound.setTension(tension);
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
    field.spawnAt(spawn.size, spawn.material, direction.multiplyScalar(250), 1, (flightSeconds) =>
      earth.localToWorldDirectionAt(site.localDirection, flightSeconds).multiplyScalar(EARTH_RADIUS),
    );
  }
}
