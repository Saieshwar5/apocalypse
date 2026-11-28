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

  constructor(private readonly deps: OrbitServicesDependencies) {
    this.outposts = new Outposts(deps.outpostModels);
    this.tow = new TowLine(deps.ship, deps.fleet);
    this.work = new SatelliteWork({
      fleet: deps.fleet,
      tow: this.tow,
      outposts: this.outposts,
      ship: deps.ship,
      field: deps.field,
      walletOf: deps.walletOf,
      hud: deps.hud,
      sound: deps.sound,
      rng: deps.rng,
    });
    deps.scene.add(this.outposts.group, this.tow.mesh);
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
    });
  }

  reset(): void {
    this.outposts.reset();
    this.work.reset();
    this.rivals.reset();
    this.debris.reset();
  }

  /** `flying`: the pilot has the controls (not docked, not on the map, no autopilot). */
  /** `active`: the player's ship is still in one piece. */
  update(deltaSeconds: number, flying: boolean, active = true): void {
    const { input, ship } = this.deps;
    this.outposts.update(deltaSeconds);
    this.outposts.collide(ship.position, ship.velocity);
    if (input.consumePress('KeyT') && flying) {
      this.work.toggleTow();
    }
    this.work.update(deltaSeconds);
    // The line groans as the pull nears the strain a satellite can take.
    this.deps.sound.towCreak(Math.min(1, this.tow.tension / (FRAGILE.safeTension * 1.4)));
    this.rivals.update(deltaSeconds, active);
    this.debris.update(deltaSeconds, active);
  }

  /** On-screen markers for the outposts; only the job's destination gets an edge arrow. */
  markers(): StationMarker[] {
    return [
      ...this.outposts.list.map((outpost) => ({ world: outpost.position, name: outpost.name, ghost: false, color: outpost.color, edgeArrow: false })),
      ...this.rivals.markers(),
    ];
  }

  radarContacts(): { position: THREE.Vector3; color: string; triangle?: boolean }[] {
    return [...this.outposts.list.map((outpost) => ({ position: outpost.position, color: outpost.color })), ...this.rivals.radarContacts()];
  }

  jobRows(): JobRow[] {
    return [...this.work.rows(), ...this.debris.rows()];
  }

  waypoint(): Waypoint | null {
    return this.work.waypoint();
  }
}
