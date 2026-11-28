import { currentDelivery, type Delivery } from './delivery';
import type * as THREE from 'three';
import type { AsteroidField } from '../asteroids/asteroidField';
import type { SoundEffects } from '../audio/soundEffects';
import type { Hud } from '../hud/hud';
import type { InputState } from '../input/inputState';
import type { Wallet } from '../logic/economy';
import type { PilotId } from '../logic/rivals';
import type { RandomSource } from '../logic/random';
import type { SatelliteFleet } from '../satellites/satelliteFleet';
import type { ShipController } from '../ship/shipController';
import { Outposts, type ModelOutpostId } from '../station/outposts';
import { SatelliteWork, type JobRow, type Waypoint } from './satelliteWork';
import { TowLine } from './towLine';
import { SpaceWeather } from './spaceWeather';
import { CargoWork } from './cargoWork';
import { CityLife } from './cityLife';
import { cargoKindsFor, jobUnlocked } from '../logic/jobAccess';
import { CITY_STATE_NAME, isCity } from '../logic/cities';
import { RescueWork } from './rescueWork';
import { EscortWork } from './escortWork';
import type { StationOperations } from '../station/stationOperations';
import type { Explosions } from '../effects/explosions';
import { SUN_DIRECTION } from '../scene/sunDirection';
import { EARTH_RADIUS } from '../scene/earth';
import { ATMOSPHERE } from '../logic/atmosphere';
import { StationMarket } from './stationMarket';
import { OutpostBerths } from './outpostBerths';
import { HaulWork } from './haulWork';
import { YARD_PARTS } from '../logic/stationEconomy';
import { STATION_STOCK } from '../logic/stationSupply';
import { formatPrice } from '../logic/contracts';
import { OrbitDebris } from './orbitDebris';
import type { SatelliteTraffic } from '../satellites/satelliteTraffic';
import { FRAGILE } from '../logic/towing';
import { RivalPilots } from './rivalPilots';
import type { RadioNet } from './radioNet';
import type { CombatResolver } from './combatResolver';
import type { ContractBook } from './contractBook';
import type { GameSession } from './gameSession';

/** Rivals pick their shots like professionals: their kills leave half the debris. */
const RIVAL_DEBRIS_SHARE = 0.5;

export interface OrbitServicesDependencies {
  scene: THREE.Scene;
  outpostModels: Record<ModelOutpostId, THREE.Object3D>;
  fleet: SatelliteFleet;
  traffic: SatelliteTraffic;
  ship: ShipController;
  field: AsteroidField;
  walletOf: (pilot: PilotId) => Wallet;
  hud: Hud;
  sound: SoundEffects;
  input: InputState;
  rng: RandomSource;
  /** For the rival pilots. */
  shipSource: THREE.Object3D;
  contracts: ContractBook;
  combat: CombatResolver;
  session: GameSession;
  playerProjectiles: THREE.Group[];
  /** Aegis: its whereabouts, store, docking and supply rocket. */
  stationOps: StationOperations;
  explosions: Explosions;
  /** Rivals give way to a pilot in good standing, and stop once the licence is under review. */
  playerGoodStanding: () => boolean;
  radio: RadioNet;
}

export interface StationMarker {
  world: THREE.Vector3;
  name: string;
  ghost: boolean;
  color?: string;
  /** Show an arrow at the screen edge when it is out of view. */
  edgeArrow?: boolean;
  /** Stations are squares; rival ships are triangles. */
  shape?: 'square' | 'triangle';
  /** A great station's state, shown beside its name on the map. */
  note?: string;
}

/**
 * The working orbit beyond Aegis: the three outposts, the tow line and the
 * satellite contracts that use them.
 */
export class OrbitServices {
  readonly outposts: Outposts;
  readonly tow: TowLine;
  readonly work: SatelliteWork;
  readonly rivals: RivalPilots;
  /** The Cascade: debris, Orbit Health and the clean-up job. */
  readonly debris: OrbitDebris;
  readonly market: StationMarket;
  readonly berths: OutpostBerths;
  readonly haul: HaulWork;
  readonly weather: SpaceWeather;
  readonly cargo: CargoWork;
  /** The three great stations: their lights, their calls and Farwatch's lookout. */
  readonly cities: CityLife;
  readonly rescue: RescueWork;
  readonly escort: EscortWork;

  constructor(private readonly deps: OrbitServicesDependencies) {
    const job = { clock: () => deps.session.clock, fit: () => deps.session.fit };
    this.outposts = new Outposts(deps.outpostModels);
    this.market = new StationMarket({
      positionOf: (station) => (station === 'aegis' ? (deps.stationOps.whereabouts()?.position ?? null) : this.outposts.get(station).position),
      aegisStock: () => (deps.stationOps.present ? deps.stationOps.station.stock : null),
      aegisMissileCapacity: STATION_STOCK.capacity.missiles,
    });
    this.tow = new TowLine(deps.ship, deps.fleet);
    this.work = new SatelliteWork({
      fleet: deps.fleet,
      tow: this.tow,
      outposts: this.outposts,
      ship: deps.ship,
      field: deps.field,
      walletOf: deps.walletOf,
      events: deps.session.events,
      hud: deps.hud,
      sound: deps.sound,
      rng: deps.rng,
      clock: job.clock,
      useYardParts: () => this.market.stock('vulcan', 'parts') >= YARD_PARTS.perRepair && this.market.add('vulcan', 'parts', -YARD_PARTS.perRepair) < 0,
    });
    this.berths = new OutpostBerths({
      outposts: this.outposts,
      market: this.market,
      ship: deps.ship,
      input: deps.input,
      wallet: deps.walletOf('player'),
      hud: deps.hud,
      sound: deps.sound,
    });
    this.haul = new HaulWork({
      ...job,
      field: deps.field,
      outposts: this.outposts,
      market: this.market,
      tow: this.tow,
      ship: deps.ship,
      wallet: deps.walletOf('player'),
      events: deps.session.events,
      hud: deps.hud,
      sound: deps.sound,
      rng: deps.rng,
      radio: deps.radio,
    });
    deps.fleet.burnRadius = EARTH_RADIUS + ATMOSPHERE.top + 0.5;
    this.weather = new SpaceWeather({
      ship: deps.ship,
      combat: deps.combat,
      fleet: deps.fleet,
      work: this.work,
      hud: deps.hud,
      sound: deps.sound,
      radio: deps.radio,
      sunDirection: SUN_DIRECTION,
      atStation: () => deps.stationOps.holdingShip || this.berths.holding,
      canReboost: () => jobUnlocked('satelliteTow', deps.session.rank),
    });
    this.cargo = new CargoWork({
      session: deps.session,
      ship: deps.ship,
      at: (station) => (station === 'aegis' ? deps.stationOps.docking.state === 'docked' : this.berths.berthedAt === station),
      portOf: (station) => (station === 'aegis' ? (deps.stationOps.whereabouts()?.position ?? null) : this.outposts.portPosition(station)),
      stocks: () => this.market.snapshot(),
      addStock: (station, good, amount) => this.market.add(station, good, amount),
      kinds: () => cargoKindsFor(deps.session.rank),
      wallet: deps.walletOf('player'),
      events: deps.session.events,
      hud: deps.hud,
      sound: deps.sound,
      radio: deps.radio,
      rng: deps.rng,
    });
    this.rescue = new RescueWork({
      ...job,
      scene: deps.scene,
      ship: deps.ship,
      tow: this.tow,
      outposts: this.outposts,
      explosions: deps.explosions,
      wallet: deps.walletOf('player'),
      events: deps.session.events,
      hud: deps.hud,
      sound: deps.sound,
      radio: deps.radio,
      rng: deps.rng,
    });
    this.escort = new EscortWork({
      ...job,
      field: deps.field,
      rocket: () => (deps.stationOps.present ? deps.stationOps.rocket : null),
      allowed: () => jobUnlocked('escort', deps.session.rank),
      explosions: deps.explosions,
      wallet: deps.walletOf('player'),
      events: deps.session.events,
      hud: deps.hud,
      sound: deps.sound,
      radio: deps.radio,
      rng: deps.rng,
    });
    this.cities = new CityLife({ outposts: this.outposts, stocks: () => this.market.snapshot(), hud: deps.hud, radio: deps.radio });
    deps.scene.add(this.outposts.group, this.tow.mesh, this.market.group);
    this.debris = new OrbitDebris({
      ...job,
      traffic: deps.traffic,
      ship: deps.ship,
      combat: deps.combat,
      wallet: deps.walletOf('player'),
      hud: deps.hud,
      sound: deps.sound,
      rng: deps.rng,
    });
    deps.combat.shatterHook = (asteroid, weapon, position, pilot) => this.debris.shatter(asteroid, weapon, position, pilot === 'player' ? 1 : RIVAL_DEBRIS_SHARE);
    this.rivals = new RivalPilots({
      scene: deps.scene,
      shipSource: deps.shipSource,
      field: deps.field,
      fleet: deps.fleet,
      contracts: deps.contracts,
      work: this.work,
      combat: deps.combat,
      session: deps.session,
      ship: deps.ship,
      hud: deps.hud,
      sound: deps.sound,
      playerProjectiles: deps.playerProjectiles,
      station: () => deps.stationOps.whereabouts(),
      playerGoodStanding: deps.playerGoodStanding,
      radio: deps.radio,
    });
  }

  reset(): void {
    this.outposts.reset();
    this.work.reset();
    this.rivals.reset();
    this.debris.reset();
    this.market.reset();
    this.berths.reset();
    this.haul.reset();
    this.weather.reset();
    this.cargo.reset();
    this.cities.reset();
    this.rescue.reset();
    this.escort.reset();
  }

  /** `flying`: the pilot has the controls (not docked, not on the map, no autopilot). */
  /** `active`: the player's ship is still in one piece. */
  update(deltaSeconds: number, flying: boolean, active = true, pilotBusy = false): void {
    const { input, ship } = this.deps;
    this.outposts.update(deltaSeconds);
    this.outposts.collide(ship.position, ship.velocity);
    // T always works with something on the line, even if a station is holding the ship.
    const loadOnLine = this.tow.load !== null || this.tow.body !== null;
    if (input.consumePress('KeyT') && (flying || (active && loadOnLine))) {
      this.toggleTow();
    }
    this.work.update(deltaSeconds);
    this.haul.update();
    this.market.update(deltaSeconds);
    this.cities.update();
    this.berths.update(deltaSeconds, active, pilotBusy);
    this.weather.update(deltaSeconds, active);
    this.cargo.update(deltaSeconds, active);
    this.rescue.update(deltaSeconds);
    this.escort.update();
    // The line groans as the pull nears the strain a satellite can take.
    this.deps.sound.towCreak(Math.min(1, this.tow.tension / (FRAGILE.safeTension * 1.4)));
    this.rivals.update(deltaSeconds, active);
    this.debris.update(deltaSeconds, active);
  }

  /** On-screen markers for the outposts; only the job's destination gets an edge arrow. */
  markers(): StationMarker[] {
    return [
      ...this.outposts.list.map((outpost) => ({
        world: outpost.position,
        name: `${outpost.name} · fuel ${formatPrice(this.market.price(outpost.id, 'fuel'))}`,
        note: isCity(outpost.id) ? CITY_STATE_NAME[this.cities.stateOf(outpost.id)].toUpperCase() : undefined,
        ghost: false,
        color: outpost.color,
        edgeArrow: false,
      })),
      ...this.rivals.markers(),
    ];
  }

  radarContacts(): { position: THREE.Vector3; color: string; triangle?: boolean; cloud?: number }[] {
    const clouds = this.deps.traffic.fleet.debris.clouds
      .filter((cloud) => cloud.mass >= 0.5)
      .map((cloud) => ({ position: cloud.position, color: '#ffb35c', cloud: cloud.mass }));
    return [...this.outposts.list.map((outpost) => ({ position: outpost.position, color: outpost.color })), ...this.rivals.radarContacts(), ...clouds];
  }

  /** What is on the player's tow line and where it goes, or null with a clear line. */
  delivery(): Delivery | null {
    return currentDelivery(this.tow, this.work, this.haul, this.rescue, this.deps.fleet, this.outposts);
  }

  jobRows(): JobRow[] {
    return [...this.rescue.rows(), ...this.escort.rows(), ...this.work.rows(), ...this.cargo.rows(), ...this.haul.rows(), ...this.debris.rows()];
  }

  waypoint(): Waypoint | null {
    if (this.tow.body) {
      return this.rescue.carrying ? this.rescue.waypoint() : this.haul.waypoint();
    }
    // People aboard come first; otherwise satellite work, then the cargo run.
    return this.rescue.waypoint() ?? (this.cargo.passengersAboard ? this.cargo.waypoint() : null) ?? this.work.waypoint() ?? this.cargo.waypoint() ?? this.haul.waypoint();
  }

  /** The hint line: berthing first, then any storm warning. The tow card already says when to release. */
  get hint(): string | null {
    if (this.berths.loadOnLine && this.delivery()?.step.state !== 'travel') {
      return this.weather.hint;
    }
    return this.berths.hint ?? this.weather.hint;
  }

  /**
   * Work posted in a calm zone besides satellite jobs: a transfer between
   * stations, sometimes a storm or a rescue. Rock hauls for Ceres are not
   * posted any more; the job is kept for a later story mission.
   */
  calmZoneWork(): void {
    const { rng, session } = this.deps;
    this.cargo.post();
    if (rng() < 0.3) {
      this.weather.warn();
    } else if (rng() < 0.35 && jobUnlocked('rescue', session.rank)) {
      this.rescue.post();
    }
  }

  /** T: the haul rock if it is the nearest thing to tow, otherwise satellite work. */
  private toggleTow(): void {
    if (this.tow.body) {
      if (this.rescue.carrying) {
        this.rescue.release();
      } else {
        this.haul.release();
      }
      return;
    }
    if (!this.tow.load && this.rescue.podNear(this.deps.ship.position)) {
      this.rescue.connect();
      return;
    }
    if (!this.tow.load && this.haul.rockNear(this.deps.ship.position)) {
      this.haul.connect();
      return;
    }
    this.work.toggleTow();
  }
}
