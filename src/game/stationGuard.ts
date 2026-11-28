import * as THREE from 'three';
import type { Asteroid, AsteroidField } from '../asteroids/asteroidField';
import type { SoundEffects } from '../audio/soundEffects';
import type { Explosions } from '../effects/explosions';
import type { Hud } from '../hud/hud';
import { CITY_IDS, STATION_STRIKE, type CityId } from '../logic/cities';
import { formatCredits } from '../logic/contracts';
import type { Wallet } from '../logic/economy';
import { timeScore } from '../logic/medals';
import { randomUnitVector, type RandomSource } from '../logic/random';
import { dodgeApproach } from '../logic/satelliteJobs';
import { STATIONS } from '../logic/stations';
import { formatCountdown } from '../logic/units';
import type { Outposts } from '../station/outposts';
import type { GameEvents } from './gameEvents';
import type { RadioNet } from './radioNet';
import type { JobRow, Waypoint } from './satelliteJobHelpers';

export interface StationGuardDependencies {
  field: AsteroidField;
  outposts: Outposts;
  explosions: Explosions;
  /** The rock got through: the station loses stores and structure. */
  onStrike: (city: CityId) => void;
  /** The pilot's licence covers guarding. */
  allowed: () => boolean;
  clock: () => number;
  wallet: Wallet;
  events: GameEvents;
  hud: Hud;
  sound: SoundEffects;
  radio: RadioNet;
  rng: RandomSource;
}

interface Threat {
  city: CityId;
  rock: Asteroid;
  postedAt: number;
}

/** Seconds between one threat to a station and the chance of the next. */
const QUIET_SECONDS: [number, number] = [150, 260];
/** The rock has gone by once it is this far past the station and moving away. */
const PASSED = 30;

/**
 * Rocks on course for the great stations. One at a time, a rock is found
 * heading for Meridian, Anchor or Farwatch with under a minute of warning.
 * Destroy it or push it aside and the station pays; let it through and the
 * station is holed, loses stores and goes dim.
 */
export class StationGuard {
  private threat: Threat | null = null;
  private nextIn = 90;

  constructor(private readonly deps: StationGuardDependencies) {}

  reset(): void {
    this.threat = null;
    this.nextIn = 90;
  }

  update(deltaSeconds: number): void {
    const { rng } = this.deps;
    if (!this.threat) {
      this.nextIn -= deltaSeconds;
      if (this.nextIn <= 0) {
        this.nextIn = QUIET_SECONDS[0] + rng() * (QUIET_SECONDS[1] - QUIET_SECONDS[0]);
        if (this.deps.allowed()) {
          this.post(CITY_IDS[Math.floor(rng() * CITY_IDS.length)]);
        }
      }
      return;
    }
    const { city, rock } = this.threat;
    const station = this.deps.outposts.get(city);
    if (!rock.alive) {
      this.saved(city);
      return;
    }
    const offset = station.position.clone().sub(rock.mesh.position);
    const distance = offset.length();
    if (distance <= STATION_STRIKE.hitRadius[city] + rock.radius) {
      this.struck(city, rock);
      return;
    }
    const closing = rock.velocity.clone().sub(station.velocity).dot(offset) > 0;
    if (!closing && distance > STATION_STRIKE.hitRadius[city] + PASSED) {
      this.saved(city);
    }
  }

  /** Sends a rock at the station. Public so the story and tests can call for one. */
  post(city: CityId): boolean {
    if (this.threat) {
      return false;
    }
    const { field, outposts, rng, hud, sound, radio } = this.deps;
    const target = outposts.positionAhead(city, STATION_STRIKE.warningSeconds);
    const path = dodgeApproach(target.toArray(), randomUnitVector(rng), STATION_STRIKE.speed, STATION_STRIKE.warningSeconds);
    const rock = field.spawnFragment(rng() < 0.4 ? 'large' : 'medium', rng() < 0.5 ? 'iron' : 'rocky', new THREE.Vector3(...path.position), new THREE.Vector3(...path.velocity));
    rock.passerBy = true;
    rock.identified = true;
    this.threat = { city, rock, postedAt: this.deps.clock() };
    radio.say(city, `${STATIONS[city].name} to any pilot: we have a rock on a collision course. Under a minute. We cannot move out of its way.`, true);
    hud.showMessage(`A rock is on course for ${STATIONS[city].name}. Destroy it or push it aside (${formatCredits(STATION_STRIKE.pay)})`, 'danger', 6);
    sound.alarm();
    return true;
  }

  rows(): JobRow[] {
    if (!this.threat) {
      return [];
    }
    const { city, rock } = this.threat;
    const station = this.deps.outposts.get(city);
    const offset = station.position.clone().sub(rock.mesh.position);
    const closing = rock.velocity.clone().sub(station.velocity).dot(offset.clone().normalize());
    const seconds = closing > 0 ? offset.length() / closing : null;
    return [{ title: `Guard ${STATIONS[city].name}`, detail: `rock strikes in ${seconds === null ? '—' : formatCountdown(seconds)} · destroy it or push it aside`, pay: STATION_STRIKE.pay, urgent: true }];
  }

  waypoint(): Waypoint | null {
    return this.threat ? { world: this.threat.rock.mesh.position.clone(), label: `ROCK HEADING FOR ${STATIONS[this.threat.city].name}` } : null;
  }

  private saved(city: CityId): void {
    const { wallet, events, hud, sound, radio } = this.deps;
    const seconds = this.deps.clock() - (this.threat?.postedAt ?? 0);
    this.threat = null;
    wallet.earn(STATION_STRIKE.pay);
    events.emit({ type: 'satellite-job-completed', job: 'dodge', score: timeScore(seconds, STATION_STRIKE.warningSeconds * 0.6), pay: STATION_STRIKE.pay });
    radio.say(city, `${STATIONS[city].name}. It missed us. Everyone here saw that, {callsign}. Thank you.`);
    hud.showMessage(`${STATIONS[city].name} is safe: ${formatCredits(STATION_STRIKE.pay)}`, 'success', 4);
    sound.killConfirm();
  }

  private struck(city: CityId, rock: Asteroid): void {
    const { field, explosions, events, hud, sound, radio } = this.deps;
    const point = rock.mesh.position.clone();
    explosions.spawnExplosion(point, rock.radius * 1.6, 'blast', this.deps.outposts.get(city).velocity);
    field.remove(rock);
    this.threat = null;
    this.deps.onStrike(city);
    events.emit({ type: 'contract-lost', site: true });
    radio.say(city, `${STATIONS[city].name} is hit. We are holed and venting. Casualties. Send anyone you have.`, true);
    hud.showMessage(`${STATIONS[city].name} was struck: stores lost, the station is holed`, 'danger', 6);
    sound.explosion(1);
  }
}
