import * as THREE from 'three';
import type { SoundEffects } from '../audio/soundEffects';
import type { Explosions } from '../effects/explosions';
import type { Hud } from '../hud/hud';
import { ATMOSPHERE } from '../logic/atmosphere';
import { formatCredits } from '../logic/contracts';
import type { Wallet } from '../logic/economy';
import { randomBetween, randomUnitVector, type RandomSource } from '../logic/random';
import { TOW, isPlaced } from '../logic/towing';
import { formatCountdown } from '../logic/units';
import { getGlowTexture } from '../scene/glowTexture';
import { EARTH_RADIUS } from '../scene/earth';
import type { Outposts } from '../station/outposts';
import type { GameEvents } from './gameEvents';
import type { RadioNet } from './radioNet';
import type { JobRow, Waypoint } from './satelliteJobHelpers';
import type { TowBody, TowLine } from './towLine';

/** Pull on a pod: it is falling, which is the whole problem. */
const POD_GRAVITY = 0.45;
const RESCUE_PAY = 600;
/** Halo takes the pod at its crew port, this close and nearly still. */
const PORT_RANGE = 10;

/** An escape pod: a small white capsule with an orange band and a strobe. */
class EscapePod implements TowBody {
  readonly group = new THREE.Group();
  readonly velocity = new THREE.Vector3();
  readonly radius = 0.5;
  alive = true;
  private readonly strobe: THREE.Sprite;
  private age = 0;

  constructor() {
    const white = new THREE.MeshStandardMaterial({ color: 0xe8e8e4, metalness: 0.3, roughness: 0.5 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.32, 0.6, 14), white);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.25, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), white);
    nose.position.y = 0.3;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.1, 14), new THREE.MeshStandardMaterial({ color: 0xd2601a, roughness: 0.6 }));
    band.position.y = -0.18;
    this.strobe = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: getGlowTexture(), color: new THREE.Color(4, 1.2, 0.6), blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.strobe.position.y = 0.5;
    this.strobe.scale.setScalar(0.9);
    this.group.add(body, nose, band, this.strobe);
  }

  get position(): THREE.Vector3 {
    return this.group.position;
  }

  update(deltaSeconds: number): void {
    this.age += deltaSeconds;
    this.strobe.visible = this.age % 1 < 0.15;
    this.group.rotation.x += deltaSeconds * 0.7;
    this.group.rotation.z += deltaSeconds * 0.4;
  }
}

export interface RescueWorkDependencies {
  scene: THREE.Scene;
  ship: { position: THREE.Vector3 };
  tow: TowLine;
  outposts: Outposts;
  explosions: Explosions;
  wallet: Wallet;
  events: GameEvents;
  hud: Hud;
  sound: SoundEffects;
  radio: RadioNet;
  rng: RandomSource;
}

/**
 * Rescue: an escape pod has been ejected and is falling towards the
 * atmosphere. Catch it on the tow line before it burns up and bring it to
 * Halo's crew port. People are inside: losing the pod on your line counts
 * as losing a crew.
 */
export class RescueWork {
  private pod: EscapePod | null = null;

  constructor(private readonly deps: RescueWorkDependencies) {}

  reset(): void {
    this.remove();
  }

  get active(): boolean {
    return this.pod !== null;
  }

  get carrying(): boolean {
    return this.pod !== null && this.deps.tow.body === this.pod;
  }

  /** A pod is ejected from a crippled ore carrier, already falling. */
  post(): boolean {
    if (this.pod) {
      return false;
    }
    const { scene, rng, radio, hud, sound } = this.deps;
    const pod = new EscapePod();
    const up = new THREE.Vector3(...randomUnitVector(rng));
    pod.position.copy(up).multiplyScalar(EARTH_RADIUS + randomBetween(rng, 20, 26));
    const along = new THREE.Vector3(...randomUnitVector(rng)).cross(up).normalize();
    pod.velocity.copy(along).multiplyScalar(1.2).addScaledVector(up, -0.6);
    scene.add(pod.group);
    this.pod = pod;
    radio.say('halo', 'Mayday relay: an ore carrier lost power and ejected an escape pod. It is falling. Catch it and bring it to Halo!', true);
    hud.showMessage(`Rescue: an escape pod is falling towards the atmosphere. Catch it (T) and bring it to Halo (${formatCredits(RESCUE_PAY)})`, 'danger', 6);
    sound.alarm();
    return true;
  }

  podNear(position: THREE.Vector3): boolean {
    return this.pod !== null && this.pod.position.distanceTo(position) - this.pod.radius <= TOW.attachRange + 6;
  }

  connect(): void {
    const { tow, hud, sound } = this.deps;
    if (this.pod && tow.attachBody(this.pod, 0.8)) {
      hud.showMessage('Pod on the line. Climb away from the atmosphere and take it to Halo', 'success', 3.5);
      sound.dockClamp();
    } else {
      hud.showMessage('Get close and match the pod\'s speed to connect', 'warning', 2.5);
    }
  }

  /** Let go: delivered at Halo's crew port, otherwise it falls again. */
  release(): void {
    const { tow, outposts, wallet, events, hud, radio, sound } = this.deps;
    const pod = this.pod;
    if (!pod || tow.releaseBody() !== pod) {
      return;
    }
    sound.dockClamp();
    const halo = outposts.get('halo');
    if (pod.position.distanceTo(outposts.portPosition('halo')) <= PORT_RANGE && isPlaced(0, pod.velocity.distanceTo(halo.velocity))) {
      wallet.earn(RESCUE_PAY);
      events.emit({ type: 'satellite-job-completed' });
      radio.say('halo', 'Pod is aboard and the crew is alive. Thank you, {callsign}. Halo will not forget this.', true);
      hud.showMessage(`Rescue complete: ${formatCredits(RESCUE_PAY)}`, 'success', 4);
      sound.killConfirm();
      this.remove();
      return;
    }
    hud.showMessage('Pod released: it is falling again', 'warning', 2.5);
  }

  update(deltaSeconds: number): void {
    const pod = this.pod;
    if (!pod) {
      return;
    }
    pod.update(deltaSeconds);
    const down = pod.position.clone().normalize().negate();
    pod.velocity.addScaledVector(down, POD_GRAVITY * deltaSeconds);
    pod.position.addScaledVector(pod.velocity, deltaSeconds);
    if (pod.position.length() - EARTH_RADIUS > ATMOSPHERE.top) {
      return;
    }
    const lostOnLine = this.carrying;
    if (lostOnLine) {
      this.deps.tow.releaseBody();
    }
    this.deps.explosions.spawnExplosion(pod.position, 0.6, 'fire', pod.velocity);
    this.deps.events.emit(lostOnLine ? { type: 'crew-lost' } : { type: 'contract-lost', site: false });
    this.deps.hud.showMessage('The escape pod burned up in the atmosphere', 'danger', 4);
    this.deps.radio.say('halo', 'We lost the pod. Everyone aboard.', true);
    this.remove();
  }

  rows(): JobRow[] {
    const pod = this.pod;
    if (!pod) {
      return [];
    }
    const sink = -pod.velocity.dot(pod.position.clone().normalize());
    const altitude = pod.position.length() - EARTH_RADIUS - ATMOSPHERE.top;
    const left = sink > 0.05 ? ` · burns up in ${formatCountdown(altitude / sink)}` : '';
    return [{ title: 'Rescue: falling escape pod', detail: this.carrying ? 'take it to Halo\'s crew port and release (T)' : `catch it with the tow line (T)${left}`, pay: RESCUE_PAY, urgent: true }];
  }

  waypoint(): Waypoint | null {
    if (!this.pod) {
      return null;
    }
    return this.carrying
      ? { world: this.deps.outposts.portPosition('halo'), label: 'HALO CREW PORT: RELEASE HERE (T)' }
      : { world: this.pod.position.clone(), label: 'ESCAPE POD: CATCH IT (T)' };
  }

  private remove(): void {
    if (this.pod) {
      this.pod.alive = false;
      this.pod.group.removeFromParent();
    }
    this.pod = null;
  }
}
