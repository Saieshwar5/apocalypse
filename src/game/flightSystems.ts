import type * as THREE from 'three';
import type { SoundEffects } from '../audio/soundEffects';
import type { Hud } from '../hud/hud';
import type { Radar } from '../hud/radar';
import type { TargetOverlay } from '../hud/targetOverlay';
import type { InputState } from '../input/inputState';
import type { RandomSource } from '../logic/random';
import type { Earth } from '../scene/earth';
import type { ShipController } from '../ship/shipController';
import type { ShipModel } from '../ship/shipModel';
import type { GameSession } from './gameSession';
import { HelpDesk } from './helpDesk';
import { adviceFor } from './helpFeed';
import { Navigation } from './navigation';
import { PilotCareer } from './pilotCareer';
import type { PlaySession } from './playSession';
import type { RadioNet } from './radioNet';
import { WorldLayer } from './worldLayer';

export interface FlightSystemsDependencies {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  earth: Earth;
  play: PlaySession;
  session: GameSession;
  ship: ShipController;
  shipModel: ShipModel;
  input: InputState;
  hud: Hud;
  overlay: TargetOverlay;
  radar: Radar;
  sound: SoundEffects;
  radio: RadioNet;
  rng: RandomSource;
  /** Freezes flight without the pause screen; resumes; shows or hides the pause screen. */
  pause: () => void;
  resume: () => void;
  showPause: () => void;
  hidePause: () => void;
  /** Hides or shows the HUD, overlay and cockpit (photo mode). */
  setInterface: (visible: boolean) => void;
}

/**
 * The systems that fly alongside a run: the career (hangar, medals,
 * logbook), help, navigation and the living world. Keeps the game's own
 * loop short: one call before the play session updates, one after.
 */
export class FlightSystems {
  readonly career: PilotCareer;
  readonly navigation: Navigation;
  readonly help: HelpDesk;
  readonly world: WorldLayer;

  constructor(private readonly deps: FlightSystemsDependencies) {
    const { play, ship, input, hud, sound, radio, session } = deps;
    this.career = new PilotCareer({ session, hud, sound, input, radio, showModules: (fitted) => deps.shipModel.setModules(fitted) });
    this.career.attach(play);
    this.navigation = new Navigation({ play, ship, input, hud, overlay: deps.overlay, radar: deps.radar, session });
    this.help = new HelpDesk({
      input,
      hud,
      advice: () => adviceFor(play, ship, this.navigation),
      pause: deps.pause,
      resume: deps.resume,
      showPause: deps.showPause,
      hidePause: deps.hidePause,
    });
    this.world = new WorldLayer({
      scene: deps.scene,
      camera: deps.camera,
      earth: deps.earth,
      play,
      career: this.career,
      input,
      hud,
      sound,
      radio,
      rng: deps.rng,
      wallet: session.wallet,
      ship: () => deps.shipModel.group,
      setInterface: deps.setInterface,
    });
  }

  startRun(hardcore: boolean, training: boolean): void {
    this.career.startRun(hardcore && !training);
    this.world.reset();
    this.navigation.reset();
    this.deps.hud.newPilot = training || this.career.record.runs < 2;
  }

  /** Before the play session updates. False when play should stay frozen (help or photo mode). */
  beforePlay(deltaSeconds: number, stillPlaying: () => boolean): boolean {
    const { play } = this.deps;
    this.help.update();
    if (!stillPlaying()) {
      return false;
    }
    if (this.world.update(deltaSeconds, play.shipActive)) {
      return false;
    }
    this.navigation.update(deltaSeconds, play.shipActive && !play.tactical);
    return true;
  }

  /** After the play session has updated and drawn. */
  afterPlay(deltaSeconds: number): void {
    this.navigation.draw();
    this.career.update(deltaSeconds);
  }
}
