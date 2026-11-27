import type * as THREE from 'three';
import type { SoundEffects } from '../audio/soundEffects';
import type { Hud } from '../hud/hud';
import { formatCredits } from '../logic/contracts';
import type { Wallet } from '../logic/economy';
import type { RandomSource } from '../logic/random';
import { CREW_CALL } from '../logic/spaceWeather';
import type { Satellite, SatelliteFleet } from '../satellites/satelliteFleet';
import type { ShipController } from '../ship/shipController';
import type { GameEvents } from './gameEvents';
import type { OutpostBerths } from './outpostBerths';
import type { RadioNet } from './radioNet';
import { KIND_LABEL, type JobRow, type Waypoint } from './satelliteJobHelpers';

export interface CrewWorkDependencies {
  berths: OutpostBerths;
  fleet: SatelliteFleet;
  ship: ShipController;
  /** Halo's crew port, where crews board and leave. */
  haloPort: () => THREE.Vector3;
  wallet: Wallet;
  events: GameEvents;
  hud: Hud;
  sound: SoundEffects;
  radio: RadioNet;
  rng: RandomSource;
}

type Stage = 'pickup' | 'travel' | 'return';

/**
 * A crew service call from Halo: berth at Halo to take a crew aboard, fly
 * to the satellite and hold close beside it while they work outside, then
 * bring them home. People are aboard, so hard hits matter: losing the ship
 * with a crew aboard is the worst failure in the game.
 */
export class CrewWork {
  private satellite: Satellite | null = null;
  private stage: Stage = 'pickup';
  private work = 0;
  private lastHull = 100;
  private progressShown = 0;

  constructor(private readonly deps: CrewWorkDependencies) {}

  reset(): void {
    this.satellite = null;
    this.stage = 'pickup';
    this.work = 0;
  }

  get active(): boolean {
    return this.satellite !== null;
  }

  /** Halo posts a service call for a working satellite. */
  post(): boolean {
    if (this.satellite) {
      return false;
    }
    const candidates = this.deps.fleet.satellites.filter((satellite) => satellite.alive && satellite.mode === 'orbit' && !satellite.broken);
    if (candidates.length === 0) {
      return false;
    }
    this.satellite = candidates[Math.floor(this.deps.rng() * candidates.length)];
    this.stage = 'pickup';
    this.work = 0;
    this.deps.radio.say('halo', `Sato on Halo. I have a crew for ${KIND_LABEL[this.satellite.kind]} servicing. Berth with us to take them aboard.`);
    this.deps.hud.showMessage(`Crew service call: carry a Halo crew to ${KIND_LABEL[this.satellite.kind]} and back (${formatCredits(CREW_CALL.pay)})`, 'info', 5);
    this.deps.sound.chime();
    return true;
  }

  update(deltaSeconds: number, shipActive: boolean): void {
    const satellite = this.satellite;
    if (!satellite) {
      return;
    }
    const { berths, ship, hud, events, radio } = this.deps;
    const aboard = this.stage !== 'pickup';
    if (aboard && !shipActive) {
      events.emit({ type: 'crew-lost' });
      radio.say('halo', 'We have lost the crew. God help us. Your licence will answer for this.', true);
      this.satellite = null;
      return;
    }
    if (aboard && ship.hull < this.lastHull - 1) {
      hud.showMessage('The crew took that hit too. Fly gently', 'warning', 2);
    }
    this.lastHull = ship.hull;
    if (this.stage === 'pickup') {
      if (!satellite.alive) {
        this.satellite = null;
        hud.showMessage('The satellite is gone. Crew call cancelled', 'warning', 3);
      } else if (berths.berthedAt === 'halo') {
        this.stage = 'travel';
        hud.showMessage(`Crew aboard. Fly to ${KIND_LABEL[satellite.kind]} and hold close beside it`, 'success', 4);
      }
      return;
    }
    if (this.stage === 'travel') {
      this.holdBeside(satellite, deltaSeconds);
      return;
    }
    if (berths.berthedAt === 'halo') {
      this.deps.wallet.earn(CREW_CALL.pay);
      events.emit({ type: 'satellite-job-completed' });
      radio.say('halo', 'Crew is home safe. Thank you, {callsign}.');
      hud.showMessage(`Crew service complete: ${formatCredits(CREW_CALL.pay)}`, 'success', 4);
      this.deps.sound.killConfirm();
      this.satellite = null;
    }
  }

  rows(): JobRow[] {
    if (!this.satellite) {
      return [];
    }
    const name = KIND_LABEL[this.satellite.kind];
    const detail =
      this.stage === 'pickup'
        ? 'berth at Halo to take the crew aboard'
        : this.stage === 'travel'
          ? `hold beside ${name.toLowerCase()} · work ${Math.round((this.work / CREW_CALL.workSeconds) * 100)}%`
          : 'bring the crew home: berth at Halo';
    return [{ title: `Crew service: ${name}`, detail, pay: CREW_CALL.pay, urgent: false }];
  }

  waypoint(): Waypoint | null {
    if (!this.satellite) {
      return null;
    }
    if (this.stage === 'travel') {
      return { world: this.satellite.position.clone(), label: `HOLD BESIDE ${KIND_LABEL[this.satellite.kind]}` };
    }
    return { world: this.deps.haloPort(), label: this.stage === 'pickup' ? 'HALO: BERTH FOR THE CREW' : 'HALO: BRING THE CREW HOME' };
  }

  /** The crew works only while the ship holds close and steady beside the satellite. */
  private holdBeside(satellite: Satellite, deltaSeconds: number): void {
    const { ship, hud } = this.deps;
    if (!satellite.alive) {
      this.stage = 'return';
      hud.showMessage('The satellite is gone. Bring the crew home', 'warning', 3);
      return;
    }
    const close = satellite.position.distanceTo(ship.position) <= CREW_CALL.holdRange;
    const steady = satellite.velocity.distanceTo(ship.velocity) <= CREW_CALL.holdRelativeSpeed;
    if (!close || !steady) {
      return;
    }
    this.work += deltaSeconds;
    const percent = Math.floor((this.work / CREW_CALL.workSeconds) * 4) * 25;
    if (percent > this.progressShown) {
      this.progressShown = percent;
      hud.showMessage(percent >= 100 ? 'Crew back aboard. Take them home to Halo' : `Crew working outside: ${percent}%. Hold steady`, 'info', 2);
    }
    if (this.work >= CREW_CALL.workSeconds) {
      this.stage = 'return';
      this.progressShown = 0;
    }
  }
}
