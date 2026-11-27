import * as THREE from 'three';
import type { Asteroid, AsteroidField } from '../asteroids/asteroidField';
import type { SoundEffects } from '../audio/soundEffects';
import type { Hud } from '../hud/hud';
import { formatCredits } from '../logic/contracts';
import type { Wallet } from '../logic/economy';
import { randomUnitVector, type RandomSource } from '../logic/random';
import { dodgeApproach, satelliteJobPay, type SatelliteJobKind } from '../logic/satelliteJobs';
import { SATELLITE_JOB_PAY, YARD_REPAIR_SECONDS } from '../logic/stations';
import { TOW, isPlaced } from '../logic/towing';
import { formatCountdown, formatDistance } from '../logic/units';
import type { Satellite, SatelliteFleet } from '../satellites/satelliteFleet';
import type { ShipController } from '../ship/shipController';
import type { Outposts } from '../station/outposts';
import type { TowEvent, TowLine } from './towLine';

const KIND_LABEL: Record<Satellite['kind'], string> = { comms: 'COMMS SAT', nav: 'NAV SAT', weather: 'WEATHER SAT' };
/** Seconds between posting a dodge threat and the asteroid reaching the satellite. */
const DODGE_WARNING_SECONDS = 45;
const DODGE_SPEED = 4.2;
/** The asteroid counts as gone once it is this far past the satellite. */
const DODGE_CLEAR_DISTANCE = 14;

interface Job {
  id: number;
  kind: SatelliteJobKind;
  satellite: Satellite;
  pay: number;
  /** Dodge: the asteroid on a collision course with the satellite. */
  asteroid: Asteroid | null;
  /** Repair tow: the yard has finished with it. */
  repaired: boolean;
  /** Dodge: the asteroid has gone by. */
  clear: boolean;
}

export interface JobRow {
  title: string;
  detail: string;
  pay: number;
  urgent: boolean;
}

export interface Waypoint {
  world: THREE.Vector3;
  label: string;
}

export interface SatelliteWorkDependencies {
  fleet: SatelliteFleet;
  tow: TowLine;
  outposts: Outposts;
  ship: ShipController;
  field: AsteroidField;
  wallet: Wallet;
  hud: Hud;
  sound: SoundEffects;
  rng: RandomSource;
}

/**
 * Satellite contracts: moving a satellite out of an asteroid's path and back
 * (dodge), and towing a broken one to Vulcan Yard, leaving it, then
 * collecting it and putting it back in its orbit slot (repair tow). The
 * yard works on one satellite at a time while the pilot does other work.
 */
export class SatelliteWork {
  private jobs: Job[] = [];
  private nextId = 1;
  /** Satellite in the yard's cradle and seconds of repair left. */
  private inYard: Satellite | null = null;
  private repairLeft = 0;

  constructor(private readonly deps: SatelliteWorkDependencies) {}

  reset(): void {
    this.jobs = [];
    this.inYard = null;
    this.repairLeft = 0;
    this.deps.tow.reset();
  }

  get yardBusy(): boolean {
    return this.inYard !== null || this.jobs.some((job) => job.kind === 'repair-tow');
  }

  /** A satellite develops a fault and its operator posts a repair tow. */
  postRepairTow(): boolean {
    const satellite = this.pickSatellite();
    if (!satellite || this.yardBusy) {
      return false;
    }
    this.deps.fleet.breakDown(satellite);
    this.jobs.push({ id: this.nextId++, kind: 'repair-tow', satellite, pay: SATELLITE_JOB_PAY.repairTow, asteroid: null, repaired: false, clear: false });
    this.deps.hud.showMessage(
      `${KIND_LABEL[satellite.kind]} has a fault. Contract: tow it to Vulcan Yard for repair (${formatCredits(SATELLITE_JOB_PAY.repairTow)})`,
      'info',
      5,
    );
    this.deps.sound.chime();
    return true;
  }

  /** An asteroid that will miss the planet but strike a satellite: its operator wants it moved. */
  postDodge(): boolean {
    const satellite = this.pickSatellite();
    if (!satellite) {
      return false;
    }
    const target = this.deps.fleet.slot(satellite, DODGE_WARNING_SECONDS).position;
    const path = dodgeApproach(target.toArray(), randomUnitVector(this.deps.rng), DODGE_SPEED, DODGE_WARNING_SECONDS);
    const size = this.deps.rng() < 0.5 ? 'large' : 'medium';
    const asteroid = this.deps.field.spawnFragment(size, 'iron', new THREE.Vector3(...path.position), new THREE.Vector3(...path.velocity));
    asteroid.passerBy = true;
    this.jobs.push({ id: this.nextId++, kind: 'dodge', satellite, pay: SATELLITE_JOB_PAY.dodge, asteroid, repaired: false, clear: false });
    this.deps.hud.showMessage(
      `Iron asteroid on course for ${KIND_LABEL[satellite.kind]}. Contract: tow it clear, or destroy the rock (${formatCredits(SATELLITE_JOB_PAY.dodge)})`,
      'warning',
      5,
    );
    this.deps.sound.alarm();
    return true;
  }

  /** T: connect to the nearest contract satellite, or let go. */
  toggleTow(): void {
    const { tow, hud, ship } = this.deps;
    if (tow.load) {
      this.handle(tow.release());
      return;
    }
    let nearest: Job | null = null;
    let nearestDistance = Infinity;
    for (const job of this.jobs) {
      const distance = job.satellite.position.distanceTo(ship.position);
      if (job.satellite.alive && distance < nearestDistance && !(job.satellite.mode === 'yard' && !job.repaired)) {
        nearest = job;
        nearestDistance = distance;
      }
    }
    if (!nearest || nearestDistance > TOW.attachRange + 6) {
      hud.showMessage('Nothing to tow here. Fly to a satellite on the contract board', 'info', 2.5);
      return;
    }
    if (nearest.satellite.mode === 'yard') {
      this.inYard = null;
    }
    this.handle(tow.attach(nearest.satellite));
  }

  update(deltaSeconds: number): void {
    this.handle(this.deps.tow.update(deltaSeconds));
    if (this.inYard && this.repairLeft > 0) {
      this.repairLeft -= deltaSeconds;
      if (this.repairLeft <= 0) {
        this.deps.fleet.repair(this.inYard);
        const job = this.jobFor(this.inYard);
        if (job) {
          job.repaired = true;
        }
        this.deps.hud.showMessage(`Vulcan Yard: ${KIND_LABEL[this.inYard.kind]} repaired. Collect it and return it to its orbit`, 'success', 5);
        this.deps.sound.chime();
      }
    }
    for (const job of [...this.jobs]) {
      if (!job.satellite.alive) {
        this.fail(job, `${KIND_LABEL[job.satellite.kind]} was destroyed. Contract lost`);
        continue;
      }
      if (job.kind === 'dodge' && !job.clear && job.asteroid && this.asteroidGone(job.asteroid, job.satellite)) {
        job.clear = true;
        if (job.satellite.mode === 'orbit') {
          this.complete(job, null);
        } else {
          this.deps.hud.showMessage('The rock has passed. Put the satellite back in its orbit slot', 'success', 3.5);
        }
      }
    }
  }

  /** Rows for the contract board, above the defence contracts. */
  rows(): JobRow[] {
    const rows = this.jobs.map((job) => ({ title: this.title(job), detail: this.stepText(job), pay: job.pay, urgent: job.kind === 'dodge' && !job.clear }));
    // Threatened satellites first: they have a deadline.
    return rows.sort((a, b) => Number(b.urgent) - Number(a.urgent));
  }

  /** Where the current job wants the ship to go next. */
  waypoint(): Waypoint | null {
    const job = this.activeJob();
    if (!job) {
      return null;
    }
    const target = this.destination(job);
    return target ? { world: target.world, label: target.label } : null;
  }

  /** The tow status for the control line, or null when not towing. */
  towStatus(): string | null {
    const load = this.deps.tow.load;
    return load ? `TOWING ${KIND_LABEL[load.kind]} ${Math.round(load.condition)}% · T LETS GO` : null;
  }

  /** Ignored by the ship's collision test while on the line. */
  get towed(): Satellite | null {
    return this.deps.tow.load;
  }

  private handle(event: TowEvent | null): void {
    if (!event) {
      return;
    }
    const { hud, sound } = this.deps;
    const name = KIND_LABEL[event.satellite.kind];
    if (event.type === 'out-of-reach') {
      const tooFar = event.surfaceDistance > TOW.attachRange;
      hud.showMessage(
        tooFar ? `Get within ${formatDistance(TOW.attachRange)} of the ${name} to connect` : `Match its speed to connect: brake (S) until the gap stops closing`,
        'warning',
        2.5,
      );
      return;
    }
    if (event.type === 'attached') {
      hud.showMessage(`Tow line connected to ${name}. Heavier now: brake early`, 'success', 3);
      sound.dockClamp();
      return;
    }
    if (event.type === 'snapped' || event.type === 'wrecked') {
      hud.showMessage(event.type === 'snapped' ? 'Tow line snapped: you pulled too hard' : `${name} broke apart under the strain`, 'danger', 3);
      if (event.type === 'wrecked') {
        this.deps.fleet.destroy(event.satellite);
      }
      return;
    }
    sound.dockClamp();
    this.placeReleased(event.satellite);
  }

  /** Released: in the yard cradle, in its orbit slot, or left drifting. */
  private placeReleased(satellite: Satellite): void {
    const { outposts, fleet, hud } = this.deps;
    const job = this.jobFor(satellite);
    if (!job) {
      return;
    }
    const yard = outposts.get('vulcan');
    const cradle = outposts.portPosition('vulcan');
    if (job.kind === 'repair-tow' && !job.repaired && isPlaced(satellite.position.distanceTo(cradle), satellite.velocity.distanceTo(yard.velocity))) {
      fleet.stow(satellite, yard.port);
      this.inYard = satellite;
      this.repairLeft = YARD_REPAIR_SECONDS;
      hud.showMessage(`Left at Vulcan Yard. Repair takes ${formatCountdown(YARD_REPAIR_SECONDS)}: carry on working, you will be called`, 'success', 4.5);
      return;
    }
    const slot = fleet.slot(satellite);
    const offset = satellite.position.distanceTo(slot.position);
    const ready = job.kind === 'repair-tow' ? job.repaired : job.clear;
    if (ready && isPlaced(offset, satellite.velocity.distanceTo(slot.velocity))) {
      fleet.returnToOrbit(satellite);
      this.complete(job, offset);
      return;
    }
    hud.showMessage(`${KIND_LABEL[satellite.kind]} released. It drifts until you connect again (T)`, 'info', 3);
  }

  private complete(job: Job, offsetFromSlot: number | null): void {
    const paid = satelliteJobPay(job.pay, offsetFromSlot);
    this.deps.wallet.earn(paid);
    this.jobs = this.jobs.filter((candidate) => candidate !== job);
    const precision = offsetFromSlot === null ? '' : ` Placed within ${formatDistance(offsetFromSlot)}.`;
    this.deps.hud.showMessage(`${this.title(job)} complete: ${formatCredits(paid)} paid.${precision}`, 'success', 4.5);
    this.deps.sound.killConfirm();
  }

  private fail(job: Job, message: string): void {
    this.jobs = this.jobs.filter((candidate) => candidate !== job);
    if (this.inYard === job.satellite) {
      this.inYard = null;
    }
    this.deps.hud.showMessage(message, 'danger', 4);
  }

  private asteroidGone(asteroid: Asteroid, satellite: Satellite): boolean {
    if (!asteroid.alive) {
      return true;
    }
    const offset = satellite.position.clone().sub(asteroid.mesh.position);
    const closing = asteroid.velocity.clone().sub(satellite.velocity).dot(offset) > 0;
    return !closing && offset.length() > DODGE_CLEAR_DISTANCE;
  }

  private pickSatellite(): Satellite | null {
    const free = this.deps.fleet.satellites.filter(
      (satellite) => satellite.alive && satellite.mode === 'orbit' && !satellite.broken && !this.jobFor(satellite),
    );
    return free.length > 0 ? free[Math.floor(this.deps.rng() * free.length)] : null;
  }

  private jobFor(satellite: Satellite): Job | undefined {
    return this.jobs.find((job) => job.satellite === satellite);
  }

  /** The job the pilot is working: the one on the line, else the most urgent. */
  private activeJob(): Job | null {
    const load = this.deps.tow.load;
    return (load && this.jobFor(load)) || this.jobs.find((job) => job.kind === 'dodge' && !job.clear) || this.jobs[0] || null;
  }

  private destination(job: Job): Waypoint | null {
    const { satellite } = job;
    const onLine = this.deps.tow.load === satellite;
    const name = KIND_LABEL[satellite.kind];
    if (job.kind === 'repair-tow') {
      if (satellite.mode === 'yard') {
        return job.repaired ? { world: satellite.position.clone(), label: `COLLECT ${name}` } : { world: satellite.position.clone(), label: `REPAIRING ${formatCountdown(this.repairLeft)}` };
      }
      if (!onLine) {
        return { world: satellite.position.clone(), label: `CONNECT TO ${name} (T)` };
      }
      return job.repaired
        ? { world: this.deps.fleet.slot(satellite).position, label: 'ORBIT SLOT: RELEASE HERE (T)' }
        : { world: this.deps.outposts.portPosition('vulcan'), label: 'VULCAN YARD CRADLE: RELEASE HERE (T)' };
    }
    if (!job.clear) {
      return onLine ? null : { world: satellite.position.clone(), label: `CONNECT TO ${name} (T)` };
    }
    return onLine
      ? { world: this.deps.fleet.slot(satellite).position, label: 'ORBIT SLOT: RELEASE HERE (T)' }
      : { world: satellite.position.clone(), label: `CONNECT TO ${name} (T)` };
  }

  private title(job: Job): string {
    const name = KIND_LABEL[job.satellite.kind];
    return job.kind === 'dodge' ? `Move ${name} clear` : `Repair tow: ${name}`;
  }

  private stepText(job: Job): string {
    if (job.kind === 'dodge' && !job.clear && job.asteroid) {
      const seconds = this.secondsToStrike(job.asteroid, job.satellite);
      return `Iron rock strikes in ${seconds === null ? '—' : formatCountdown(seconds)} · tow it clear or destroy the rock`;
    }
    return this.destination(job)?.label.toLowerCase().replace(/\(t\)/g, '(T)') ?? '';
  }

  private secondsToStrike(asteroid: Asteroid, satellite: Satellite): number | null {
    const offset = satellite.position.clone().sub(asteroid.mesh.position);
    const closing = asteroid.velocity.clone().sub(satellite.velocity).dot(offset.clone().normalize());
    return closing > 0 ? offset.length() / closing : null;
  }
}
