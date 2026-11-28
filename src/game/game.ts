import { CockpitInterior } from '../ship/cockpitInterior';
import { speedToKmPerSecond } from '../logic/units';
import { DamageEffects } from '../ship/damageEffects';
import * as THREE from 'three';
import { SoundEffects } from '../audio/soundEffects';
import { CameraRig } from '../camera/cameraRig';
import { Explosions } from '../effects/explosions';
import { Hud } from '../hud/hud';
import { Radar } from '../hud/radar';
import { TargetOverlay } from '../hud/targetOverlay';
import { InputState } from '../input/inputState';
import { orbitRating } from '../logic/orbitPlan';
import { createSeededRandom } from '../logic/random';
import { STAR_SYSTEMS, nextSystem } from '../logic/starSystems';
import { shareText, type RunRecord } from '../logic/bestRuns';
import { GroundScene } from '../launch/groundScene';
import { LaunchCinematic } from '../launch/launchCinematic';
import { pilotName } from '../logic/rivals';
import { LAUNCH_SITE, OrbitInsertion, orbitPose } from '../launch/orbitInsertion';
import { RocketEffects } from '../launch/rocketEffects';
import { EARTH_RADIUS, Earth, loadEarthTextures, type EarthTextures } from '../scene/earth';
import { generatePlanetTextures } from '../scene/proceduralPlanet';
import { loadModels } from '../scene/modelLibrary';
import { RenderPipeline } from '../scene/renderPipeline';
import { createMoon } from '../scene/moon';
import { createStarfield, createSun } from '../scene/spaceBackdrop';
import { createShipModel, type ShipModel } from '../ship/shipModel';
import { ShipController } from '../ship/shipController';
import { GameSession } from './gameSession';
import { GameScreens } from './gameScreens';
import { PlaySession } from './playSession';
import { saveRun } from './runHistory';
import { bindSettingsControls, loadSettings, type QualityPreference, type Settings } from './settings';
import { createSampler, effectiveQuality, sampleFrame, type GraphicsQuality } from '../logic/qualityTier';
import { EnvironmentLighting } from '../scene/environmentLighting';
import { SUN_DIRECTION } from '../scene/sunDirection';
import { RadioNet } from './radioNet';
import { DEFAULT_CALL_SIGN } from '../logic/cast';
import { PilotCareer } from './pilotCareer';
import { FrameStats } from '../scene/frameStats';

export type GamePhase = 'menu' | 'launch' | 'playing' | 'paused' | 'gameover';

export interface GameOptions {
  /** Skip the menu and pointer lock (used by automated browser checks). */
  autostart: boolean;
  skipLaunch: boolean;
  /** Start with the guided training flight (?training). */
  training?: boolean;
}

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
  private damage!: DamageEffects;
  private readonly cockpit = new CockpitInterior();
  private environment!: EnvironmentLighting;
  private readonly frameStats = new FrameStats(new URLSearchParams(window.location.search).has('fps'));
  private readonly qualitySampler = createSampler();
  private qualityPreference: QualityPreference = 'auto';
  private autoQuality: GraphicsQuality = 'high';
  private callSign = DEFAULT_CALL_SIGN;
  private hardcore = false;
  private readonly radio = new RadioNet({ hud: this.hud, sound: this.sound, callSign: () => this.callSign, rank: () => this.career.rank });
  private career!: PilotCareer;
  private shipModel!: ShipModel;
  private ship!: ShipController;
  private earth!: Earth;
  private play!: PlaySession;
  private launch!: LaunchCinematic;
  private ground!: GroundScene;
  private rocketEffects!: RocketEffects;
  private menuAngle = 0.8;
  private systemIndex = 0;
  private earthTextures!: EarthTextures;
  private readonly colonyTextures = new Map<string, EarthTextures>();
  private sunLight!: THREE.DirectionalLight;
  private lastRun: RunRecord | null = null;

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
    this.hud.onUrgent = (text) => this.sound.announce(text);
    this.radar = new Radar(radarCanvas);
    this.screens = new GameScreens({
      onStart: () => this.startRun(0),
      onTraining: () => this.startRun(0, true),
      onResume: () => this.resume(),
      onRestart: () => this.startRun(0),
      onNext: () => this.startRun(this.systemIndex + 1),
      onShare: () => this.copyResult(),
    });
  }

  async load(): Promise<void> {
    const [textures, models] = await Promise.all([loadEarthTextures(this.pipeline.renderer), loadModels()]);
    this.earthTextures = textures;
    this.earth = new Earth(textures, SUN_DIRECTION);
    this.shipModel = createShipModel(models.interceptor);
    this.damage = new DamageEffects(this.shipModel.bounds);
    // The cockpit hangs from the camera, so the camera joins the scene.
    this.camera.add(this.cockpit.group);
    this.scene.add(this.camera);
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
    this.sunLight = sun.light;
    this.environment = new EnvironmentLighting(this.pipeline.renderer, this.scene, SUN_DIRECTION, this.earth.dayMap);
    this.scene.environmentIntensity = 1.35;
    this.scene.add(
      createStarfield(),
      sun.group,
      new THREE.AmbientLight(0x6a86b0, 0.15),
      // Earth-shine: soft blue light from below, reflected off the planet.
      // Kept weak: the reflection map now carries the real, direction-dependent earthshine.
      new THREE.HemisphereLight(0x1a2233, 0x2f5f9e, 0.6),
      this.earth.group,
      createMoon(new THREE.Vector3(-0.55, 0.2, 0.8)),
      this.shipModel.group,
      this.explosions.group,
      this.damage.group,
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
      satellitesModel: models.satellites,
      outpostModels: { vulcan: models.vulcan, ceres: models.ceres, halo: models.halo },
      shipSource: models.interceptor,
      ship: this.ship,
      setCockpitFrame: (visible) => this.cockpit.setVisible(visible),
      radio: this.radio,
      onTrainingComplete: () => this.career.markTrainingDone(),
    });
    this.career = new PilotCareer({ session: this.session, hud: this.hud, sound: this.sound, input: this.input, radio: this.radio, showModules: (fitted) => this.shipModel.setModules(fitted) });
    this.career.attach(this.play);
    this.shipModel.group.visible = false;

    window.addEventListener('resize', this.onResize);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    const applySettings = (settings: Settings): void => {
      this.ship.lookSensitivity = settings.sensitivity;
      this.qualityPreference = settings.quality;
      this.callSign = settings.callSign;
      this.hardcore = settings.hardcore;
      this.pipeline.setQuality(effectiveQuality(settings.quality, this.autoQuality));
      this.overlay.resize();
    };
    const settings = loadSettings();
    applySettings(settings);
    bindSettingsControls(settings, applySettings);
    this.screens.showMenu();
    this.showRank();

    if (this.options.autostart) {
      this.startRun(0, this.options.training === true);
    }
    // Connecting to the document stops a huge delta after the tab was hidden.
    this.timer.connect(document);
    this.pipeline.renderer.setAnimationLoop(this.frame);
  }

  /** Starts a run in the given star system; systems after the first continue the campaign. */
  private startRun(systemIndex: number, training = false): void {
    const system = STAR_SYSTEMS[systemIndex] ?? STAR_SYSTEMS[0];
    const continuing = systemIndex > 0 && system === STAR_SYSTEMS[systemIndex];
    this.systemIndex = continuing ? systemIndex : 0;
    this.sound.unlock();
    if (continuing) {
      this.session.resetForNextSystem();
    } else {
      this.session.reset();
    }
    this.play.reset(system, continuing, training);
    this.career.startRun(this.hardcore && !training);
    this.applySystemLook();
    this.radio.reset();
    this.explosions.clear();
    this.damage.clear();
    this.earth.reset(this.sunriseSpinAngle());
    this.shipModel.group.visible = true;
    this.cameraRig.view = 'chase';
    this.cockpit.setVisible(false);
    this.screens.hideAll();
    this.capturePointer();
    this.launch.start();
    this.phase = 'launch';
    this.hud.setVisible(false);
    this.screens.setCinematic(true);
    // Only Earth has a launch pad; colonies are reached by jump.
    if (this.options.skipLaunch || continuing) {
      this.launch.skip();
    }
  }

  /** Planet surface, star colour and HUD label for the current system. */
  private applySystemLook(): void {
    const system = STAR_SYSTEMS[this.systemIndex];
    let textures = this.earthTextures;
    if (system.surface) {
      textures = this.colonyTextures.get(system.id) ?? generatePlanetTextures(system.surface, system.sites);
      this.colonyTextures.set(system.id, textures);
    }
    this.earth.setTextures(textures);
    this.environment.setDayMap(textures.day);
    this.sunLight.color.setRGB(...system.starColor);
    const label = document.querySelector('#planet-label');
    if (label) {
      label.textContent = `${system.planet} integrity`;
    }
  }

  private copyResult(): void {
    if (!this.lastRun) {
      return;
    }
    const text = shareText(this.lastRun);
    // Clipboard access can be refused; the text is also shown so it can be copied by hand.
    navigator.clipboard?.writeText(text).then(
      () => this.screens.setShareStatus('Copied'),
      () => this.screens.setShareStatus(text),
    ) ?? this.screens.setShareStatus(text);
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
    const realSeconds = this.timer.getDelta();
    const deltaSeconds = Math.min(realSeconds, MAX_FRAME_SECONDS);
    this.measureFrame(realSeconds);
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
    this.environment.update(deltaSeconds, this.camera.position, EARTH_RADIUS, this.earth.worldOrientation());
    this.pipeline.render();
  };

  /** Automatic quality and the optional frame-rate readout (?fps). */
  private measureFrame(realSeconds: number): void {
    this.frameStats.record(realSeconds);
    if (this.phase !== 'playing' || this.qualityPreference !== 'auto') {
      return;
    }
    const verdict = sampleFrame(this.qualitySampler, realSeconds);
    if (verdict === 'low' && this.autoQuality !== 'low') {
      this.autoQuality = 'low';
      this.pipeline.setQuality('low');
      this.overlay.resize();
      this.hud.showMessage('Graphics lowered for smoother play. Change it in the pause menu (Esc)', 'info', 4);
    }
  }

  private updateMenu(deltaSeconds: number): void {
    this.menuAngle += deltaSeconds * 0.04;
    const position = new THREE.Vector3(Math.sin(this.menuAngle) * 118, 22, Math.cos(this.menuAngle) * 118);
    // Look slightly left of Earth so the planet sits right of the menu card.
    const right = new THREE.Vector3().crossVectors(position, new THREE.Vector3(0, 1, 0)).normalize();
    const lookAt = right.multiplyScalar(27);
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
    this.hud.showMessage(STAR_SYSTEMS[this.systemIndex].briefing, 'success', 5);
  }

  private updatePlaying(deltaSeconds: number): void {
    this.play.update(deltaSeconds);
    this.career.update(deltaSeconds);
    this.damage.update(deltaSeconds, this.ship.hull, this.shipModel.group, this.ship.velocity, this.play.shipActive);
    this.updateCockpit(deltaSeconds);
    // Solar storms light up the auroras; a warning makes them start to stir.
    const weather = this.play.services.weather.phase;
    this.earth.setAuroraStrength(weather === 'storm' ? 2.2 : weather === 'warning' ? 1.4 : 1);
    this.radio.update(deltaSeconds);
    if (this.play.campaign.orbitComplete) {
      this.endRun(`${STAR_SYSTEMS[this.systemIndex].planet} is through the debris field`, true);
    } else if (this.session.integrity <= 0) {
      this.endRun(`${STAR_SYSTEMS[this.systemIndex].planet} has fallen`);
    } else if (this.play.licence.recalled) {
      this.endRun('Licence revoked: you have been recalled to Earth');
    } else if (this.play.services.debris.health <= 0) {
      this.endRun('The Singularity: debris has multiplied out of control and closed Earth\'s orbit');
    } else if (this.play.shipFailure) {
      this.endRun(this.play.shipFailure);
    }
  }

  private updateCockpit(deltaSeconds: number): void {
    const { ship, play } = this;
    const job = play.services.jobRows()[0];
    const alert = ship.hull < 30 || ship.fuel < ship.fuelCapacity * 0.15 || play.services.weather.phase === 'storm';
    this.cockpit.update(deltaSeconds, {
      speedKmS: speedToKmPerSecond(ship.velocity.length()),
      fuel: (ship.fuel / ship.fuelCapacity) * 100,
      hull: ship.hull,
      shield: (ship.shield / ship.shieldCapacity) * 100,
      missiles: `${play.missiles.ammunition}/${play.missiles.capacity}`,
      status: play.services.berths.holding || play.stationOps.holdingShip ? 'BERTHED' : ship.boosting ? 'BOOST' : ship.throttle > 0.5 ? 'THRUST' : 'COASTING',
      job: job ? `${job.title} ${job.detail}` : 'No work posted',
      alert,
    });
  }

  private showRank(): void {
    this.screens.setRank(this.career.rankLine());
  }

  private endRun(reason: string, victory = false): void {
    this.phase = 'gameover';
    this.input.releasePointerLock();
    this.hud.setVisible(false);
    this.cockpit.setVisible(false);
    this.shipModel.group.visible = false;
    this.sound.setEngine(0, false);
    const system = STAR_SYSTEMS[this.systemIndex];
    const { citiesStanding, cityCount } = this.play.sites;
    this.lastRun = {
      earned: this.session.wallet.earned,
      planet: system.planet,
      victory,
      stars: orbitRating(this.session.integrity, citiesStanding, cityCount),
      citiesStanding,
      cityCount,
      date: new Date().toISOString().slice(0, 10),
    };
    const next = victory ? nextSystem(this.systemIndex) : null;
    this.screens.showGameOver({
      planet: system.planet,
      nextStar: next?.star ?? null,
      bestRuns: saveRun(this.lastRun),
      current: this.lastRun,
      earned: this.session.wallet.earned,
      spent: this.session.wallet.spent,
      balance: this.session.wallet.balance,
      contractsCompleted: this.play.contracts.contractsCompleted,
      contractsLost: this.play.contracts.contractsLost,
      orbitHealth: this.play.services.debris.health,
      reputation: this.play.licence.reputation,
      licence: this.play.licence.stage,
      shipsLost: this.play.licence.shipsLost,
      rank: this.career.recordRun(this.session.wallet.earned, victory && this.play.licence.stage === 'good'),
      medals: this.career.runMedals(),
      hardcore: this.session.hardcore,
      debrisSwept: this.play.services.debris.swept,
      league: this.session.league().map(({ pilot, earned }) => ({ name: pilotName(pilot), earned, you: pilot === 'player' })),
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
    this.showRank();
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
