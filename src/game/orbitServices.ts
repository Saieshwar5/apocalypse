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
import { Outposts, type OutpostId } from '../station/outposts';
import { SatelliteWork, type JobRow, type Waypoint } from './satelliteWork';
import { TowLine } from './towLine';
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
import type { CombatResolver } from './combatResolver';
import type { ContractBook } from './contractBook';
import type { GameSession } from './gameSession';

export interface OrbitServicesDependencies {
  scene: THREE.Scene;
  outpostModels: Record<OutpostId, THREE.Object3D>;
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
  station: () => { position: THREE.Vector3; velocity: THREE.Vector3 } | null;
  /** Rivals give way to a pilot in good standing, and stop once the licence is under review. */
  playerGoodStanding: () => boolean;
  /** Aegis's own fuel and missile store, for the market; null once it is destroyed. */
  aegisStock: () => { fuel: number; missiles: number } | null;
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

  constructor(private readonly deps: OrbitServicesDependencies) {
    this.outposts = new Outposts(deps.outpostModels);
    this.market = new StationMarket({
      positionOf: (station) => (station === 'aegis' ? (deps.station()?.position ?? null) : this.outposts.get(station).position),
      aegisStock: deps.aegisStock,
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
    });
    deps.scene.add(this.outposts.group, this.tow.mesh, this.market.group);
    this.debris = new OrbitDebris({
      traffic: deps.traffic,
      ship: deps.ship,
      combat: deps.combat,
      wallet: deps.walletOf('player'),
      hud: deps.hud,
      sound: deps.sound,
      rng: deps.rng,
    });
    deps.combat.shatterHook = (asteroid, weapon, position) => this.debris.shatter(asteroid, weapon, position);
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
      station: deps.station,
      playerGoodStanding: deps.playerGoodStanding,
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
  }

  /** `flying`: the pilot has the controls (not docked, not on the map, no autopilot). */
  /** `active`: the player's ship is still in one piece. */
  update(deltaSeconds: number, flying: boolean, active = true, pilotBusy = false): void {
    const { input, ship } = this.deps;
    this.outposts.update(deltaSeconds);
    this.outposts.collide(ship.position, ship.velocity);
    if (input.consumePress('KeyT') && flying) {
      this.toggleTow();
    }
    this.work.update(deltaSeconds);
    this.haul.update();
    this.market.update(deltaSeconds);
    this.berths.update(deltaSeconds, active, pilotBusy);
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
        ghost: false,
        color: outpost.color,
        edgeArrow: false,
      })),
      ...this.rivals.markers(),
    ];
  }

  radarContacts(): { position: THREE.Vector3; color: string; triangle?: boolean }[] {
    return [...this.outposts.list.map((outpost) => ({ position: outpost.position, color: outpost.color })), ...this.rivals.radarContacts()];
  }

  jobRows(): JobRow[] {
    return [...this.work.rows(), ...this.haul.rows(), ...this.debris.rows()];
  }

  waypoint(): Waypoint | null {
    if (this.tow.rock) {
      return this.haul.waypoint();
    }
    return this.work.waypoint() ?? this.haul.waypoint();
  }

  /** T: the haul rock if it is the nearest thing to tow, otherwise satellite work. */
  private toggleTow(): void {
    if (this.tow.rock) {
      this.haul.release();
      return;
    }
    if (!this.tow.load && this.haul.rockNear(this.deps.ship.position)) {
      this.haul.connect();
      return;
    }
    this.work.toggleTow();
  }
}
