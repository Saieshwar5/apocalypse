import type * as THREE from 'three';
import type { SoundEffects } from '../audio/soundEffects';
import type { CameraRig } from '../camera/cameraRig';
import type { Explosions } from '../effects/explosions';
import type { Hud } from '../hud/hud';
import { formatCredits } from '../logic/contracts';
import type { ShipController } from '../ship/shipController';
import type { MissileLauncher } from '../weapons/missileLauncher';
import { loanNote, type Licence } from './licence';
import { deliverReplacementShip } from './shipRecovery';
import type { RadioNet } from './radioNet';

/** After the ship is destroyed, play continues this long so the player sees it. */
const SHIP_LOST_SECONDS = 2.5;

export interface ShipLossDependencies {
  ship: ShipController;
  missiles: MissileLauncher;
  licence: Licence;
  explosions: Explosions;
  sound: SoundEffects;
  cameraRig: CameraRig;
  hud: Hud;
  station: () => { position: THREE.Vector3; velocity: THREE.Vector3 } | null;
  /** Called when a replacement ship is in place, to reset effects tied to the old one. */
  onReplaced: () => void;
  radio: RadioNet;
}

/**
 * Losing the ship: the explosion, a pause to see it, then a replacement
 * delivered to Aegis if the pilot can pay (insurance and the emergency loan
 * help), or bankruptcy, which ends the career.
 */
export class ShipLoss {
  /** Why the career ended because of the ship (bankruptcy), once known. */
  failure: string | null = null;
  private cause: string | null = null;
  private timer = 0;

  constructor(private readonly deps: ShipLossDependencies) {}

  get shipActive(): boolean {
    return this.cause === null;
  }

  reset(): void {
    this.failure = null;
    this.cause = null;
    this.timer = 0;
  }

  destroy(cause: string): void {
    const { explosions, sound, cameraRig, hud, ship } = this.deps;
    explosions.spawnExplosion(ship.position, 1.6, 'fire');
    explosions.spawnRockChips(ship.position, 3);
    sound.explosion(0.7);
    cameraRig.addShake(1.2);
    this.cause = cause;
    this.timer = SHIP_LOST_SECONDS;
    this.deps.radio.moment('ship-lost');
    hud.showMessage(`Interceptor destroyed: ${cause.replace(/^The interceptor was /, '').toLowerCase()}`, 'danger', SHIP_LOST_SECONDS);
  }

  /** Counts down while the ship is lost, then replaces it or ends the career. */
  update(deltaSeconds: number): void {
    if (this.cause === null || this.failure !== null) {
      return;
    }
    this.timer -= deltaSeconds;
    if (this.timer > 0) {
      return;
    }
    const outcome = this.deps.licence.handleShipLoss();
    if (!outcome.replaced) {
      this.failure = outcome.reason;
      return;
    }
    deliverReplacementShip(this.deps.ship, this.deps.missiles, this.deps.cameraRig, this.deps.station());
    this.deps.onReplaced();
    this.cause = null;
    this.deps.hud.showMessage(`Replacement ship delivered: ${formatCredits(outcome.fee)}. Your reputation suffers.${loanNote(outcome.borrowed)}`, 'warning', 6);
  }
}
