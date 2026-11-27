import * as THREE from 'three';
import { SoundEffects } from '../audio/soundEffects';
import { CameraRig } from '../camera/cameraRig';
import { Explosions } from '../effects/explosions';
import { Hud } from '../hud/hud';
import { Radar } from '../hud/radar';
import { TargetOverlay } from '../hud/targetOverlay';
import { InputState } from '../input/inputState';
import { createSeededRandom } from '../logic/random';
import { GroundScene } from '../launch/groundScene';
import { LaunchCinematic } from '../launch/launchCinematic';
import { LAUNCH_SITE, OrbitInsertion, orbitPose } from '../launch/orbitInsertion';
import { RocketEffects } from '../launch/rocketEffects';
import { Earth, loadEarthTextures } from '../scene/earth';
import { loadModels } from '../scene/modelLibrary';
import { RenderPipeline } from '../scene/renderPipeline';
import { createStarfield, createSun } from '../scene/spaceBackdrop';
import { createShipModel, type ShipModel } from '../ship/shipModel';
import { ShipController } from '../ship/shipController';
import { GameSession } from './gameSession';
import { GameScreens } from './gameScreens';
import { PlaySession } from './playSession';

export type GamePhase = 'menu' | 'launch' | 'playing' | 'paused' | 'gameover';

export interface GameOptions {
  /** Skip the menu and pointer lock (used by automated browser checks). */
  autostart: boolean;
  skipLaunch: boolean;
}

const SUN_DIRECTION = new THREE.Vector3(1, 0.25, 0.45).normalize();
const MAX_FRAME_SECONDS = 1 / 20;

/** Owns the scene, the game phases and the per-frame update order. */
export class Game {
  phase: GamePhase = 'menu';
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.05, 6000);
  readonly session = new GameSession();
  private readonly pipeline: RenderPipeline;
  private readonly timer = new THREE.Timer();
  private readonly rng = createSeededRandom(Date.now() & 0xffffffff);
  private readonly input: InputState;
  private readonly sound = new SoundEffects();
  private readonly cameraRig = new CameraRig(this.camera);
  private readonly hud = new Hud();
  private readonly overlay: TargetOverlay;
  private readonly radar: Radar;
  private readonly screens: GameScreens;
  private readonly explosions = new Explosions();
  private shipModel!: ShipModel;
  private ship!: ShipController;
  private earth!: Earth;
  private play!: PlaySession;
  private launch!: LaunchCinematic;
  private ground!: GroundScene;
  private rocketEffects!: RocketEffects;
  private menuAngle = 0.8;

  constructor(private readonly options: GameOptions) {
    const canvas = document.querySelector<HTMLCanvasElement>('#scene');
    const overlayCanvas = document.querySelector<HTMLCanvasElement>('#overlay');
    const radarCanvas = document.querySelector<HTMLCanvasElement>('#radar');
    if (!canvas || !overlayCanvas || !radarCanvas) {
      throw new Error('index.html is missing the scene, overlay or radar canvas');
    }
    this.pipeline = new RenderPipeline(canvas, this.scene, this.camera);
    this.input = new InputState(canvas);
    this.overlay = new TargetOverlay(overlayCanvas);
    this.radar = new Radar(radarCanvas);
    this.screens = new GameScreens({
      onStart: () => this.startRun(),
      onResume: () => this.resume(),
      onRestart: () => this.startRun(),
    });
  }

  async load(): Promise<void> {
    const [textures, models] = await Promise.all([loadEarthTextures(this.pipeline.renderer), loadModels()]);
    this.earth = new Earth(textures, SUN_DIRECTION);
    this.shipModel = createShipModel(models.interceptor);
    this.ship = new ShipController(this.shipModel.group);
    this.cameraRig.setCockpitOffset(this.shipModel.cockpit);
    this.ground = new GroundScene(models, this.pipeline.renderer);
    const effects = new RocketEffects();
    effects.setViewportHeight(window.innerHeight);
    this.rocketEffects = effects;
    const orbit = new OrbitInsertion(models, this.earth, this.shipModel.group, this.cameraRig, effects);
    this.scene.add(orbit.booster);
    this.launch = new LaunchCinematic(this.ground, effects, orbit, this.cameraRig, this.camera, this.sound, {
      caption: (text) => this.screens.setCaption(text),
      fade: (opacity) => this.screens.setFade(opacity),
      useScene: (which) => this.pipeline.setScene(which === 'ground' ? this.ground.scene : this.scene),
    });

    const sun = createSun(SUN_DIRECTION);
    this.scene.environment = this.pipeline.createSpaceEnvironment(SUN_DIRECTION);
    this.scene.environmentIntensity = 0.9;
    this.scene.add(
      createStarfield(),
      sun.group,
      new THREE.AmbientLight(0x6a86b0, 0.15),
      // Earth-shine: soft blue light from below, reflected off the planet.
      new THREE.HemisphereLight(0x1a2233, 0x2f5f9e, 0.9),
      this.earth.group,
      this.shipModel.group,
      this.explosions.group,
    );
    this.play = new PlaySession({
      scene: this.scene,
      camera: this.camera,
      earth: this.earth,
      input: this.input,
      sound: this.sound,
      cameraRig: this.cameraRig,
      hud: this.hud,
      overlay: this.overlay,
      radar: this.radar,
      explosions: this.explosions,
      session: this.session,
      rng: this.rng,
      shipModel: this.shipModel,
      stationModel: models.station,
      ship: this.ship,
      setCockpitFrame: (visible) => this.screens.setCockpitFrame(visible),
    });
    this.shipModel.group.visible = false;

    window.addEventListener('resize', this.onResize);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    this.screens.showMenu();

    if (this.options.autostart) {
      this.startRun();
    }
    // Connecting to the document stops a huge delta after the tab was hidden.
    this.timer.connect(document);
    this.pipeline.renderer.setAnimationLoop(this.frame);
  }

  private startRun(): void {
    this.sound.unlock();
    this.session.reset();
    this.play.reset();
    this.explosions.clear();
    this.earth.reset(this.sunriseSpinAngle());
    this.shipModel.group.visible = true;
    this.cameraRig.view = 'chase';
    this.screens.setCockpitFrame(false);
    this.screens.hideAll();
    this.capturePointer();
    this.launch.start();
    this.phase = 'launch';
    this.hud.setVisible(false);
    this.screens.setCinematic(true);
    if (this.options.skipLaunch) {
      this.launch.skip();
    }
  }

  /**
   * Earth rotation at which the launch site sits just inside the morning
   * side, so the launch happens at sunrise with the ship in sunlight.
   */
  private sunriseSpinAngle(): number {
    const sunrise = Math.cos(THREE.MathUtils.degToRad(65));
    let bestAngle = 0;
    let bestError = Infinity;
    for (let step = 0; step < 360; step += 1) {
      const angle = (step / 360) * Math.PI * 2;
      this.earth.reset(angle);
      const now = this.earth.localToWorldDirection(LAUNCH_SITE).dot(SUN_DIRECTION);
      this.earth.reset(angle + 0.01);
      const later = this.earth.localToWorldDirection(LAUNCH_SITE).dot(SUN_DIRECTION);
      // Morning: the site is turning towards the sun.
      const error = Math.abs(now - sunrise) + (later > now ? 0 : 10);
      if (error < bestError) {
        bestError = error;
        bestAngle = angle;
      }
    }
    return bestAngle;
  }

  private resume(): void {
    this.screens.hideAll();
    this.input.clear();
    this.capturePointer();
    this.phase = 'playing';
  }

  private capturePointer(): void {
    if (!this.options.autostart) {
      this.input.requestPointerLock();
    }
  }

  private readonly frame = (timestamp: number): void => {
    this.timer.update(timestamp);
    const deltaSeconds = Math.min(this.timer.getDelta(), MAX_FRAME_SECONDS);
    switch (this.phase) {
      case 'menu':
        this.updateMenu(deltaSeconds);
        break;
      case 'launch':
        this.updateLaunch(deltaSeconds);
        break;
      case 'playing':
        this.updatePlaying(deltaSeconds);
        break;
      case 'paused':
        break;
      case 'gameover':
        this.updateMenu(deltaSeconds);
        break;
    }
    this.pipeline.render();
  };

  private updateMenu(deltaSeconds: number): void {
    this.menuAngle += deltaSeconds * 0.04;
    const position = new THREE.Vector3(Math.sin(this.menuAngle) * 30, 6, Math.cos(this.menuAngle) * 30);
    // Look slightly left of Earth so the planet sits right of the menu card.
    const right = new THREE.Vector3().crossVectors(position, new THREE.Vector3(0, 1, 0)).normalize();
    const lookAt = right.multiplyScalar(7);
    this.cameraRig.place(position, lookAt, new THREE.Vector3(0, 1, 0), deltaSeconds);
    this.earth.update(deltaSeconds);
    this.explosions.update(deltaSeconds);
    this.overlay.clear();
  }

  private updateLaunch(deltaSeconds: number): void {
    if (this.input.consumePress('Enter')) {
      this.launch.skip();
    }
    this.earth.update(deltaSeconds);
    this.launch.update(deltaSeconds);
    const throttle = this.launch.phase === 'orbit' ? 1 : 0;
    this.shipModel.setThrottle(throttle, throttle > 0);
    this.shipModel.update(this.timer.getElapsed());
    this.play.updateHudOnly(deltaSeconds);
    if (this.launch.done) {
      this.handOverControl();
    }
  }

  /** End of the launch: the player flies from the final orbit pose. */
  private handOverControl(): void {
    const pose = orbitPose(this.earth, 1);
    this.ship.reset(pose.position, pose.orientation, 2);
    this.cameraRig.snap();
    this.phase = 'playing';
    this.screens.setCinematic(false);
    this.hud.setVisible(true);
    this.play.beginDefence();
    this.hud.showMessage('In orbit. Defend Earth', 'success', 4);
  }

  private updatePlaying(deltaSeconds: number): void {
    this.play.update(deltaSeconds);
    if (this.play.campaign.orbitComplete) {
      this.endRun('Earth is through the debris field', true);
    } else if (this.session.integrity <= 0) {
      this.endRun('Earth has fallen');
    } else if (this.play.shipFailure) {
      this.endRun(this.play.shipFailure);
    }
  }

  private endRun(reason: string, victory = false): void {
    this.phase = 'gameover';
    this.input.releasePointerLock();
    this.hud.setVisible(false);
    this.screens.setCockpitFrame(false);
    this.shipModel.group.visible = false;
    this.sound.setEngine(0, false);
    this.screens.showGameOver({
      score: this.session.score,
      wavesCleared: this.session.wavesCleared,
      asteroidsDestroyed: this.session.asteroidsDestroyed,
      impacts: this.session.totalImpacts,
      citiesStanding: this.play.sites.citiesStanding,
      cityCount: this.play.sites.cityCount,
      reason,
      victory,
      integrity: this.session.integrity,
    });
    this.sound.setAtmosphere(0);
  }

  private readonly onResize = (): void => {
    this.pipeline.resize();
    this.overlay.resize();
    this.rocketEffects.setViewportHeight(window.innerHeight);
  };

  private readonly onPointerLockChange = (): void => {
    if (this.options.autostart || this.input.pointerLocked) {
      return;
    }
    // Losing the mouse (Esc, alt-tab) pauses play; the launch keeps running.
    if (this.phase === 'playing') {
      this.phase = 'paused';
      this.input.clear();
      this.sound.setEngine(0, false);
      this.screens.showPause();
    }
  };
}
