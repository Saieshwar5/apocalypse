import * as THREE from 'three';
import { AsteroidField, type Asteroid } from '../asteroids/asteroidField';
import { ThreatVisuals } from '../asteroids/threatVisuals';
import type { SoundEffects } from '../audio/soundEffects';
import type { CameraRig } from '../camera/cameraRig';
import type { Explosions } from '../effects/explosions';
import { ImpactPlumes } from '../effects/impactPlumes';
import { ScorchMarks } from '../effects/scorchMarks';
import { SpaceDust } from '../effects/spaceDust';
import { CombatFeedback } from '../hud/combatFeedback';
import type { Hud } from '../hud/hud';
import { SCANNER_RANGE, type Radar } from '../hud/radar';
import type { TargetOverlay } from '../hud/targetOverlay';
import type { InputState } from '../input/inputState';
import { altitudeReadout } from '../logic/atmosphere';
import { siteTargetingChance } from '../logic/prioritySites';
import { randomUnitVector, type RandomSource } from '../logic/random';
import type { AsteroidSpawnPlan } from '../logic/waves';
import { waveClearBonus } from '../logic/scoring';
import { SHIELD_CAPACITY } from '../logic/shipDefense';
import { rankThreats } from '../logic/threats';
import { damping } from '../math/orientation';
import { EARTH_RADIUS, type Earth } from '../scene/earth';
import { ShieldBubble } from '../ship/shieldBubble';
import { IDLE_INPUT, type FlightInput, type ShipController } from '../ship/shipController';
import type { ShipModel } from '../ship/shipModel';
import { LaserCannon } from '../weapons/laserCannon';
import { MissileLauncher } from '../weapons/missileLauncher';
import { SiteDefence } from '../sites/siteDefence';
import { SiteMarkers } from '../sites/siteMarkers';
import { CombatResolver } from './combatResolver';
import { FlightHazards } from './flightHazards';
import type { GameSession } from './gameSession';
import { computeTargeting, type TargetingInfo } from './targeting';
import { WaveDirector, type WaveEvent } from './waveDirector';

/** After the ship is destroyed, play continues this long so the player sees it. */
const SHIP_LOST_SECONDS = 2.5;
/** Hints shown in the first minute: [from second, to second, text]. */
const TIPS: readonly [number, number, string][] = [
  [1, 9, 'Tip: the 3D scanner shows contacts on stalks. Stalk up means above you'],
  [9, 17, 'Tip: red rings on Earth mark where asteroids will land. Guard the labelled sites'],
  [17, 25, 'Tip: press Tab for the tactical map. Time slows while it is open'],
  [25, 33, 'Tip: stay out of the atmosphere. Watch "Above atmosphere" on the left'],
];
/** Missiles delivered by supply rocket after each wave, until the space base exists. */
const MISSILES_PER_RESUPPLY = 3;
const AIM_DISTANCE = 70;
/** Time runs this much slower while the tactical map is open. */
const TACTICAL_TIME_SCALE = 0.3;
const TACTICAL_DISTANCE = 120;
const TACTICAL_LOOK_SENSITIVITY = 0.004;

export interface PlaySessionDependencies {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  earth: Earth;
  input: InputState;
  sound: SoundEffects;
  cameraRig: CameraRig;
  hud: Hud;
  overlay: TargetOverlay;
  radar: Radar;
  explosions: Explosions;
  session: GameSession;
  rng: RandomSource;
  shipModel: ShipModel;
  ship: ShipController;
  /** Shows or hides the cockpit frame overlay. */
  setCockpitFrame: (visible: boolean) => void;
}

/**
 * Everything that happens while flying: ship, weapons, asteroids, waves,
 * combat, targeting, the tactical map and the in-flight HUD. The Game class
 * owns the phases around it (menu, launch, pause, game over).
 */
export class PlaySession {
  readonly field: AsteroidField;
  readonly laser = new LaserCannon();
  readonly missiles = new MissileLauncher();
  readonly director: WaveDirector;
  readonly combat: CombatResolver;
  tactical = false;
  private readonly visuals = new ThreatVisuals(EARTH_RADIUS);
  private readonly dust = new SpaceDust();
  private readonly scorches = new ScorchMarks();
  private readonly feedback = new CombatFeedback();
  private readonly shield = new ShieldBubble();
  readonly sites: SiteDefence;
  private readonly siteMarkers: SiteMarkers;
  private readonly plumes: ImpactPlumes;
  private readonly hazards: FlightHazards;
  /** Why the mission failed because of the ship, once the loss has played out. */
  shipFailure: string | null = null;
  private lostCause: string | null = null;
  private lostTimer = 0;
  private defenceSeconds = 0;
  private targeting: TargetingInfo | null = null;
  /** Map orbit angles, set from the ship's position when the map opens. */
  private readonly tacticalOrbit = new THREE.Spherical(TACTICAL_DISTANCE, Math.PI / 3, 0);
  private warningTimer = 0;
  private elapsed = 0;

  constructor(private readonly deps: PlaySessionDependencies) {
    this.field = new AsteroidField(EARTH_RADIUS, deps.rng);
    this.director = new WaveDirector(deps.rng);
    deps.shipModel.group.add(this.shield.mesh);
    this.sites = new SiteDefence(deps.earth);
    this.siteMarkers = new SiteMarkers(deps.earth, this.sites);
    this.plumes = new ImpactPlumes(deps.earth);
    deps.scene.add(this.field.group, this.visuals.group, this.dust.lines, this.laser.group, this.missiles.group);
    this.combat = new CombatResolver({
      field: this.field,
      earth: deps.earth,
      explosions: deps.explosions,
      scorches: this.scorches,
      plumes: this.plumes,
      sites: this.sites,
      sound: deps.sound,
      hud: deps.hud,
      feedback: this.feedback,
      cameraRig: deps.cameraRig,
      session: deps.session,
      ship: deps.ship,
      shield: this.shield,
      rng: deps.rng,
      shipActive: () => this.shipActive,
    });
    this.hazards = new FlightHazards({
      ship: deps.ship,
      combat: this.combat,
      sound: deps.sound,
      hud: deps.hud,
      cameraRig: deps.cameraRig,
      explosions: deps.explosions,
    });
    deps.scene.add(this.hazards.group);
  }

  get shipActive(): boolean {
    return this.lostCause === null;
  }

  reset(): void {
    this.field.clear();
    this.visuals.clear();
    this.scorches.clear();
    this.feedback.clear();
    this.laser.reset();
    this.missiles.reset();
    this.director.reset();
    this.sites.reset();
    this.plumes.clear();
    this.hazards.reset();
    this.shipFailure = null;
    this.lostCause = null;
    this.lostTimer = 0;
    this.defenceSeconds = 0;
    this.tactical = false;
    this.targeting = null;
  }

  /** Called when the launch hands over control. */
  beginDefence(firstWaveDelay: number): void {
    this.director.reset(firstWaveDelay);
  }

  update(realDeltaSeconds: number): void {
    this.handleSystemKeys();
    const deltaSeconds = this.tactical ? realDeltaSeconds * TACTICAL_TIME_SCALE : realDeltaSeconds;
    this.elapsed += deltaSeconds;
    const { ship, shipModel, earth, explosions, sound, cameraRig } = this.deps;
    const active = this.shipActive;
    const flying = active && !this.tactical;
    const input = flying ? this.hazards.filterInput(this.readFlightInput(), deltaSeconds) : IDLE_INPUT;
    ship.update(deltaSeconds, input);
    shipModel.group.updateMatrixWorld();

    if (flying && !this.hazards.returning) {
      this.updateWeapons(deltaSeconds);
    } else if (!active) {
      this.lostTimer -= deltaSeconds;
      if (this.lostTimer <= 0) {
        this.shipFailure = this.lostCause;
      }
    }
    this.hazards.update(deltaSeconds, active);

    const impacts = this.field.update(deltaSeconds);
    this.combat.resolvePlanetImpacts(impacts, this.deps.camera.position);
    this.combat.resolveWeaponHits(this.laser.update(deltaSeconds, this.field.all, EARTH_RADIUS), 'laser');
    this.combat.resolveWeaponHits(this.missiles.update(deltaSeconds, this.field.all, EARTH_RADIUS), 'missile');
    this.combat.resolveShipCollisions();
    const lostCause = this.combat.consumeShipLost();
    if (lostCause && active) {
      this.destroyShip(lostCause);
    }
    this.handleWaveEvents(this.director.update(deltaSeconds, this.field.count));

    this.sites.updateThreats(this.field.all);
    const ranked = rankThreats(this.field.all);
    earth.update(deltaSeconds);
    this.siteMarkers.update(deltaSeconds);
    this.plumes.update(deltaSeconds);
    this.updateTips(deltaSeconds);
    explosions.update(deltaSeconds);
    this.scorches.update(deltaSeconds);
    this.feedback.update(deltaSeconds);
    this.visuals.update(deltaSeconds, ranked);
    this.dust.update(ship.position, ship.velocity);
    this.dust.lines.visible = !this.tactical;
    this.shield.update(deltaSeconds, ship.shield / SHIELD_CAPACITY);
    shipModel.setThrottle(ship.throttle, ship.boosting);
    shipModel.update(this.elapsed);
    sound.setEngine(this.shipActive ? ship.throttle : 0, ship.boosting);

    this.targeting = this.shipActive ? computeTargeting(ship, this.missiles.lockedTarget, this.field.all) : null;
    this.updateWarnings(realDeltaSeconds);
    this.updateCamera(realDeltaSeconds);
    // In the cockpit the hull would block the view.
    shipModel.group.visible = this.shipActive && (cameraRig.view === 'chase' || this.tactical);
    this.updateHud(realDeltaSeconds, ranked);
  }

  /** HUD without targeting, used while the launch plays. */
  updateHudOnly(deltaSeconds: number): void {
    this.updateHud(deltaSeconds, rankThreats(this.field.all), false);
  }

  private handleSystemKeys(): void {
    const { input, cameraRig, hud, sound } = this.deps;
    if (input.consumePress('Tab')) {
      this.tactical = !this.tactical;
      if (this.tactical) {
        // Start the map looking down at the ship's side of Earth.
        const start = new THREE.Spherical().setFromVector3(this.deps.ship.position);
        this.tacticalOrbit.set(TACTICAL_DISTANCE, THREE.MathUtils.clamp(start.phi - 0.5, 0.2, Math.PI - 0.2), start.theta);
        input.consumeLook();
      }
      cameraRig.snap();
      hud.showMessage(this.tactical ? 'Tactical map: time slowed. Mouse to rotate, Tab to return' : 'Back in the cockpit', 'info', 2.5);
    }
    if (input.consumePress('KeyC') && !this.tactical) {
      const view = cameraRig.toggleView();
      this.deps.setCockpitFrame(view === 'cockpit');
      cameraRig.snap();
    }
    if (input.consumePress('KeyM')) {
      hud.showMessage(sound.toggleMute() ? 'Sound off' : 'Sound on', 'info', 1.5);
    }
  }

  private readFlightInput(): FlightInput {
    const input = this.deps.input;
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

  private updateWeapons(deltaSeconds: number): void {
    const { shipModel, ship, input, sound, hud } = this.deps;
    const group = shipModel.group;
    if (this.laser.tryFire(deltaSeconds, input.firingPrimary, group, ship.velocity, shipModel.gunPorts)) {
      sound.laser();
    }
    this.missiles.updateLock(group, this.field.all);
    if (input.consumePress('KeyF') || input.consumePress('MouseRight')) {
      if (this.missiles.tryFire(group, ship.velocity)) {
        sound.missile();
      } else if (this.missiles.ammunition === 0) {
        hud.showMessage('No missiles left. A supply rocket arrives after this wave', 'warning', 2.5);
      }
    }
  }

  /** Beeps for collision danger and for heavy rocks about to hit Earth. */
  private updateWarnings(deltaSeconds: number): void {
    this.warningTimer -= deltaSeconds;
    if (this.warningTimer > 0) {
      return;
    }
    if (this.targeting?.collision) {
      this.deps.sound.warningBeep(true);
      this.warningTimer = 0.22;
      return;
    }
    const imminent = this.field.all.some(
      (asteroid) => asteroid.size !== 'small' && asteroid.timeToImpact !== null && asteroid.timeToImpact < 10,
    );
    if (imminent) {
      this.deps.sound.warningBeep(false);
      this.warningTimer = 1.1;
    }
  }

  private updateCamera(deltaSeconds: number): void {
    const { cameraRig, camera, shipModel, ship } = this.deps;
    if (!this.tactical) {
      cameraRig.follow(shipModel.group, deltaSeconds, ship.boosting);
      return;
    }
    // The mouse orbits the map camera around Earth.
    const look = this.deps.input.consumeLook();
    this.tacticalOrbit.theta -= look.x * TACTICAL_LOOK_SENSITIVITY;
    this.tacticalOrbit.phi = THREE.MathUtils.clamp(this.tacticalOrbit.phi - look.y * TACTICAL_LOOK_SENSITIVITY, 0.15, Math.PI - 0.15);
    const desired = new THREE.Vector3().setFromSpherical(this.tacticalOrbit);
    const position = camera.position.clone().lerp(desired, damping(4, deltaSeconds));
    cameraRig.place(position, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0), deltaSeconds);
  }

  private destroyShip(cause: string): void {
    const { explosions, sound, cameraRig, hud, ship } = this.deps;
    explosions.spawnExplosion(ship.position, 1.6, 'fire');
    explosions.spawnRockChips(ship.position, 3);
    sound.explosion(0.7);
    cameraRig.addShake(1.2);
    this.lostCause = cause;
    this.lostTimer = SHIP_LOST_SECONDS;
    hud.showMessage('Interceptor destroyed', 'danger', SHIP_LOST_SECONDS);
  }

  /** Aims some later-wave asteroids at a standing site, allowing for Earth's rotation. */
  private spawnAsteroid(spawn: AsteroidSpawnPlan): void {
    const { earth, rng } = this.deps;
    const site = rng() < siteTargetingChance(this.director.wave) ? this.sites.pickStanding(rng) : null;
    if (!site) {
      this.field.spawnIncoming(spawn.size, spawn.material, spawn.direction);
      return;
    }
    // Approach from the site's side of the planet so the path is not blocked.
    const overSite = earth.localToWorldDirectionAt(site.localDirection, 45);
    const direction = overSite.add(new THREE.Vector3(...randomUnitVector(rng)).multiplyScalar(0.5)).normalize();
    this.field.spawnAt(spawn.size, spawn.material, direction.multiplyScalar(185), 1, (flightSeconds) =>
      earth.localToWorldDirectionAt(site.localDirection, flightSeconds).multiplyScalar(EARTH_RADIUS),
    );
  }

  private updateTips(deltaSeconds: number): void {
    this.defenceSeconds += deltaSeconds;
    const tip = TIPS.find(([from, to]) => this.defenceSeconds >= from && this.defenceSeconds < to);
    this.deps.hud.setHint(tip ? tip[2] : null);
  }

  private handleWaveEvents(events: readonly WaveEvent[]): void {
    const { session, hud, sound } = this.deps;
    for (const event of events) {
      if (event.type === 'wave-started') {
        session.impactsThisWave = 0;
        session.destroyedThisWave = 0;
        if (event.plan.hasGiant) {
          hud.showMessage(`Wave ${event.plan.wave}: giant asteroid detected. Intercept it far out`, 'danger', 5);
          sound.alarm();
        } else {
          hud.showMessage(`Wave ${event.plan.wave} incoming: ${event.plan.spawns.length} contacts`, 'warning', 3.5);
        }
      } else if (event.type === 'spawn') {
        this.spawnAsteroid(event.spawn);
      } else {
        const bonus = waveClearBonus(event.wave, session.destroyedThisWave, session.impactsThisWave);
        session.score += bonus;
        session.wavesCleared += 1;
        const clean = session.impactsThisWave === 0 ? ' Earth untouched.' : '';
        const reward = bonus > 0 ? ` +${bonus} points.` : '';
        this.sites.repairSurvivors();
        const canSupply = this.sites.isStanding('launch');
        const loaded = canSupply ? this.missiles.resupply(MISSILES_PER_RESUPPLY) : 0;
        const supply = !canSupply ? ' No supply: Launch Complex lost.' : loaded > 0 ? ` Supply rocket: +${loaded} missiles.` : '';
        hud.showMessage(`Wave ${event.wave} over.${reward}${clean}${supply}`, 'success', 5);
        sound.chime();
      }
    }
  }

  private updateHud(deltaSeconds: number, ranked: readonly Asteroid[], showTargets = true): void {
    const { hud, radar, overlay, ship, shipModel, session, camera } = this.deps;
    hud.update(deltaSeconds, {
      integrity: session.integrity,
      wave: Math.max(1, this.director.wave),
      score: session.score,
      threats: ranked,
      laserHeat: this.laser.heat,
      overheated: this.laser.overheated,
      missiles: this.missiles.ammunition,
      boost: ship.boostEnergy,
      shield: ship.shield,
      hull: ship.hull,
      speed: ship.velocity.length(),
      shipPosition: ship.position,
      altitude: altitudeReadout(ship.position.length(), EARTH_RADIUS),
      zone: this.hazards.zone,
      sites: this.sites.sites,
    });
    const range = this.sites.isStanding('radar') ? SCANNER_RANGE : SCANNER_RANGE / 2;
    const urgent = new Set(ranked.slice(0, 3).filter((threat) => threat.timeToImpact !== null).map((threat) => threat.id));
    radar.draw(deltaSeconds, shipModel.group, this.field.all, urgent, this.missiles.lockedTarget?.id ?? null, EARTH_RADIUS, range);
    if (!showTargets || !this.shipActive || !this.targeting) {
      overlay.clear();
      return;
    }
    camera.updateMatrixWorld();
    overlay.draw(deltaSeconds, {
      camera,
      aimPoint: new THREE.Vector3(0, 0, -AIM_DISTANCE).applyMatrix4(shipModel.group.matrixWorld),
      overheated: this.laser.overheated,
      ranked,
      targeting: this.targeting,
      feedback: this.feedback,
      tactical: this.tactical,
      shipPosition: ship.position,
      sites: this.siteMarkers.visibleLabels(camera.position),
    });
  }
}
