import * as THREE from 'three';
import type { Asteroid, AsteroidField } from '../asteroids/asteroidField';
import type { SoundEffects } from '../audio/soundEffects';
import type { Hud } from '../hud/hud';
import { formatCredits } from '../logic/contracts';
import type { Wallet } from '../logic/economy';
import { randomBetween, randomUnitVector, type RandomSource } from '../logic/random';
import { HAUL_PAY_PER_TONNE, haulLoadMass, haulTonnes } from '../logic/stationEconomy';
import { TOW, isPlaced } from '../logic/towing';
import { formatDistance } from '../logic/units';
import type { Outposts } from '../station/outposts';
import type { GameEvents } from './gameEvents';
import type { JobRow, Waypoint } from './satelliteJobHelpers';
import type { StationMarket } from './stationMarket';
import type { TowLine } from './towLine';
import type { RadioNet } from './radioNet';

export interface HaulWorkDependencies {
  field: AsteroidField;
  outposts: Outposts;
  market: StationMarket;
  tow: TowLine;
  ship: { position: THREE.Vector3 };
  wallet: Wallet;
  events: GameEvents;
  hud: Hud;
  sound: SoundEffects;
  rng: RandomSource;
  radio: RadioNet;
}

/** Ceres accepts a rock released this close to its intake... */
const INTAKE_RANGE = 10;

interface Haul {
  rock: Asteroid;
  tonnes: number;
}

/**
 * The asteroid haul: Ceres Works asks for a small, harmless rock to be
 * caught and towed to its intake, where it is refined into fuel and parts.
 * The rock is heavy on the line, so the trip is about planning fuel and
 * braking early. Pay is by the tonne.
 */
export class HaulWork {
  private haul: Haul | null = null;

  constructor(private readonly deps: HaulWorkDependencies) {}

  reset(): void {
    this.haul = null;
  }

  get active(): boolean {
    return this.haul !== null;
  }

  /** Ceres posts a haul: a loose carbon-rich rock drifting in the orbit band. */
  post(): boolean {
    if (this.haul) {
      return false;
    }
    const { field, rng, hud, sound } = this.deps;
    const position = new THREE.Vector3(...randomUnitVector(rng)).multiplyScalar(randomBetween(rng, 72, 100));
    const drift = new THREE.Vector3(...randomUnitVector(rng)).cross(position).setLength(1.2);
    const rock = field.spawnFragment('medium', 'carbon', position, drift);
    rock.passerBy = true;
    rock.identified = true;
    const tonnes = haulTonnes(rock.radius);
    this.haul = { rock, tonnes };
    hud.showMessage(`Ceres Works: haul a ${tonnes.toFixed(1)} t carbon rock to our intake for ${formatCredits(this.pay(tonnes))}`, 'info', 5);
    sound.chime();
    return true;
  }

  /** The haul rock, for the tow key, when it is within reach. */
  rockNear(position: THREE.Vector3): Asteroid | null {
    const rock = this.haul?.rock;
    if (!rock || !rock.alive) {
      return null;
    }
    return rock.mesh.position.distanceTo(position) - rock.radius <= TOW.attachRange + 6 ? rock : null;
  }

  connect(): void {
    const { tow, hud, sound } = this.deps;
    const haul = this.haul;
    if (!haul) {
      return;
    }
    if (tow.attachRock(haul.rock, haulLoadMass(haul.tonnes))) {
      hud.showMessage(`Tow line on the ${haul.tonnes.toFixed(1)} t rock. Very heavy: plan your fuel and brake early`, 'success', 3.5);
      sound.dockClamp();
    } else {
      hud.showMessage(`Get within ${formatDistance(TOW.attachRange)} of the rock and match its speed to connect`, 'warning', 2.5);
    }
  }

  /** Lets go: delivered if the rock is at Ceres's intake and nearly still, otherwise it drifts. */
  release(): void {
    const { tow, outposts, field, market, wallet, hud, sound, events } = this.deps;
    const rock = tow.releaseRock();
    const haul = this.haul;
    if (!rock || !haul) {
      return;
    }
    sound.dockClamp();
    const ceres = outposts.get('ceres');
    const intake = outposts.portPosition('ceres');
    const delivered = rock.mesh.position.distanceTo(intake) <= INTAKE_RANGE && isPlaced(0, rock.velocity.distanceTo(ceres.velocity));
    if (!delivered) {
      hud.showMessage('Rock released. It drifts until you connect again (T)', 'info', 2.5);
      return;
    }
    field.remove(rock);
    const made = market.refine(haul.tonnes);
    const pay = this.pay(haul.tonnes);
    wallet.earn(pay);
    events.emit({ type: 'satellite-job-completed' });
    this.haul = null;
    this.deps.radio.moment('haul-delivered');
    hud.showMessage(`Delivered to Ceres Works: ${formatCredits(pay)}. Refined into ${Math.round(made.fuel)} fuel and ${Math.round(made.parts)} parts`, 'success', 4.5);
    sound.killConfirm();
  }

  /** The job ends if the rock is destroyed or lost. */
  update(): void {
    if (this.haul && !this.haul.rock.alive) {
      if (this.deps.tow.rock === this.haul.rock) {
        this.deps.tow.releaseRock();
      }
      this.haul = null;
      this.deps.hud.showMessage('The haul rock is gone. Contract cancelled', 'warning', 3);
    }
    if (this.deps.tow.snapped) {
      this.deps.tow.snapped = false;
      this.deps.hud.showMessage('Tow line snapped: the rock was pulled too hard', 'danger', 3);
    }
  }

  rows(): JobRow[] {
    const haul = this.haul;
    if (!haul) {
      return [];
    }
    const onLine = this.deps.tow.rock === haul.rock;
    return [
      {
        title: `Asteroid haul · ${haul.tonnes.toFixed(1)} t to Ceres`,
        detail: onLine ? 'tow it to Ceres Works intake and release (T)' : 'connect to the carbon rock (T)',
        pay: this.pay(haul.tonnes),
        urgent: false,
      },
    ];
  }

  waypoint(): Waypoint | null {
    const haul = this.haul;
    if (!haul) {
      return null;
    }
    return this.deps.tow.rock === haul.rock
      ? { world: this.deps.outposts.portPosition('ceres'), label: 'CERES INTAKE: RELEASE HERE (T)' }
      : { world: haul.rock.mesh.position.clone(), label: 'CONNECT TO THE HAUL ROCK (T)' };
  }

  private pay(tonnes: number): number {
    return Math.round((tonnes * HAUL_PAY_PER_TONNE) / 5) * 5;
  }
}
