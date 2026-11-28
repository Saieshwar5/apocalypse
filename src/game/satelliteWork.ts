import * as THREE from 'three';
import type { Asteroid, AsteroidField } from '../asteroids/asteroidField';
import type { SoundEffects } from '../audio/soundEffects';
import type { Hud } from '../hud/hud';
import { formatCredits } from '../logic/contracts';
import type { Wallet } from '../logic/economy';
import type { GameEvents } from './gameEvents';
import { pilotName, type PilotId } from '../logic/rivals';
import { randomUnitVector, type RandomSource } from '../logic/random';
import { dodgeApproach, satelliteJobPay, type SatelliteJobKind } from '../logic/satelliteJobs';
import { SATELLITE_JOB_PAY, YARD_REPAIR_SECONDS } from '../logic/stations';
import { YARD_PARTS } from '../logic/stationEconomy';
import { REBOOST_PAY, secondsUntilBurn } from '../logic/spaceWeather';
import { TOW, isPlaced } from '../logic/towing';
import { formatCountdown, formatDistance } from '../logic/units';
import type { Satellite, SatelliteFleet } from '../satellites/satelliteFleet';
import type { ShipController } from '../ship/shipController';
import type { Outposts } from '../station/outposts';
import type { TowEvent, TowLine } from './towLine';
import { JOB_FOR, KIND_LABEL, announceTowEvent, jobScore, asteroidGone, escapePoint, secondsToStrike, type JobRow, type OpenJob, type Waypoint } from './satelliteJobHelpers';

export type { JobRow, OpenJob, Waypoint };

/** Seconds between posting a dodge threat and the asteroid reaching the satellite. */
const DODGE_WARNING_SECONDS = 45;
const DODGE_SPEED = 4.2;

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
  /** The pilot who has taken the job; others cannot tow this satellite. */
  claimedBy: PilotId | null;
  /** Play clock when it was posted. */
  postedAt: number;
}

export interface SatelliteWorkDependencies {
  fleet: SatelliteFleet;
  /** The player's tow line; rivals register theirs. */
  tow: TowLine;
  outposts: Outposts;
  ship: ShipController;
  field: AsteroidField;
  walletOf: (pilot: PilotId) => Wallet;
  events: GameEvents;
  hud: Hud;
  sound: SoundEffects;
  rng: RandomSource;
  /** Takes parts for a repair from Vulcan's store; false when it has none (the repair is then slower). */
  useYardParts?: () => boolean;
  /** Seconds of play, for grading the work. */
  clock?: () => number;
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
  private readonly tows = new Map<PilotId, TowLine>();
  /** Satellite jobs finished per pilot, for the league table. */
  readonly completed: Partial<Record<PilotId, number>> = {};

  constructor(private readonly deps: SatelliteWorkDependencies) {
    this.tows.set('player', deps.tow);
  }

  /** A rival's tow line, so the work can run it and pay its owner. */
  register(pilot: PilotId, tow: TowLine): void {
    this.tows.set(pilot, tow);
  }

  reset(): void {
    this.jobs = [];
    this.inYard = null;
    this.repairLeft = 0;
    for (const tow of this.tows.values()) {
      tow.reset();
    }
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
    this.addJob('repair-tow', satellite, SATELLITE_JOB_PAY.repairTow, null, `has a fault. Contract: tow it to Vulcan Yard for repair`);
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
    this.addJob('dodge', satellite, SATELLITE_JOB_PAY.dodge, asteroid, 'is in an iron rock\'s path. Contract: tow it clear, or destroy the rock');
    return true;
  }

  /** T: connect to the nearest contract satellite, or let go. */
  toggleTow(): void {
    const { tow, hud, ship } = this.deps;
    if (tow.load) {
      this.handle(tow.release(), 'player');
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
    if (nearest.claimedBy && nearest.claimedBy !== 'player') {
      hud.showMessage(`${pilotName(nearest.claimedBy)} has claimed that job`, 'warning', 2.5);
      return;
    }
    this.connect('player', nearest.satellite);
  }

  /** Jobs a pilot could take: unclaimed, or already theirs. */
  openJobs(pilot: PilotId): OpenJob[] {
    return this.jobs
      .filter((job) => job.satellite.alive && (job.claimedBy === null || job.claimedBy === pilot))
      .map((job) => ({
        id: job.id,
        satellite: job.satellite,
        pay: job.pay,
        claimedBy: job.claimedBy,
        deadline: job.kind === 'dodge' && !job.clear && job.asteroid ? (secondsToStrike(job.asteroid, job.satellite) ?? Infinity) : Infinity,
      }));
  }

  /** Reserves a job for a pilot. Returns false if someone else has it. */
  claim(pilot: PilotId, jobId: number): boolean {
    const job = this.jobs.find((candidate) => candidate.id === jobId);
    if (!job || (job.claimedBy !== null && job.claimedBy !== pilot)) {
      return false;
    }
    job.claimedBy = pilot;
    return true;
  }

  /** Gives up every job a pilot holds, letting go of any load. */
  abandon(pilot: PilotId): void {
    const tow = this.tows.get(pilot);
    if (tow?.load) {
      this.handle(tow.release(), pilot);
    }
    for (const job of this.jobs) {
      if (job.claimedBy === pilot) {
        job.claimedBy = null;
      }
    }
  }

  /** Connects a pilot's tow line to a job's satellite. */
  connect(pilot: PilotId, satellite: Satellite): boolean {
    const tow = this.tows.get(pilot);
    const job = this.jobFor(satellite);
    if (!tow || !job || (job.claimedBy !== null && job.claimedBy !== pilot)) {
      return false;
    }
    const wasInYard = satellite.mode === 'yard';
    const event = tow.attach(satellite);
    if (event.type === 'attached') {
      job.claimedBy = pilot;
      if (wasInYard) {
        this.inYard = null;
      }
    }
    this.handle(event, pilot);
    return event.type === 'attached';
  }

  /** Lets go of a pilot's load where it is. */
  release(pilot: PilotId): void {
    const tow = this.tows.get(pilot);
    if (tow?.load) {
      this.handle(tow.release(), pilot);
    }
  }

  /** Where a pilot should take the satellite on its line, or fetch it from. */
  destinationFor(jobId: number): THREE.Vector3 | null {
    const job = this.jobs.find((candidate) => candidate.id === jobId);
    if (!job) {
      return null;
    }
    if (job.kind === 'dodge' && !job.clear && job.asteroid && this.onAnyLine(job.satellite)) {
      return escapePoint(job.satellite, job.asteroid);
    }
    return this.destination(job)?.world ?? null;
  }

  /** False while a dodge is still under way: the load must be held clear, not dropped. */
  canDrop(jobId: number): boolean {
    const job = this.jobs.find((candidate) => candidate.id === jobId);
    return job !== undefined && (job.kind === 'repair-tow' || job.clear);
  }

  /** True while the yard has the satellite and it is not ready. */
  waitingInYard(jobId: number): boolean {
    const job = this.jobs.find((candidate) => candidate.id === jobId);
    return job !== undefined && job.satellite.mode === 'yard' && !job.repaired;
  }

  update(deltaSeconds: number): void {
    for (const [pilot, tow] of this.tows) {
      this.handle(tow.update(deltaSeconds), pilot);
    }
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
      if (job.kind === 'dodge' && !job.clear && job.asteroid && asteroidGone(job.asteroid, job.satellite)) {
        job.clear = true;
        if (job.satellite.mode === 'orbit') {
          this.complete(job, null, job.claimedBy ?? 'player');
        } else {
          if (job.claimedBy === 'player') {
            this.deps.hud.showMessage('The rock has passed. Put the satellite back in its orbit slot', 'success', 3.5);
          }
        }
      }
    }
  }

  /** Rows for the contract board, above the defence contracts. */
  rows(): JobRow[] {
    const rows = this.jobs.map((job) => {
      const rival = job.claimedBy !== null && job.claimedBy !== 'player';
      return {
        title: rival ? `${this.title(job)} · ${pilotName(job.claimedBy ?? 'player')}` : this.title(job),
        detail: rival ? `claimed by ${pilotName(job.claimedBy ?? 'player')}` : this.stepText(job),
        pay: job.pay,
        urgent: !rival && ((job.kind === 'dodge' && !job.clear) || (job.kind === 'reboost' && job.satellite.mode === 'orbit')),
      };
    });
    // Threatened satellites first: they have a deadline.
    return rows.sort((a, b) => Number(b.urgent) - Number(a.urgent));
  }

  /** Where the player's current job wants the ship to go next. */
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

  private handle(event: TowEvent | null, pilot: PilotId): void {
    if (!event) {
      return;
    }
    if (pilot !== 'player') {
      this.handleRival(event, pilot);
      return;
    }
    if (announceTowEvent(event, this.deps.hud, this.deps.sound, this.deps.fleet)) {
      this.placeReleased(event.satellite, pilot);
    }
  }

  /** Rivals' tow events: no prompts for them, only the outcome. */
  private handleRival(event: TowEvent, pilot: PilotId): void {
    if (event.type === 'wrecked') {
      this.deps.fleet.destroy(event.satellite);
      this.deps.hud.showMessage(`${pilotName(pilot)} broke the ${KIND_LABEL[event.satellite.kind]} apart`, 'warning', 3);
    } else if (event.type === 'released') {
      this.placeReleased(event.satellite, pilot);
    }
  }

  /** Released: in the yard cradle, in its orbit slot, or left drifting. */
  /** Where letting go of this satellite now would leave it: the cradle, its slot, or adrift. */
  private dropResult(satellite: Satellite): 'yard' | 'slot' | 'adrift' {
    const job = this.jobFor(satellite);
    if (!job) {
      return 'adrift';
    }
    const yard = this.deps.outposts.get('vulcan');
    const cradle = this.deps.outposts.portPosition('vulcan');
    if (job.kind === 'repair-tow' && !job.repaired && isPlaced(satellite.position.distanceTo(cradle), satellite.velocity.distanceTo(yard.velocity))) {
      return 'yard';
    }
    const slot = this.deps.fleet.slot(satellite);
    const ready = job.kind === 'repair-tow' ? job.repaired : job.clear;
    return ready && isPlaced(satellite.position.distanceTo(slot.position), satellite.velocity.distanceTo(slot.velocity)) ? 'slot' : 'adrift';
  }

  /** True when letting go now would leave the job's satellite in the cradle or its slot. */
  wouldPlace(jobId: number): boolean {
    const job = this.jobs.find((candidate) => candidate.id === jobId);
    return job !== undefined && this.dropResult(job.satellite) !== 'adrift';
  }

  private placeReleased(satellite: Satellite, pilot: PilotId): void {
    const { outposts, fleet, hud } = this.deps;
    const player = pilot === 'player';
    const job = this.jobFor(satellite);
    if (!job) {
      return;
    }
    const result = this.dropResult(satellite);
    if (result === 'yard') {
      const yard = outposts.get('vulcan');
      fleet.stow(satellite, yard.port);
      this.inYard = satellite;
      const parts = this.deps.useYardParts?.() ?? true;
      this.repairLeft = YARD_REPAIR_SECONDS * (parts ? 1 : YARD_PARTS.slowdownWithout);
      if (player) {
        const slow = parts ? '' : ' The yard is out of parts, so it will be slow.';
        hud.showMessage(`Left at Vulcan Yard. Repair takes ${formatCountdown(this.repairLeft)}: carry on working, you will be called.${slow}`, 'success', 4.5);
      }
      return;
    }
    if (result === 'slot') {
      const offset = satellite.position.distanceTo(fleet.slot(satellite).position);
      fleet.returnToOrbit(satellite);
      this.complete(job, offset, pilot);
      return;
    }
    if (!player) {
      return;
    }
    hud.showMessage(`${KIND_LABEL[satellite.kind]} released. It drifts until you connect again (T)`, 'info', 3);
  }

  private complete(job: Job, offsetFromSlot: number | null, pilot: PilotId): void {
    const paid = satelliteJobPay(job.pay, offsetFromSlot);
    this.deps.walletOf(pilot).earn(paid);
    this.jobs = this.jobs.filter((candidate) => candidate !== job);
    this.completed[pilot] = (this.completed[pilot] ?? 0) + 1;
    if (pilot === 'player') {
      this.deps.events.emit({ type: 'satellite-job-completed', job: JOB_FOR[job.kind], score: jobScore(job.kind, (this.deps.clock?.() ?? 0) - job.postedAt, offsetFromSlot), pay: paid });
    } else {
      this.deps.hud.showMessage(`${pilotName(pilot)} finished the ${this.title(job).toLowerCase()} (${formatCredits(paid)})`, 'info', 3.5);
      return;
    }
    const precision = offsetFromSlot === null ? '' : ` Placed within ${formatDistance(offsetFromSlot)}.`;
    this.deps.hud.showMessage(`${this.title(job)} complete: ${formatCredits(paid)} paid.${precision}`, 'success', 4.5);
    this.deps.sound.killConfirm();
  }

  private fail(job: Job, message: string): void {
    if (job.claimedBy === 'player') {
      this.deps.events.emit({ type: 'satellite-job-failed' });
    }
    this.jobs = this.jobs.filter((candidate) => candidate !== job);
    if (this.inYard === job.satellite) {
      this.inYard = null;
    }
    this.deps.hud.showMessage(message, 'danger', 4);
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

  /** The job the player is working: the one on the line, else the most urgent they can take. */
  private activeJob(): Job | null {
    const load = this.deps.tow.load;
    const available = this.jobs.filter((job) => job.claimedBy === null || job.claimedBy === 'player');
    return (load && this.jobFor(load)) || available.find((job) => job.kind === 'dodge' && !job.clear) || available[0] || null;
  }

  private onAnyLine(satellite: Satellite): boolean {
    return [...this.tows.values()].some((tow) => tow.load === satellite);
  }

  private destination(job: Job): Waypoint | null {
    const { satellite } = job;
    const onLine = this.onAnyLine(satellite);
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

  /** A satellite sinking after a storm: tow it back up to its orbit slot before it burns up. */
  postReboost(satellite: Satellite): boolean {
    if (!satellite.alive || this.jobFor(satellite)) {
      return false;
    }
    this.addJob('reboost', satellite, REBOOST_PAY, null, 'is sinking into the swollen atmosphere. Contract: tow it back up to its orbit slot');
    return true;
  }

  private addJob(kind: SatelliteJobKind, satellite: Satellite, pay: number, asteroid: Asteroid | null, what: string): void {
    // A reboost is ready to place from the start: there is no rock to wait for.
    this.jobs.push({ id: this.nextId++, kind, satellite, pay, asteroid, repaired: false, clear: kind === 'reboost', claimedBy: null, postedAt: this.deps.clock?.() ?? 0 });
    this.deps.hud.showMessage(`${KIND_LABEL[satellite.kind]} ${what} (${formatCredits(pay)})`, kind === 'repair-tow' ? 'info' : 'warning', 5);
    if (kind === 'dodge') {
      this.deps.sound.alarm();
    } else {
      this.deps.sound.chime();
    }
  }

  private title(job: Job): string {
    const name = KIND_LABEL[job.satellite.kind];
    return job.kind === 'dodge' ? `Move ${name} clear` : job.kind === 'reboost' ? `Reboost ${name}` : `Repair tow: ${name}`;
  }

  private stepText(job: Job): string {
    if (job.kind === 'dodge' && !job.clear && job.asteroid) {
      const seconds = secondsToStrike(job.asteroid, job.satellite);
      return `Iron rock strikes in ${seconds === null ? '—' : formatCountdown(seconds)} · tow it clear or destroy the rock`;
    }
    const sinking = job.kind === 'reboost' && job.satellite.mode === 'orbit' && job.satellite.sinkRate > 0;
    const burn = sinking ? ` · burns up in ${formatCountdown(secondsUntilBurn(this.deps.fleet.currentRadius(job.satellite), this.deps.fleet.burnRadius))}` : '';
    return (this.destination(job)?.label.toLowerCase().replace(/\(t\)/g, '(T)') ?? '') + burn;
  }


}
