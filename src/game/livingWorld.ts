import * as THREE from 'three';
import type { SoundEffects } from '../audio/soundEffects';
import type { Hud } from '../hud/hud';
import { formatCredits } from '../logic/contracts';
import type { Wallet } from '../logic/economy';
import type { RandomSource } from '../logic/random';
import { EARTH_RADIUS, latLonToLocalDirection, type Earth } from '../scene/earth';
import type { Outposts } from '../station/outposts';
import { AmbientTraffic } from '../world/ambientTraffic';
import type { RadioNet } from './radioNet';

/** Real launch sites, by latitude and longitude. */
const LAUNCH_SITES: readonly [number, number, string][] = [
  [28.5, -80.6, 'Cape Canaveral'],
  [45.9, 63.3, 'Baikonur'],
  [5.2, -52.8, 'Kourou'],
  [40.9, 100.3, 'Jiuquan'],
  [13.7, 80.2, 'Sriharikota'],
  [30.4, 131.0, 'Tanegashima'],
];
const LAUNCH_EVERY = [50, 110] as const;
const SHOWER_SECONDS = 45;
/** The derelict is found by flying this close. */
const RELIC_RANGE = 8;
const RELIC_REWARD = 600;

export interface LivingWorldDependencies {
  scene: THREE.Scene;
  earth: Earth;
  outposts: Outposts;
  ship: { position: THREE.Vector3 };
  wallet: Wallet;
  hud: Hud;
  sound: SoundEffects;
  radio: RadioNet;
  rng: RandomSource;
  /** Marks a secret found in the career; false when it was found before. */
  discover: (id: string) => boolean;
  note: (text: string) => void;
  /** A rocket has left the pad (for the radio's traffic call). */
  onLaunch?: (site: string) => void;
}

/**
 * The orbit as a place: launches from Earth, meteor showers, spacewalkers
 * at Halo, and a derelict probe from
 * the early space age somewhere high above the poles, for the curious.
 */
export class LivingWorld {
  readonly traffic: AmbientTraffic;
  private launchIn = 20;
  private showerLeft = 0;
  private readonly relic: THREE.Group;

  constructor(private readonly deps: LivingWorldDependencies) {
    this.traffic = new AmbientTraffic(EARTH_RADIUS);
    deps.earth.attachToSurface(this.traffic.surfaceGroup);
    deps.scene.add(this.traffic.group);
    this.traffic.addSpacewalkers(deps.outposts.get('halo').port, 2);
    this.relic = buildRelic();
    deps.scene.add(this.relic);
  }

  get showerActive(): boolean {
    return this.showerLeft > 0;
  }

  reset(): void {
    this.traffic.clear();
    this.launchIn = 20;
    this.showerLeft = 0;
    // High above one pole, inside the defence zone: far enough to need a deliberate trip.
    const pole = this.deps.rng() < 0.5 ? 1 : -1;
    const around = this.deps.rng() * Math.PI * 2;
    this.relic.position.set(Math.cos(around) * 120, pole * 300, Math.sin(around) * 120);
    this.relic.visible = true;
  }

  /** A calm zone has started: sometimes a meteor shower, sometimes a rumour of the lost probe. */
  calmZone(): void {
    const { rng, radio } = this.deps;
    if (rng() < 0.3) {
      this.showerLeft = SHOWER_SECONDS;
      radio.say('control', 'Meteor shower over the night side, {callsign}. Harmless, and worth a look.');
    } else if (rng() < 0.15) {
      radio.say('moth', 'Moth. They say an old probe still drifts out past the stations, high over one of the poles. Never found it myself.');
    }
  }

  update(deltaSeconds: number, active: boolean): void {
    this.launchIn -= deltaSeconds;
    if (this.launchIn <= 0) {
      const [min, max] = LAUNCH_EVERY;
      this.launchIn = min + this.deps.rng() * (max - min);
      const [latitude, longitude, site] = LAUNCH_SITES[Math.floor(this.deps.rng() * LAUNCH_SITES.length)];
      this.traffic.launch(latLonToLocalDirection(latitude, longitude));
      this.deps.onLaunch?.(site);
    }
    this.showerLeft = Math.max(0, this.showerLeft - deltaSeconds);
    const night = this.deps.earth.surfaceNight();
    this.traffic.update(deltaSeconds, this.showerActive, night);
    this.relic.rotation.y += deltaSeconds * 0.05;
    this.relic.rotation.x += deltaSeconds * 0.02;
    if (active && this.relic.visible && this.relic.position.distanceTo(this.deps.ship.position) < RELIC_RANGE) {
      this.findRelic();
    }
  }

  /** Photo mode's shutter: the picture is the pilot's own (no job attached). */
  takePhoto(): string {
    return "Picture taken. Use your computer's screenshot key to keep it";
  }

  private findRelic(): void {
    this.relic.visible = false;
    const { hud, radio, sound, wallet } = this.deps;
    if (this.deps.discover('seeker-one')) {
      wallet.earn(RELIC_REWARD);
      this.deps.note('Found SEEKER ONE, the survey probe lost in 1982');
      radio.say('moth', 'Seeker One. I watched that launch as a kid. Well found, {callsign}.', true);
      hud.showMessage(`You found SEEKER ONE, lost since 1982. The Space Museum pays ${formatCredits(RELIC_REWARD)}`, 'success', 6);
      sound.killConfirm();
    } else {
      hud.showMessage('SEEKER ONE again: still drifting, still quiet', 'info', 3);
    }
  }
}

/** An early space-age probe: a gold-foiled body, a dish and a long antenna boom. */
function buildRelic(): THREE.Group {
  const relic = new THREE.Group();
  const foil = new THREE.MeshStandardMaterial({ color: 0xc9962e, metalness: 0.95, roughness: 0.32 });
  const white = new THREE.MeshStandardMaterial({ color: 0xd8d6cf, metalness: 0.3, roughness: 0.6 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.45, 6), foil);
  const dish = new THREE.Mesh(new THREE.SphereGeometry(1.1, 20, 8, 0, Math.PI * 2, 0, Math.PI / 4), white);
  dish.position.y = 0.2;
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 3.2, 6), white);
  boom.rotation.z = Math.PI / 2;
  boom.position.y = -0.1;
  const rtg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.5, 8), new THREE.MeshStandardMaterial({ color: 0x3a3a3a, metalness: 0.7, roughness: 0.5 }));
  rtg.rotation.z = Math.PI / 2;
  rtg.position.set(1.4, -0.1, 0);
  relic.add(body, dish, boom, rtg);
  relic.scale.setScalar(0.6);
  return relic;
}
