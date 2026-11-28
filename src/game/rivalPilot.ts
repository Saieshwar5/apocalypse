import * as THREE from 'three';
import type { Asteroid } from '../asteroids/asteroidField';
import { autopilotCommand } from '../logic/autopilot';
import { LASER_RANGE, leadOffset } from '../logic/ballistics';
import { FLIGHT, stoppingDistance } from '../logic/flightModel';
import { travelTime } from '../logic/guidance';
import { PRICES } from '../logic/economy';
import { MISSILE_BLAST } from '../logic/shipDefense';
import { ATMOSPHERE } from '../logic/atmosphere';
import { RIVAL_LASER_DAMAGE, needsRefuel, rateContract, type RivalDefinition } from '../logic/rivals';
import { damping, orientationFromForward } from '../math/orientation';
import { EARTH_RADIUS } from '../scene/earth';
import type { Satellite } from '../satellites/satelliteFleet';
import { IDLE_INPUT, ShipController } from '../ship/shipController';
import { createShipModel, type ShipModel } from '../ship/shipModel';
import { RcsThrusters } from '../ship/rcsThrusters';
import { BOLT_SPEED, LaserCannon } from '../weapons/laserCannon';
import { MissileLauncher } from '../weapons/missileLauncher';
import type { ContractBook } from './contractBook';
import type { SatelliteWork } from './satelliteWork';
import { TowLine } from './towLine';
import type { Wallet } from '../logic/economy';
import type { SatelliteFleet } from '../satellites/satelliteFleet';

/** What a rival is doing; shown beside its marker. */
export type RivalTask =
  | { kind: 'hunt'; asteroid: Asteroid }
  | { kind: 'satellite'; jobId: number; satellite: Satellite }
  | { kind: 'refuel' }
  | { kind: 'idle' };

export interface RivalWorld {
  asteroids: readonly Asteroid[];
  contracts: ContractBook;
  work: SatelliteWork;
  fleet: SatelliteFleet;
  wallet: Wallet;
  /** Aegis, where rivals refuel; null once it is destroyed. */
  station: { position: THREE.Vector3; velocity: THREE.Vector3 } | null;
  /** The player's ship, so a rival does not race a pilot who is already there. */
  playerPosition: THREE.Vector3;
  /** False while the player's licence is under review: rivals then race for everything. */
  yieldToPlayer: boolean;
}

export type RivalSay = (line: 'hunt-big' | 'hunt' | 'satellite' | 'refuel' | 'beaten') => void;

/** Rivals turn more slowly than a pilot with a mouse. */
const TURN_RATE = 1.6;
/** Distance kept from a target rock: inside full laser range, outside its shrapnel. */
const HUNT_STAND_OFF = 12;
/** Missile shots are taken from beyond the blast. */
const MISSILE_STAND_OFF = MISSILE_BLAST.radius + 10;
/**
 * Goals are kept this far above the surface: clear of the atmosphere (top at
 * 2.4) but below the lowest satellites (about 8), which rivals must reach.
 */
const SAFE_ALTITUDE = 6;
const REFUEL_SECONDS = 6;

/**
 * One rival pilot: a ship with the same flight model, fuel and weapons as
 * the player's, flown by an autopilot that picks paid work from the board.
 */
export class RivalPilot {
  readonly model: ShipModel;
  readonly ship: ShipController;
  readonly laser: LaserCannon;
  readonly missiles = new MissileLauncher();
  readonly tow: TowLine;
  readonly rcs: RcsThrusters;
  task: RivalTask = { kind: 'idle' };
  private decisionTimer = 0;
  private refuelTimer = 0;
  private readonly lastDestination = new THREE.Vector3();
  private readonly destinationVelocity = new THREE.Vector3();
  private hasLastDestination = false;

  constructor(
    readonly definition: RivalDefinition,
    shipSource: THREE.Object3D,
    fleet: SatelliteFleet,
  ) {
    this.model = createShipModel(shipSource, undefined, new THREE.Color(...definition.tint));
    this.model.group.name = `rival-${definition.id}`;
    this.ship = new ShipController(this.model.group);
    this.laser = new LaserCannon(new THREE.Color(...definition.tint).multiplyScalar(6));
    this.laser.damageMultiplier = RIVAL_LASER_DAMAGE;
    this.tow = new TowLine(this.ship, fleet);
    this.rcs = new RcsThrusters(this.model.group, this.ship.velocity, this.model.bounds);
  }

  /** Starts the rival somewhere along a low orbit, already moving. */
  reset(start: THREE.Vector3, heading: THREE.Vector3): void {
    this.ship.reset(start, orientationFromForward(heading, start.clone().normalize()), 4);
    this.laser.reset();
    this.missiles.reset();
    this.tow.reset();
    this.rcs.reset();
    this.task = { kind: 'idle' };
    this.decisionTimer = Math.random() * this.definition.decisionSeconds;
    this.refuelTimer = 0;
    this.hasLastDestination = false;
  }

  update(deltaSeconds: number, world: RivalWorld, say: RivalSay): void {
    this.decisionTimer -= deltaSeconds;
    if (this.decisionTimer <= 0 || !this.taskStillValid(world)) {
      this.decide(world, say);
      this.decisionTimer = this.definition.decisionSeconds;
    }
    const goal = this.goal(world, deltaSeconds);
    let input = IDLE_INPUT;
    const altitude = this.ship.position.length() - EARTH_RADIUS;
    const sinkRate = -this.ship.velocity.dot(this.ship.position) / this.ship.position.length();
    const floor = ATMOSPHERE.top + 1.5;
    if (altitude < floor || (sinkRate > 0 && altitude - floor < stoppingDistance(sinkRate) + sinkRate * 0.6)) {
      // Too low or falling too fast: stop the fall, then climb out, before anything else.
      this.turnTowards(this.ship.position.clone().normalize(), deltaSeconds);
      input = { ...IDLE_INPUT, thrust: sinkRate > 0 ? 0 : 1, brake: sinkRate > 0 ? 1 : 0 };
    } else if (goal) {
      const command = autopilotCommand({
        offset: goal.point.clone().sub(this.ship.position).toArray(),
        shipVelocity: this.ship.velocity.toArray(),
        targetVelocity: goal.velocity.toArray(),
        forward: this.ship.forward().toArray(),
        standOff: goal.standOff,
      });
      const aim = goal.aimOverride ?? new THREE.Vector3(...command.aim);
      this.turnTowards(aim, deltaSeconds);
      input = { ...IDLE_INPUT, thrust: command.thrust, brake: command.brake, boost: command.boost };
      this.act(command.arrived, world, deltaSeconds);
    }
    this.ship.update(deltaSeconds, input);
    this.model.group.updateMatrixWorld();
    this.rcs.update(deltaSeconds);
    this.model.setThrottle(this.ship.throttle, this.ship.boosting);
    this.model.update(performance.now() / 1000);
  }

  /** A short description for the marker. */
  describe(): string {
    switch (this.task.kind) {
      case 'hunt':
        return `→ ${this.task.asteroid.size} ${this.task.asteroid.identified ? this.task.asteroid.material : 'rock'}`;
      case 'satellite':
        return this.tow.load ? '→ towing' : '→ satellite job';
      case 'refuel':
        return '→ Aegis, refuelling';
      default:
        return 'patrolling';
    }
  }

  private taskStillValid(world: RivalWorld): boolean {
    const task = this.task;
    if (task.kind === 'hunt') {
      return task.asteroid.alive && task.asteroid.timeToImpact !== null;
    }
    if (task.kind === 'satellite') {
      return task.satellite.alive && world.work.openJobs(this.definition.id).some((job) => job.id === task.jobId);
    }
    return true;
  }

  private decide(world: RivalWorld, say: RivalSay): void {
    const { ship, definition } = this;
    if (this.task.kind === 'refuel' && this.refuelTimer > 0) {
      return;
    }
    // A load on the line is finished before anything else, unless the tank is nearly dry.
    const desperate = ship.fuel < ship.fuelCapacity * 0.12;
    if (this.task.kind === 'satellite' && this.tow.load && this.taskStillValid(world) && !desperate) {
      return;
    }
    if (needsRefuel(ship.fuel, ship.fuelCapacity) && world.station) {
      if (this.task.kind !== 'refuel') {
        world.work.abandon(definition.id);
        this.task = { kind: 'refuel' };
        say('refuel');
      }
      return;
    }
    let best: RivalTask = { kind: 'idle' };
    let bestScore = 0;
    const speed = (FLIGHT.cruiseSpeed + FLIGHT.boostSpeed) / 2;
    for (const listing of world.contracts.listings(world.asteroids)) {
      const asteroid = listing.asteroid;
      const chaser = listing.chasedBy;
      if (chaser && chaser !== definition.id) {
        continue;
      }
      const distance = asteroid.mesh.position.distanceTo(ship.position);
      const playerDistance = asteroid.mesh.position.distanceTo(world.playerPosition);
      const score = rateContract(definition.style, {
        kind: 'asteroid',
        pay: listing.pay,
        travelSeconds: travelTime(distance - LASER_RANGE.optimal, 0, speed, FLIGHT.thrust * 1.5),
        deadlineSeconds: asteroid.timeToImpact ?? 0,
        bigGame: asteroid.size === 'large' || asteroid.size === 'giant' || asteroid.material === 'iron',
        someoneCloser: world.yieldToPlayer && playerDistance < distance * 0.35 && playerDistance < 40,
      });
      if (score > bestScore) {
        best = { kind: 'hunt', asteroid };
        bestScore = score;
      }
    }
    for (const job of world.work.openJobs(definition.id)) {
      const distance = job.satellite.position.distanceTo(ship.position);
      const score = rateContract(definition.style, {
        kind: 'satellite',
        pay: job.pay,
        travelSeconds: travelTime(distance, 0, speed, FLIGHT.thrust * 1.5),
        deadlineSeconds: job.deadline,
        bigGame: false,
        someoneCloser: world.yieldToPlayer && job.satellite.position.distanceTo(world.playerPosition) < Math.min(distance * 0.35, 20),
      });
      if (score > bestScore) {
        best = { kind: 'satellite', jobId: job.id, satellite: job.satellite };
        bestScore = score;
      }
    }
    const changed = best.kind !== this.task.kind || (best.kind === 'hunt' && this.task.kind === 'hunt' && best.asteroid !== this.task.asteroid);
    if (!changed) {
      return;
    }
    if (this.task.kind === 'satellite') {
      world.work.abandon(definition.id);
    }
    if (best.kind === 'satellite' && !world.work.claim(definition.id, best.jobId)) {
      best = { kind: 'idle' };
    }
    this.task = best;
    if (best.kind === 'hunt') {
      say(best.asteroid.size === 'large' || best.asteroid.size === 'giant' ? 'hunt-big' : 'hunt');
    } else if (best.kind === 'satellite') {
      say('satellite');
    }
    this.hasLastDestination = false;
  }

  private goal(world: RivalWorld, deltaSeconds: number): { point: THREE.Vector3; velocity: THREE.Vector3; standOff: number; aimOverride?: THREE.Vector3 } | null {
    const task = this.task;
    if (task.kind === 'hunt') {
      const asteroid = task.asteroid;
      const heavy = asteroid.material === 'iron' && this.missiles.ammunition > 0;
      const standOff = (heavy ? MISSILE_STAND_OFF : HUNT_STAND_OFF) + asteroid.radius;
      const distance = asteroid.mesh.position.distanceTo(this.ship.position);
      // Close in: point the guns at the lead point instead of the flight path.
      let aimOverride: THREE.Vector3 | undefined;
      if (distance < standOff + 10) {
        const lead = leadOffset(
          asteroid.mesh.position.clone().sub(this.ship.position).toArray(),
          asteroid.velocity.clone().sub(this.ship.velocity).toArray(),
          BOLT_SPEED,
        );
        aimOverride = lead ? new THREE.Vector3(...lead).normalize() : undefined;
      }
      return { point: this.safe(asteroid.mesh.position.clone()), velocity: asteroid.velocity.clone(), standOff, aimOverride };
    }
    if (task.kind === 'satellite') {
      if (!this.tow.load) {
        if (world.work.waitingInYard(task.jobId)) {
          return { point: this.safe(task.satellite.position.clone()), velocity: task.satellite.velocity.clone(), standOff: 10 };
        }
        return { point: this.safe(task.satellite.position.clone()), velocity: task.satellite.velocity.clone(), standOff: 2.5 };
      }
      const destination = world.work.destinationFor(task.jobId);
      return destination ? { point: this.safe(destination), velocity: this.trackVelocity(destination, deltaSeconds), standOff: 0 } : null;
    }
    if (task.kind === 'refuel' && world.station) {
      const berth = world.station.position.clone().add(world.station.position.clone().normalize().multiplyScalar(6));
      return { point: berth, velocity: world.station.velocity.clone(), standOff: 0 };
    }
    return null;
  }

  /** Fires, connects, releases or refuels, depending on the task. */
  private act(arrived: boolean, world: RivalWorld, deltaSeconds: number): void {
    const task = this.task;
    const group = this.model.group;
    if (task.kind === 'hunt') {
      const asteroid = task.asteroid;
      const offset = asteroid.mesh.position.clone().sub(this.ship.position);
      const distance = offset.length() - asteroid.radius;
      const aligned = this.ship.forward().angleTo(offset) < Math.atan2(asteroid.radius * 0.9, offset.length()) + 0.04;
      const inRange = distance < LASER_RANGE.optimal + 6;
      const resistsLaser = asteroid.material === 'iron';
      this.laser.tryFire(deltaSeconds, inRange && aligned && !resistsLaser, group, this.ship.velocity, this.model.gunPorts);
      if (this.missiles.ammunition > 0 && (resistsLaser || asteroid.size === 'giant') && distance > MISSILE_BLAST.radius + 3 && distance < 60) {
        if (this.missiles.updateLock(group, [asteroid]) === asteroid) {
          this.missiles.tryFire(group, this.ship.velocity);
        }
      }
      return;
    }
    this.laser.tryFire(deltaSeconds, false, group, this.ship.velocity, this.model.gunPorts);
    if (task.kind === 'satellite') {
      if (!this.tow.load && arrived && !world.work.waitingInYard(task.jobId)) {
        world.work.connect(this.definition.id, task.satellite);
      } else if (this.tow.load && world.work.canDrop(task.jobId) && world.work.wouldPlace(task.jobId)) {
        world.work.release(this.definition.id);
      }
      return;
    }
    if (task.kind === 'refuel' && arrived) {
      this.refuelTimer += deltaSeconds;
      if (this.refuelTimer >= REFUEL_SECONDS) {
        const fuel = this.ship.fuelCapacity - this.ship.fuel;
        const missiles = this.missiles.capacity - this.missiles.ammunition;
        world.wallet.spend(Math.min(world.wallet.balance, fuel * PRICES.fuelPerUnit + missiles * PRICES.missile));
        this.ship.fuel = this.ship.fuelCapacity;
        this.missiles.resupply(missiles);
        this.refuelTimer = 0;
        this.task = { kind: 'idle' };
      }
    }
  }

  /** Keeps a goal point out of the atmosphere. */
  private safe(point: THREE.Vector3): THREE.Vector3 {
    const minimum = EARTH_RADIUS + SAFE_ALTITUDE;
    return point.length() < minimum ? point.setLength(minimum) : point;
  }

  /** Destinations (yard cradle, orbit slot) move: estimate how fast. */
  private trackVelocity(destination: THREE.Vector3, deltaSeconds: number): THREE.Vector3 {
    if (this.hasLastDestination && deltaSeconds > 0) {
      const measured = destination.clone().sub(this.lastDestination).divideScalar(deltaSeconds);
      // Destinations jump when the job moves on to its next step: ignore those.
      if (measured.length() < 30) {
        this.destinationVelocity.lerp(measured, damping(3, deltaSeconds));
      }
    }
    this.lastDestination.copy(destination);
    this.hasLastDestination = true;
    return this.destinationVelocity.clone();
  }

  private turnTowards(aim: THREE.Vector3, deltaSeconds: number): void {
    const up = this.ship.position.clone().normalize();
    const target = orientationFromForward(aim.clone().normalize(), Math.abs(aim.dot(up)) > 0.98 ? this.ship.up() : up);
    const quaternion = this.ship.object.quaternion;
    const angle = quaternion.angleTo(target);
    if (angle > 1e-4) {
      quaternion.rotateTowards(target, Math.min(angle, TURN_RATE * deltaSeconds));
    }
  }
}
