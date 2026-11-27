import * as THREE from 'three';
import { AsteroidField } from '../asteroids/asteroidField';
import { SoundEffects } from '../audio/soundEffects';
import { CameraRig } from '../camera/cameraRig';
import { Explosions } from '../effects/explosions';
import { Hud } from '../hud/hud';
import { Radar } from '../hud/radar';
import { TargetOverlay } from '../hud/targetOverlay';
import { InputState } from '../input/inputState';
import { createSeededRandom } from '../logic/random';
import { waveClearBonus } from '../logic/scoring';
import { rankThreats } from '../logic/threats';
import { orientationFromForward } from '../math/orientation';
import { EARTH_RADIUS, Earth, loadEarthTextures } from '../scene/earth';
import { RenderPipeline } from '../scene/renderPipeline';
import { createStarfield, createSun } from '../scene/spaceBackdrop';
import { createShipModel, type ShipModel } from '../ship/shipModel';
import { IDLE_INPUT, ShipController, type FlightInput } from '../ship/shipController';
import { LaserCannon } from '../weapons/laserCannon';
import { MissileLauncher } from '../weapons/missileLauncher';
import { CombatResolver } from './combatResolver';
import { GameSession } from './gameSession';
import { LAUNCH_SITE, LaunchSequence, ORBIT_ALTITUDE, ORBIT_NOSE_DOWN } from './launchSequence';
import { GameScreens } from './gameScreens';
import { WaveDirector, type WaveEvent } from './waveDirector';

export type GamePhase = 'menu' | 'launch' | 'playing' | 'paused' | 'gameover';

export interface GameOptions {
  /** Skip the menu and pointer lock (used by automated browser checks). */
  autostart: boolean;
  skipLaunch: boolean;
}

const SUN_DIRECTION = new THREE.Vector3(1, 0.25, 0.45).normalize();
const RESPAWN_SECONDS = 5;
/** Missiles delivered by supply rocket after each wave, until the space base exists. */
const MISSILES_PER_RESUPPLY = 3;
const AIM_DISTANCE = 70;
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
  private readonly laser = new LaserCannon();
  private readonly missiles = new MissileLauncher();
  private readonly director = new WaveDirector(this.rng);
  private readonly shipModel: ShipModel = createShipModel();
  private readonly ship = new ShipController(this.shipModel.group);
  private earth!: Earth;
  private field!: AsteroidField;
  private combat!: CombatResolver;
  private launch!: LaunchSequence;
  private respawnTimer = 0;
  private menuAngle = 0.8;
  private lastCountdown = -1;

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
    const textures = await loadEarthTextures(this.pipeline.renderer);
    this.earth = new Earth(textures, SUN_DIRECTION);
    this.field = new AsteroidField(EARTH_RADIUS, this.rng);
    this.launch = new LaunchSequence(this.earth, this.shipModel.group, this.cameraRig);
    this.combat = new CombatResolver({
      field: this.field,
      earth: this.earth,
      explosions: this.explosions,
      sound: this.sound,
      hud: this.hud,
      cameraRig: this.cameraRig,
      session: this.session,
      rng: this.rng,
    });

    const sun = createSun(SUN_DIRECTION);
    this.scene.environment = this.pipeline.createSpaceEnvironment(SUN_DIRECTION);
    this.scene.environmentIntensity = 0.9;
    this.scene.add(
      createStarfield(),
      sun.group,
      new THREE.AmbientLight(0x6a86b0, 0.15),
      this.earth.group,
      this.field.group,
      this.shipModel.group,
      this.laser.group,
      this.missiles.group,
      this.explosions.group,
    );
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
    this.field.clear();
    this.explosions.clear();
    this.laser.reset();
    this.missiles.reset();
    this.earth.reset(this.sunriseSpinAngle());
    this.director.reset();
    this.respawnTimer = 0;
    this.lastCountdown = -1;
    this.shipModel.group.visible = true;
    this.cameraRig.view = 'chase';
    this.screens.setCockpitFrame(false);
    this.screens.hideAll();
    this.hud.setVisible(true);
    this.capturePointer();
    this.launch.start();
    this.phase = 'launch';
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
    this.shipModel.setThrottle(this.launch.throttle, this.launch.phase === 'ascent');
    this.shipModel.update(this.timer.getElapsed());
    this.sound.setEngine(this.launch.throttle, this.launch.phase === 'ascent');

    const countdown = this.launch.countdown;
    if (this.launch.phase === 'countdown' && countdown !== this.lastCountdown) {
      this.lastCountdown = countdown;
      this.hud.showMessage(`Launch in ${countdown}`, 'info', 1.1);
    } else if (this.launch.phase === 'ascent' && this.lastCountdown !== 0) {
      this.lastCountdown = 0;
      this.hud.showMessage('Liftoff. Interceptor climbing to orbit', 'success', 3);
      this.cameraRig.addShake(0.7);
    }
    this.updateHud(deltaSeconds, false);

    if (this.launch.phase === 'complete') {
      const pose = this.launch.finalPose();
      this.ship.reset(pose.position, pose.orientation, 2);
      this.cameraRig.snap();
      this.phase = 'playing';
      this.director.reset(6);
      this.hud.showMessage('Orbit reached. Defend Earth', 'success', 4);
      this.sound.chime();
    }
  }

  private updatePlaying(deltaSeconds: number): void {
    this.handleSystemKeys();
    const shipActive = this.respawnTimer <= 0;
    this.ship.update(deltaSeconds, shipActive ? this.readFlightInput() : IDLE_INPUT, EARTH_RADIUS);
    this.shipModel.group.updateMatrixWorld();

    if (shipActive) {
      this.updateWeapons(deltaSeconds);
    } else {
      this.updateRespawn(deltaSeconds);
    }

    const impacts = this.field.update(deltaSeconds);
    this.combat.resolvePlanetImpacts(impacts, this.camera.position);
    this.combat.resolveWeaponHits(this.laser.update(deltaSeconds, this.field.all, EARTH_RADIUS), 'laser');
    this.combat.resolveWeaponHits(this.missiles.update(deltaSeconds, this.field.all, EARTH_RADIUS), 'missile');
    if (shipActive && this.combat.resolveShipCollisions(this.ship)) {
      this.destroyShip();
    }
    this.handleWaveEvents(this.director.update(deltaSeconds, this.field.count));

    this.earth.update(deltaSeconds);
    this.explosions.update(deltaSeconds);
    this.shipModel.setThrottle(this.ship.throttle, this.ship.boosting);
    this.shipModel.update(this.timer.getElapsed());
    this.sound.setEngine(shipActive ? this.ship.throttle : 0, this.ship.boosting);

    this.cameraRig.follow(this.shipModel.group, deltaSeconds, this.ship.boosting);
    // In the cockpit the hull would block the view.
    this.shipModel.group.visible = shipActive && this.cameraRig.view === 'chase';
    this.updateHud(deltaSeconds, shipActive);

    if (this.session.integrity <= 0) {
      this.endRun();
    }
  }

  private readFlightInput(): FlightInput {
    const input = this.input;
    const axis = (positive: string[], negative: string[]) =>
      (positive.some((code) => input.isDown(code)) ? 1 : 0) - (negative.some((code) => input.isDown(code)) ? 1 : 0);
    return {
      look: input.consumeLook(),
      thrust: axis(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']),
      strafe: axis(['KeyD', 'ArrowRight'], ['KeyA', 'ArrowLeft']),
      roll: axis(['KeyE'], ['KeyQ']),
      boost: input.isDown('ShiftLeft') || input.isDown('ShiftRight'),
    };
  }

  private handleSystemKeys(): void {
    if (this.input.consumePress('KeyC')) {
      const view = this.cameraRig.toggleView();
      this.screens.setCockpitFrame(view === 'cockpit');
      this.cameraRig.snap();
    }
    if (this.input.consumePress('KeyM')) {
      this.hud.showMessage(this.sound.toggleMute() ? 'Sound off' : 'Sound on', 'info', 1.5);
    }
  }

  private updateWeapons(deltaSeconds: number): void {
    const group = this.shipModel.group;
    if (this.laser.tryFire(deltaSeconds, this.input.firingPrimary, group, this.ship.velocity, this.shipModel.gunPorts)) {
      this.sound.laser();
    }
    this.missiles.updateLock(group, this.field.all);
    if (this.input.consumePress('KeyF') || this.input.consumePress('MouseRight')) {
      if (this.missiles.tryFire(group, this.ship.velocity)) {
        this.sound.missile();
      } else if (this.missiles.ammunition === 0) {
        this.hud.showMessage('No missiles left. A supply rocket arrives after this wave', 'warning', 2.5);
      }
    }
  }

  private destroyShip(): void {
    this.explosions.spawnExplosion(this.ship.position, 1.2, 'fire');
    this.sound.explosion(0.5);
    this.cameraRig.addShake(1);
    this.respawnTimer = RESPAWN_SECONDS;
    this.hud.showMessage(`Interceptor lost. Relaunching in ${RESPAWN_SECONDS} s`, 'danger', RESPAWN_SECONDS);
  }

  private updateRespawn(deltaSeconds: number): void {
    this.respawnTimer -= deltaSeconds;
    this.ship.velocity.multiplyScalar(0.9);
    if (this.respawnTimer > 0) {
      return;
    }
    const up = this.earth.localToWorldDirection(LAUNCH_SITE);
    const east = new THREE.Vector3().crossVectors(this.earth.northAxis(), up).normalize();
    const forward = east.multiplyScalar(Math.cos(ORBIT_NOSE_DOWN)).addScaledVector(up, -Math.sin(ORBIT_NOSE_DOWN));
    const position = up.clone().multiplyScalar(EARTH_RADIUS + ORBIT_ALTITUDE);
    this.ship.reset(position, orientationFromForward(forward, up), 2);
    this.cameraRig.snap();
    this.hud.showMessage('Interceptor back in orbit', 'success', 2);
  }

  private handleWaveEvents(events: readonly WaveEvent[]): void {
    for (const event of events) {
      if (event.type === 'wave-started') {
        this.session.impactsThisWave = 0;
        this.session.destroyedThisWave = 0;
        if (event.plan.hasGiant) {
          this.hud.showMessage(`Wave ${event.plan.wave}: giant asteroid detected. Intercept it far out`, 'danger', 5);
          this.sound.alarm();
        } else {
          this.hud.showMessage(`Wave ${event.plan.wave} incoming: ${event.plan.spawns.length} contacts`, 'warning', 3.5);
        }
      } else if (event.type === 'spawn') {
        this.field.spawnIncoming(event.spawn.size, event.spawn.material, event.spawn.direction);
      } else {
        const bonus = waveClearBonus(event.wave, this.session.destroyedThisWave, this.session.impactsThisWave);
        this.session.score += bonus;
        this.session.wavesCleared += 1;
        const clean = this.session.impactsThisWave === 0 ? ' Earth untouched.' : '';
        const reward = bonus > 0 ? ` +${bonus} points.` : '';
        const loaded = this.missiles.resupply(MISSILES_PER_RESUPPLY);
        const supply = loaded > 0 ? ` Supply rocket: +${loaded} missiles.` : '';
        this.hud.showMessage(`Wave ${event.wave} over.${reward}${clean}${supply}`, 'success', 5);
        this.sound.chime();
      }
    }
  }

  private updateHud(deltaSeconds: number, showTargets: boolean): void {
    const threats = rankThreats(this.field.all);
    this.hud.update(deltaSeconds, {
      integrity: this.session.integrity,
      wave: Math.max(1, this.director.wave),
      score: this.session.score,
      threats,
      laserHeat: this.laser.heat,
      overheated: this.laser.overheated,
      missiles: this.missiles.ammunition,
      boost: this.ship.boostEnergy,
      hull: this.ship.hull,
      speed: this.ship.velocity.length(),
    });
    const urgent = new Set(threats.slice(0, 3).filter((threat) => threat.timeToImpact !== null).map((threat) => threat.id));
    this.radar.draw(deltaSeconds, this.shipModel.group, this.field.all, urgent, this.missiles.lockedTarget?.id ?? null, EARTH_RADIUS);
    if (!showTargets) {
      this.overlay.clear();
      return;
    }
    const aim = new THREE.Vector3(0, 0, -AIM_DISTANCE).applyMatrix4(this.shipModel.group.matrixWorld);
    this.camera.updateMatrixWorld();
    this.overlay.draw(deltaSeconds, this.camera, aim, this.laser.overheated, threats, this.missiles.lockedTarget);
  }

  private endRun(): void {
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
    });
  }

  private readonly onResize = (): void => {
    this.pipeline.resize();
    this.overlay.resize();
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
