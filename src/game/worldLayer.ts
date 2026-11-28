import type { Wallet } from '../logic/economy';
import type * as THREE from 'three';
import type { SoundEffects } from '../audio/soundEffects';
import type { Hud } from '../hud/hud';
import type { InputState } from '../input/inputState';
import type { RandomSource } from '../logic/random';
import type { Earth } from '../scene/earth';
import { LivingWorld } from './livingWorld';
import { PhotoMode } from './photoMode';
import type { PilotCareer } from './pilotCareer';
import type { PlaySession } from './playSession';
import type { RadioNet } from './radioNet';

export interface WorldLayerDependencies {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  earth: Earth;
  play: PlaySession;
  career: PilotCareer;
  input: InputState;
  hud: Hud;
  sound: SoundEffects;
  radio: RadioNet;
  rng: RandomSource;
  wallet: Wallet;
  ship: () => THREE.Object3D;
  /** Hides or shows the HUD, overlay and cockpit for photo mode. */
  setInterface: (visible: boolean) => void;
  onLaunch?: (site: string) => void;
}

/**
 * Joins the living world (launches, meteor showers, spacewalkers, the
 * derelict probe) and photo mode to a run: it notices calm zones starting
 * and handles the P key.
 */
export class WorldLayer {
  readonly world: LivingWorld;
  readonly photo: PhotoMode;
  private lastPhase = '';

  constructor(private readonly deps: WorldLayerDependencies) {
    const { play } = deps;
    this.world = new LivingWorld({
      scene: deps.scene,
      earth: deps.earth,
      outposts: play.services.outposts,
      ship: { get position() { return deps.ship().position; } },
      wallet: deps.wallet,
      hud: deps.hud,
      sound: deps.sound,
      radio: deps.radio,
      rng: deps.rng,
      discover: (id) => deps.career.discover(id),
      note: (text) => deps.career.note(text),
      onLaunch: deps.onLaunch,
    });
    this.photo = new PhotoMode({
      camera: deps.camera,
      input: deps.input,
      subject: deps.ship,
      setInterface: deps.setInterface,
      shutter: () => this.world.takePhoto(),
    });
  }

  reset(): void {
    if (this.photo.active) {
      this.photo.exit();
    }
    this.world.reset();
    this.lastPhase = '';
  }

  /** Returns true while photo mode has the frame, so play stays frozen. */
  update(deltaSeconds: number, canToggle: boolean): boolean {
    const { input, play } = this.deps;
    if (canToggle && input.consumePress('KeyP')) {
      this.photo.toggle();
    }
    if (this.photo.active) {
      this.photo.update(deltaSeconds);
      return true;
    }
    const phase = play.campaign.director.phase;
    if (phase === 'calm' && this.lastPhase !== 'calm' && this.lastPhase !== '') {
      this.world.calmZone();
    }
    this.lastPhase = phase;
    this.world.update(deltaSeconds, play.shipActive);
    return false;
  }
}
