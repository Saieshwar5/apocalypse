import type { ModuleEffects } from '../logic/shipModules';
import { escortScore } from '../logic/medals';
import * as THREE from 'three';
import type { Asteroid, AsteroidField } from '../asteroids/asteroidField';
import type { SoundEffects } from '../audio/soundEffects';
import type { Explosions } from '../effects/explosions';
import type { Hud } from '../hud/hud';
import { formatCredits } from '../logic/contracts';
import type { Wallet } from '../logic/economy';
import { randomUnitVector, type RandomSource } from '../logic/random';
import { dodgeApproach } from '../logic/satelliteJobs';
import type { SupplyRocket } from '../station/supplyRocket';
import type { GameEvents } from './gameEvents';
import type { RadioNet } from './radioNet';
import type { JobRow } from './satelliteJobHelpers';

const ESCORT_PAY = 300;
/** The rocks are planned to cross the rocket's path this many seconds after launch. */
const CROSSING_SECONDS = 18;
const ROCK_SPEED = 4;
/** A rock this close to the rocket destroys it. */
const HIT_DISTANCE = 2.5;

export interface EscortWorkDependencies {
  field: AsteroidField;
  rocket: () => SupplyRocket | null;
  explosions: Explosions;
  wallet: Wallet;
  events: GameEvents;
  hud: Hud;
  sound: SoundEffects;
  radio: RadioNet;
  rng: RandomSource;
  /** Seconds of play, for grading jobs; and what the fitted modules do. */
  clock: () => number;
  fit: () => ModuleEffects;
}

/**
 * Launch escort: the supply rocket climbing to Aegis has rocks on a path to
 * cross it. Destroy or push them away before they meet it. If the rocket
 * arrives, the escort is paid; if it is hit, the supplies are lost.
 */
export class EscortWork {
  private threats: Asteroid[] = [];
  private wasFlying = false;
  /** Play clock when the rocks were posted, and when the last one was dealt with. */
  private startedAt = 0;
  private clearedAt: number | null = null;

  constructor(private readonly deps: EscortWorkDependencies) {}

  reset(): void {
    this.threats = [];
    this.wasFlying = false;
  }

  update(): void {
    const rocket = this.deps.rocket();
    const flying = rocket?.inFlight ?? false;
    if (rocket && flying && !this.wasFlying && this.deps.rng() < 0.5) {
      this.start(rocket);
    }
    this.wasFlying = flying;
    if (this.threats.length === 0 || !rocket) {
      return;
    }
    if (this.clearedAt === null && this.threats.every((rock) => !rock.alive)) {
      this.clearedAt = this.deps.clock();
    }
    for (const rock of this.threats) {
      if (rock.alive && flying && rock.mesh.position.distanceTo(rocket.position) < HIT_DISTANCE + rock.radius) {
        this.lose(rocket, rock);
        return;
      }
    }
    if (!flying) {
      this.finish();
    }
  }

  rows(): JobRow[] {
    const left = this.threats.filter((rock) => rock.alive).length;
    if (this.threats.length === 0) {
      return [];
    }
    return [{ title: 'Escort the supply rocket', detail: `${left} rock${left === 1 ? '' : 's'} crossing its path · destroy them before they meet it`, pay: ESCORT_PAY, urgent: left > 0 }];
  }

  private start(rocket: SupplyRocket): void {
    this.startedAt = this.deps.clock();
    this.clearedAt = null;
    const { field, rng, hud, radio, sound } = this.deps;
    const crossing = rocket.positionAhead(CROSSING_SECONDS);
    for (let index = 0; index < 2; index += 1) {
      const target = crossing.clone().add(new THREE.Vector3(...randomUnitVector(rng)).multiplyScalar(0.5));
      const path = dodgeApproach(target.toArray(), randomUnitVector(rng), ROCK_SPEED, CROSSING_SECONDS + index * 1.5);
      const rock = field.spawnFragment('small', 'rocky', new THREE.Vector3(...path.position), new THREE.Vector3(...path.velocity));
      rock.passerBy = true;
      this.threats.push(rock);
    }
    radio.say('control', 'Supply rocket away, {callsign}. Two rocks are crossing its climb. Escort it.', true);
    hud.showMessage(`Escort: two rocks will cross the supply rocket's path in ${CROSSING_SECONDS} s (${formatCredits(ESCORT_PAY)})`, 'warning', 5);
    sound.alarm();
  }

  private lose(rocket: SupplyRocket, rock: Asteroid): void {
    const { explosions, hud, radio, events, field } = this.deps;
    explosions.spawnExplosion(rocket.position.clone(), 1.2, 'fire');
    rocket.cancel();
    field.remove(rock);
    events.emit({ type: 'contract-lost', site: false });
    hud.showMessage('The supply rocket was hit. Its cargo is lost', 'danger', 4);
    radio.say('control', 'We lost the supply rocket. Aegis gets nothing this time.', true);
    this.threats = [];
  }

  private finish(): void {
    const { wallet, events, hud, sound } = this.deps;
    wallet.earn(ESCORT_PAY);
    const cleared = this.clearedAt ?? this.deps.clock();
    const score = escortScore(CROSSING_SECONDS - (cleared - this.startedAt), CROSSING_SECONDS);
    events.emit({ type: 'satellite-job-completed', job: 'escort', score, pay: ESCORT_PAY });
    hud.showMessage(`Supply rocket delivered safely. Escort paid: ${formatCredits(ESCORT_PAY)}`, 'success', 4);
    sound.killConfirm();
    this.threats = [];
  }
}
