import * as THREE from 'three';
import type { SoundEffects } from '../audio/soundEffects';
import type { Hud } from '../hud/hud';
import { STORM, SWELL, inPlanetShadow } from '../logic/spaceWeather';
import { formatCountdown } from '../logic/units';
import { EARTH_RADIUS } from '../scene/earth';
import type { SatelliteFleet } from '../satellites/satelliteFleet';
import type { ShipController } from '../ship/shipController';
import type { CombatResolver } from './combatResolver';
import type { RadioNet } from './radioNet';
import type { SatelliteWork } from './satelliteWork';

export interface SpaceWeatherDependencies {
  ship: ShipController;
  combat: CombatResolver;
  fleet: SatelliteFleet;
  work: SatelliteWork;
  hud: Hud;
  sound: SoundEffects;
  radio: RadioNet;
  sunDirection: THREE.Vector3;
  /** Docked at Aegis or berthed at an outpost: the station's shielding protects the ship. */
  atStation: () => boolean;
  /** The pilot's licence covers satellite tows; until it does, storms do not sink satellites. */
  canReboost: () => boolean;
}

type Phase = 'clear' | 'warning' | 'storm';

/**
 * Solar storms: a warning countdown, then a storm that drains the shield
 * (and then the hull) of a ship out in the open and halves the scanner.
 * Shelter is the planet's shadow or a station. Afterwards the swollen
 * atmosphere drags the lowest satellites down, and their operators post
 * reboost contracts.
 */
export class SpaceWeather {
  phase: Phase = 'clear';
  private timer = 0;
  private wasSheltered = true;

  constructor(private readonly deps: SpaceWeatherDependencies) {}

  reset(): void {
    this.phase = 'clear';
    this.timer = 0;
  }

  /** Scanner range multiplier: a storm fills it with noise. */
  get scannerFactor(): number {
    return this.phase === 'storm' ? STORM.scannerShare : 1;
  }

  /** One line for the hint bar while a storm is near, or null. */
  get hint(): string | null {
    if (this.phase === 'warning') {
      return `Solar storm in ${formatCountdown(this.timer)}: shelter in the planet's shadow (the night side) or at a station`;
    }
    if (this.phase === 'storm') {
      return `SOLAR STORM ${formatCountdown(this.timer)} · ${this.sheltered() ? 'sheltered' : 'exposed: shield draining'}`;
    }
    return null;
  }

  /** Starts the countdown to a storm (nothing happens if one is already coming). */
  warn(): void {
    if (this.phase !== 'clear') {
      return;
    }
    this.phase = 'warning';
    this.timer = STORM.warningSeconds;
    this.deps.radio.say('control', 'All pilots, solar storm in thirty seconds. Get into the planet\'s shadow or to a station.', true);
    this.deps.hud.showMessage(`Solar storm in ${STORM.warningSeconds} s: shelter on the night side or at a station`, 'danger', 5);
    this.deps.sound.alarm();
  }

  update(deltaSeconds: number, shipActive: boolean): void {
    if (this.phase === 'clear') {
      return;
    }
    this.timer -= deltaSeconds;
    if (this.phase === 'warning') {
      if (this.timer <= 0) {
        this.phase = 'storm';
        this.timer = STORM.durationSeconds;
        this.deps.hud.showMessage('Solar storm: radiation everywhere outside shelter', 'danger', 4);
      }
      return;
    }
    if (shipActive) {
      this.expose(deltaSeconds);
    }
    if (this.timer <= 0) {
      this.phase = 'clear';
      this.swell();
    }
  }

  private sheltered(): boolean {
    const { ship, sunDirection, atStation } = this.deps;
    return atStation() || inPlanetShadow(ship.position.toArray(), sunDirection.toArray(), EARTH_RADIUS);
  }

  private expose(deltaSeconds: number): void {
    const sheltered = this.sheltered();
    if (sheltered !== this.wasSheltered) {
      this.deps.hud.showMessage(sheltered ? 'Sheltered from the storm' : 'Exposed to the storm: get into shadow', sheltered ? 'success' : 'warning', 2.5);
      this.wasSheltered = sheltered;
    }
    if (sheltered) {
      return;
    }
    const rate = this.deps.ship.shield > 0 ? STORM.shieldDrainPerSecond : STORM.hullDrainPerSecond;
    this.deps.combat.applyEnvironmentDamage(rate * deltaSeconds, 'The interceptor was burned out by the solar storm');
  }

  /** After the storm, the swollen atmosphere drags the lowest satellites down. */
  private swell(): void {
    const { fleet, work, hud, radio } = this.deps;
    if (!this.deps.canReboost()) {
      hud.showMessage('Storm over', 'success', 4);
      return;
    }
    let posted = 0;
    for (const satellite of fleet.satellites) {
      if (!satellite.alive || satellite.mode !== 'orbit' || fleet.currentRadius(satellite) >= SWELL.belowRadius) {
        continue;
      }
      fleet.startSinking(satellite, SWELL.sinkPerSecond);
      if (work.postReboost(satellite)) {
        posted += 1;
      }
    }
    hud.showMessage(posted > 0 ? `Storm over. The atmosphere has swollen: ${posted} satellite${posted > 1 ? 's are' : ' is'} sinking` : 'Storm over', posted > 0 ? 'warning' : 'success', 5);
    if (posted > 0) {
      radio.say('control', 'Storm has passed. Low satellites are sinking: operators are posting reboost contracts.');
    }
  }
}
