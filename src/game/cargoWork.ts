import * as THREE from 'three';
import type { SoundEffects } from '../audio/soundEffects';
import type { Hud } from '../hud/hud';
import { CARGO, CARGO_GOOD_NAME, CARGO_KIND_NAME, cargoParSeconds, cargoPay, planCargo, type CargoKind, type CargoPlan } from '../logic/cargo';
import type { SpeakerId } from '../logic/cast';
import { formatCredits } from '../logic/contracts';
import type { Wallet } from '../logic/economy';
import { passengerScore, timeScore } from '../logic/medals';
import type { RandomSource } from '../logic/random';
import type { Stock } from '../logic/stationEconomy';
import { STATIONS, type StationId } from '../logic/stations';
import { formatCountdown } from '../logic/units';
import type { ShipController } from '../ship/shipController';
import type { GameEvents } from './gameEvents';
import type { GameSession } from './gameSession';
import type { RadioNet } from './radioNet';
import type { JobRow, Waypoint } from './satelliteJobHelpers';

export interface CargoWorkDependencies {
  session: GameSession;
  ship: ShipController;
  /** True while the ship is berthed or docked at the station. */
  at: (station: StationId) => boolean;
  /** The station's port now, or null if the station is gone. */
  portOf: (station: StationId) => THREE.Vector3 | null;
  stocks: () => Record<StationId, Stock>;
  /** Adds (or with a negative amount, takes) stock; returns the change made. */
  addStock: (station: StationId, good: 'fuel' | 'parts', amount: number) => number;
  /** Kinds of transfer the pilot's rank allows. */
  kinds: () => CargoKind[];
  wallet: Wallet;
  events: GameEvents;
  hud: Hud;
  sound: SoundEffects;
  radio: RadioNet;
  rng: RandomSource;
}

interface Contract extends CargoPlan {
  distance: number;
  aboard: boolean;
  loadedAt: number;
  /** Seconds left on an urgent load, counted from loading. */
  timeLeft: number;
  knocks: number;
}

const SPEAKER: Record<StationId, SpeakerId> = { aegis: 'control', vulcan: 'vulcan', ceres: 'ceres', halo: 'halo' };

function nameOf(station: StationId): string {
  return STATIONS[station].name
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/**
 * Transfers between stations: berth where the load waits and it comes
 * aboard; berth where it is wanted and it is paid. One load at a time. A
 * full hold makes the ship heavier; fuel and parts really leave one store
 * and arrive in the other. Passengers are people: losing the ship with them
 * aboard is answered for on the licence.
 */
export class CargoWork {
  private contract: Contract | null = null;
  private lastHull = 100;
  private wasBoosting = false;

  constructor(private readonly deps: CargoWorkDependencies) {}

  reset(): void {
    this.contract = null;
    this.setMass(0);
  }

  get active(): boolean {
    return this.contract !== null;
  }

  /** People are aboard: the trip must be finished. */
  get passengersAboard(): boolean {
    return this.contract?.aboard === true && this.contract.kind === 'passengers';
  }

  /** A station offers a transfer, if one is worth making and the hold is free. */
  post(): boolean {
    if (this.contract) {
      return false;
    }
    const { rng, hud, radio, sound } = this.deps;
    const stations = (Object.keys(STATIONS) as StationId[]).filter((station) => this.deps.portOf(station) !== null);
    const plan = planCargo(this.deps.stocks(), stations, this.deps.kinds(), rng);
    const from = plan && this.deps.portOf(plan.from);
    const to = plan && this.deps.portOf(plan.to);
    if (!plan || !from || !to) {
      return false;
    }
    this.contract = { ...plan, distance: from.distanceTo(to), aboard: false, loadedAt: 0, timeLeft: 0, knocks: 0 };
    const what = this.what(this.contract);
    const pay = formatCredits(this.payNow(this.contract));
    radio.say(SPEAKER[plan.from], `${nameOf(plan.from)} here. ${what[0].toUpperCase()}${what.slice(1)} for ${nameOf(plan.to)}, waiting at our port.`);
    hud.showMessage(`${CARGO_KIND_NAME[plan.kind]}: ${what} from ${nameOf(plan.from)} to ${nameOf(plan.to)} (${pay})`, 'info', 5);
    sound.chime();
    return true;
  }

  update(deltaSeconds: number, shipActive: boolean): void {
    const contract = this.contract;
    if (!contract) {
      return;
    }
    const { ship, hud, events, radio } = this.deps;
    if (!this.deps.portOf(contract.from) || !this.deps.portOf(contract.to)) {
      this.end('The station is gone. Transfer cancelled', 'warning');
      return;
    }
    if (!contract.aboard) {
      if (this.deps.at(contract.from)) {
        this.load(contract);
      }
      this.lastHull = ship.hull;
      return;
    }
    if (!shipActive) {
      if (contract.kind === 'passengers') {
        events.emit({ type: 'crew-lost' });
        radio.say('halo', 'We have lost the passengers. Your licence will answer for this.', true);
      } else {
        events.emit({ type: 'satellite-job-failed' });
      }
      this.end('The load went down with the ship', 'danger');
      return;
    }
    this.feelTheRide(contract);
    if (contract.kind === 'urgent' && contract.timeLeft > 0) {
      contract.timeLeft -= deltaSeconds;
      if (contract.timeLeft <= 0) {
        hud.showMessage(`Urgent cargo is late: ${nameOf(contract.to)} will pay half`, 'warning', 3.5);
      }
    }
    if (this.deps.at(contract.to)) {
      this.deliver(contract);
    }
  }

  rows(): JobRow[] {
    const contract = this.contract;
    if (!contract) {
      return [];
    }
    const title = `${CARGO_KIND_NAME[contract.kind]}: ${nameOf(contract.from)} → ${nameOf(contract.to)}`;
    let detail = `berth at ${nameOf(contract.from)} to load ${this.what(contract)}`;
    if (contract.aboard) {
      const clock = contract.kind === 'urgent' ? (contract.timeLeft > 0 ? ` · ${formatCountdown(contract.timeLeft)} left` : ' · late') : '';
      const care = contract.kind === 'fragile' ? ' · avoid knocks' : contract.kind === 'passengers' ? ' · no boost, no knocks' : '';
      detail = `aboard: berth at ${nameOf(contract.to)}${clock}${care}`;
    }
    return [{ title, detail, pay: this.payNow(contract), urgent: contract.aboard && contract.kind === 'urgent' && contract.timeLeft > 0 }];
  }

  waypoint(): Waypoint | null {
    const contract = this.contract;
    if (!contract) {
      return null;
    }
    const station = contract.aboard ? contract.to : contract.from;
    const world = this.deps.portOf(station);
    // Close and slow enough for the berth (or Aegis's docking guides) to take the ship.
    const arrive = station === 'aegis' ? { speed: 6, range: 6 } : { speed: 2.5, range: 4 };
    return world ? { world, label: `${STATIONS[station].name}: ${contract.aboard ? 'DELIVER' : 'LOAD'} ${CARGO_GOOD_NAME[contract.good].toUpperCase()}`, arrive } : null;
  }

  private load(contract: Contract): void {
    const { hud, sound } = this.deps;
    if (contract.good === 'fuel' || contract.good === 'parts') {
      contract.units = Math.floor(-this.deps.addStock(contract.from, contract.good, -contract.units));
    }
    contract.aboard = true;
    contract.loadedAt = this.deps.session.clock;
    contract.timeLeft = contract.kind === 'urgent' ? cargoParSeconds(contract.distance) : 0;
    contract.knocks = 0;
    this.wasBoosting = false;
    if (contract.kind !== 'passengers') {
      this.setMass(CARGO.mass);
    }
    const advice =
      contract.kind === 'passengers'
        ? 'Fly gently and do not boost'
        : contract.kind === 'fragile'
          ? 'Every hard knock costs pay'
          : contract.kind === 'urgent'
            ? `${formatCountdown(contract.timeLeft)} to deliver. The ship is heavier: brake early`
            : 'The ship is heavier: brake early';
    hud.showMessage(`${this.what(contract)[0].toUpperCase()}${this.what(contract).slice(1)} aboard for ${nameOf(contract.to)}. ${advice}`, 'success', 4.5);
    sound.dockClamp();
  }

  /** Knocks and the boost are felt by fragile loads and by people. */
  private feelTheRide(contract: Contract): void {
    const { ship, hud, session } = this.deps;
    const delicate = contract.kind === 'fragile' || contract.kind === 'passengers';
    const cushion = contract.kind === 'passengers' ? session.fit.crewCushion : 1;
    if (delicate && ship.hull < this.lastHull - cushion) {
      contract.knocks += 1;
      hud.showMessage(contract.kind === 'passengers' ? 'The passengers felt that. Fly gently' : 'The instruments took a knock: pay reduced', 'warning', 2.5);
    }
    this.lastHull = ship.hull;
    if (contract.kind === 'passengers' && ship.boosting && !this.wasBoosting) {
      contract.knocks += 1;
      hud.showMessage('Passengers aboard: the boost throws them about. Pay reduced', 'warning', 2.5);
    }
    this.wasBoosting = ship.boosting;
  }

  private deliver(contract: Contract): void {
    const { sound, radio, events, wallet, session } = this.deps;
    if (contract.good === 'fuel' || contract.good === 'parts') {
      this.deps.addStock(contract.to, contract.good, contract.units);
    }
    const pay = this.payNow(contract);
    wallet.earn(pay);
    const seconds = session.clock - contract.loadedAt;
    const par = cargoParSeconds(contract.distance);
    const score = contract.kind === 'routine' || contract.kind === 'urgent' ? timeScore(seconds, par) : passengerScore(contract.knocks, seconds, par);
    events.emit({ type: 'satellite-job-completed', job: contract.kind === 'passengers' ? 'passengers' : 'cargo', score, pay });
    radio.say(SPEAKER[contract.to], contract.kind === 'passengers' ? 'Everyone is off and smiling. Thank you, {callsign}.' : `${nameOf(contract.to)}: load received. Good work, {callsign}.`);
    this.end(`Delivered to ${nameOf(contract.to)}: ${formatCredits(pay)}`, 'success');
    sound.killConfirm();
  }

  private end(message: string, tone: 'success' | 'warning' | 'danger'): void {
    this.contract = null;
    this.setMass(0);
    this.deps.hud.showMessage(message, tone, 4);
  }

  private setMass(extra: number): void {
    const { session, ship } = this.deps;
    session.cargoMass = extra;
    ship.massFactor = session.fit.massFactor + extra;
  }

  private payNow(contract: Contract): number {
    const fit = this.deps.session.fit;
    return cargoPay({
      kind: contract.kind,
      distance: contract.distance,
      shortage: contract.shortage,
      knocks: contract.knocks,
      late: contract.aboard && contract.kind === 'urgent' && contract.timeLeft <= 0,
      moduleRate: contract.kind === 'passengers' ? fit.crewPay : fit.cargoPay,
    });
  }

  private what(contract: Contract): string {
    return contract.good === 'fuel' || contract.good === 'parts' ? `${contract.units} ${contract.good}` : contract.good === 'people' ? 'passengers' : 'instruments';
  }
}
