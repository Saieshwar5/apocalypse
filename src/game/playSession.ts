import * as THREE from 'three';
import { AsteroidField, type Asteroid } from '../asteroids/asteroidField';
import { updateIdentification } from '../asteroids/identification';
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
import type { RandomSource } from '../logic/random';
import { rankThreats } from '../logic/threats';
import { damping, orientationFromForward } from '../math/orientation';
import { EARTH_RADIUS, type Earth } from '../scene/earth';
import { ShieldBubble } from '../ship/shieldBubble';
import { RcsThrusters } from '../ship/rcsThrusters';
import { IDLE_INPUT, type ShipController } from '../ship/shipController';
import { handleShipToggles, readFlightInput } from '../input/flightKeys';
import type { ShipModel } from '../ship/shipModel';
import { LaserCannon } from '../weapons/laserCannon';
import { MissileLauncher } from '../weapons/missileLauncher';
import { SatelliteTraffic } from '../satellites/satelliteTraffic';
import { StationOperations } from '../station/stationOperations';
import { STAR_SYSTEMS, type StarSystem } from '../logic/starSystems';
import { SiteDefence } from '../sites/siteDefence';
import { SiteMarkers } from '../sites/siteMarkers';
import { CombatResolver } from './combatResolver';
import { ContractBook } from './contractBook';
import { FlightHazards } from './flightHazards';
import type { GameSession } from './gameSession';
import { computeGuidance, type Guidance } from './guidance';
import { computeTargeting, type TargetingInfo } from './targeting';
import { Campaign } from './campaign';
import { RIVALS, pilotName } from '../logic/rivals';
import { OrbitServices } from './orbitServices';
import type { OutpostId } from '../station/outposts';

/** After the ship is destroyed, play continues this long so the player sees it. */
const SHIP_LOST_SECONDS = 2.5;
/** Missiles delivered by supply rocket after each wave, until the space base exists. */
const AIM_DISTANCE = 24;
/** Time runs this much slower while the tactical map is open. */
const TACTICAL_TIME_SCALE = 0.3;
const TACTICAL_DISTANCE = 340;
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
  /** The Blender station model. */
  stationModel: THREE.Object3D;
  satellitesModel: THREE.Object3D;
  outpostModels: Record<OutpostId, THREE.Object3D>;
  /** The interceptor model, repainted for the rival pilots. */
  shipSource: THREE.Object3D;
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
  readonly campaign: Campaign;
  readonly combat: CombatResolver;
  readonly contracts: ContractBook;
  tactical = false;
  private readonly visuals = new ThreatVisuals(EARTH_RADIUS);
  private readonly dust = new SpaceDust();
  private readonly scorches = new ScorchMarks();
  private readonly feedback = new CombatFeedback();
  private readonly shield = new ShieldBubble();
  private readonly rcs: RcsThrusters;
  readonly sites: SiteDefence;
  private readonly siteMarkers: SiteMarkers;
  private readonly plumes: ImpactPlumes;
  private readonly hazards: FlightHazards;
  readonly stationOps: StationOperations;
  readonly satellites: SatelliteTraffic;
  readonly services: OrbitServices;
  /** Why the mission failed because of the ship, once the loss has played out. */
  shipFailure: string | null = null;
  private lostCause: string | null = null;
  private lostTimer = 0;
  private targeting: TargetingInfo | null = null;
  private guidance: Guidance = { priority: null, satelliteAhead: null };
  /** Map orbit angles, set from the ship's position when the map opens. */
  private readonly tacticalOrbit = new THREE.Spherical(TACTICAL_DISTANCE, Math.PI / 3, 0);
  private warningTimer = 0;
  private elapsed = 0;

  constructor(private readonly deps: PlaySessionDependencies) {
    this.field = new AsteroidField(EARTH_RADIUS, deps.rng);
    this.contracts = new ContractBook({ walletOf: (pilot) => deps.session.walletOf(pilot), hud: deps.hud, feedback: this.feedback });
    deps.shipModel.group.add(this.shield.mesh);
    this.rcs = new RcsThrusters(deps.shipModel.group, deps.ship.velocity, deps.shipModel.bounds);
    deps.scene.add(this.rcs.group);
    this.sites = new SiteDefence(deps.earth, STAR_SYSTEMS[0].sites);
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
      contracts: this.contracts,
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
    this.stationOps = new StationOperations({
      scene: deps.scene,
      stationModel: deps.stationModel,
      earth: deps.earth,
      ship: deps.ship,
      missiles: this.missiles,
      field: this.field,
      explosions: deps.explosions,
      sound: deps.sound,
      hud: deps.hud,
      cameraRig: deps.cameraRig,
      input: deps.input,
      wallet: deps.session.wallet,
    });
    deps.scene.add(this.hazards.group);
    this.satellites = new SatelliteTraffic({
      scene: deps.scene,
      model: deps.satellitesModel,
      rng: deps.rng,
      ship: deps.ship,
      field: this.field,
      combat: this.combat,
      explosions: deps.explosions,
      sound: deps.sound,
      hud: deps.hud,
      session: deps.session,
      projectiles: [this.laser.group, this.missiles.group],
    });
    this.services = new OrbitServices({
      scene: deps.scene,
      outpostModels: deps.outpostModels,
      fleet: this.satellites.fleet,
      traffic: this.satellites,
      ship: deps.ship,
      field: this.field,
      walletOf: (pilot) => deps.session.walletOf(pilot),
      hud: deps.hud,
      sound: deps.sound,
      input: deps.input,
      rng: deps.rng,
      shipSource: deps.shipSource,
      contracts: this.contracts,
      combat: this.combat,
      session: deps.session,
      playerProjectiles: [this.laser.group, this.missiles.group],
      station: () => (this.stationOps.present ? { position: this.stationOps.station.position, velocity: this.stationOps.station.velocity } : null),
    });
    this.campaign = new Campaign({
      field: this.field,
      sites: this.sites,
      stationOps: this.stationOps,
      earth: deps.earth,
      hud: deps.hud,
      sound: deps.sound,
      session: deps.session,
      rng: deps.rng,
      input: deps.input,
      ship: deps.ship,
      laser: this.laser,
      missiles: this.missiles,
      contracts: this.contracts,
      work: this.services.work,
    });
  }

  get shipActive(): boolean {
    return this.lostCause === null;
  }

  /** `keepUpgrades` carries the workshop upgrades into the next star system. */
  reset(system: StarSystem = STAR_SYSTEMS[0], keepUpgrades = false): void {
    this.sites.setDefinitions(system.sites);
    this.siteMarkers.rebuild();
    this.field.clear();
    this.rcs.reset();
    this.contracts.reset();
    this.visuals.clear();
    this.scorches.clear();
    this.feedback.clear();
    this.laser.reset();
    this.missiles.reset();
    this.campaign.reset(system.difficulty, keepUpgrades);
    this.plumes.clear();
    this.hazards.reset();
    this.stationOps.reset();
    this.satellites.reset();
    this.services.reset();
    this.shipFailure = null;
    this.lostCause = null;
    this.lostTimer = 0;
    this.tactical = false;
    this.targeting = null;
  }

  /** Called when the launch hands over control. */
  beginDefence(): void {
    this.stationOps.begin();
    // Start with the station dead ahead, so the pilot sees where home is.
    const { ship } = this.deps;
    const toStation = this.stationOps.station.position.clone().sub(ship.position).normalize();
    ship.object.quaternion.copy(orientationFromForward(toStation, ship.position.clone().normalize()));
    ship.velocity.copy(toStation).multiplyScalar(ship.velocity.length());
  }

  update(realDeltaSeconds: number): void {
    this.handleSystemKeys();
    const deltaSeconds = this.tactical ? realDeltaSeconds * TACTICAL_TIME_SCALE : realDeltaSeconds;
    this.elapsed += deltaSeconds;
    const { ship, shipModel, earth, explosions, sound, cameraRig } = this.deps;
    const active = this.shipActive;
    const flying = active && !this.tactical && !this.stationOps.holdingShip;
    const input = flying ? this.hazards.filterInput(readFlightInput(this.deps.input), deltaSeconds) : IDLE_INPUT;
    ship.assistOverride = this.hazards.autopilot;
    ship.update(deltaSeconds, input);
    shipModel.group.updateMatrixWorld();
    this.rcs.update(deltaSeconds, active && !this.stationOps.holdingShip);
    sound.thrusters(this.rcs.activity);

    if (flying && !this.hazards.autopilot) {
      this.updateWeapons(deltaSeconds);
    } else if (!active) {
      this.lostTimer -= deltaSeconds;
      if (this.lostTimer <= 0) {
        this.shipFailure = this.lostCause;
      }
    }
    // The docking guides will not take a ship with a load on its tow line.
    const pilotBusy =
      input.thrust !== 0 || input.strafe !== 0 || input.lift !== 0 || this.deps.input.firingPrimary || this.services.tow.load !== null;
    this.stationOps.update(deltaSeconds, active, this.tactical, pilotBusy);
    shipModel.group.updateMatrixWorld();
    this.hazards.update(deltaSeconds, active);

    const impacts = this.field.update(deltaSeconds);
    this.combat.resolvePlanetImpacts(impacts, this.deps.camera.position);
    this.combat.resolveWeaponHits(this.laser.update(deltaSeconds, this.field.all, EARTH_RADIUS), 'laser');
    this.combat.resolveWeaponHits(this.missiles.update(deltaSeconds, this.field.all, EARTH_RADIUS), 'missile');
    this.combat.resolveShipCollisions();
    this.combat.resolveEscaped(this.field.collectEscaped());
    this.satellites.shipIgnores = this.services.work.towed;
    this.satellites.update(deltaSeconds, active);
    this.services.update(deltaSeconds, flying && !this.hazards.autopilot, active);
    const lostCause = this.combat.consumeShipLost();
    if (lostCause && active) {
      this.destroyShip(lostCause);
    }
    this.campaign.update(deltaSeconds);

    updateIdentification(deltaSeconds, ship.position, ship.forward(), this.field.all, this.sites.isStanding('radar'), flying, this.feedback);
    this.sites.updateThreats(this.field.all);
    this.contracts.update(this.field.all);
    this.stationOps.updateThreats();
    const ranked = rankThreats(this.field.all);
    earth.update(deltaSeconds);
    this.siteMarkers.update(deltaSeconds);
    this.plumes.update(deltaSeconds);
    explosions.update(deltaSeconds);
    this.scorches.update(deltaSeconds);
    this.feedback.update(deltaSeconds);
    this.visuals.update(deltaSeconds, ranked);
    // A solar flare takes the path predictions away along with the scanner.
    this.visuals.group.visible = !this.campaign.scannerBlind;
    this.dust.update(ship.position, ship.velocity);
    this.dust.lines.visible = !this.tactical;
    this.shield.update(deltaSeconds, ship.shield / ship.shieldCapacity);
    shipModel.setThrottle(ship.throttle, ship.boosting);
    shipModel.setBank(flying ? ship.yawRate : 0, deltaSeconds);
    shipModel.update(this.elapsed);
    sound.setEngine(this.shipActive ? ship.throttle : 0, ship.boosting);

    this.targeting = this.shipActive ? computeTargeting(ship, this.missiles.lockedTarget, this.field.all) : null;
    this.guidance = computeGuidance(ship, ranked, this.satellites.all);
    this.updateWarnings(realDeltaSeconds);
    this.updateCamera(realDeltaSeconds);
    // In the cockpit the hull would block the view.
    shipModel.group.visible = this.shipActive && (cameraRig.view === 'chase' || this.tactical || this.stationOps.holdingShip);
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
      hud.showMessage(this.tactical ? 'Tactical map: time slowed. Mouse rotates, Q/E move the station, Tab returns' : 'Back in the cockpit', 'info', 2.5);
    }
    if (input.consumePress('KeyC') && !this.tactical) {
      const view = cameraRig.toggleView();
      this.deps.setCockpitFrame(view === 'cockpit');
      cameraRig.snap();
    }
    handleShipToggles(input, this.deps.ship, hud, sound, !this.tactical);
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
    if (this.targeting?.collision || this.guidance.satelliteAhead) {
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
    if (!this.tactical && this.stationOps.holdingShip) {
      this.stationOps.followDockedShip(camera, deltaSeconds);
      return;
    }
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

  private updateHud(deltaSeconds: number, ranked: readonly Asteroid[], showTargets = true): void {
    const { hud, radar, overlay, ship, shipModel, session, camera } = this.deps;
    hud.update(deltaSeconds, {
      integrity: session.integrity,
      orbitHealth: this.services.debris.health,
      wave: Math.max(1, this.campaign.director.wave),
      missileCapacity: this.missiles.capacity,
      fuelCapacity: ship.fuelCapacity,
      shieldCapacity: ship.shieldCapacity,
      balance: session.wallet.balance,
      earned: session.wallet.earned,
      league: session.league().map(({ pilot, earned }) => ({
        name: pilotName(pilot),
        earned,
        color: pilot === 'player' ? '#7dffb0' : (RIVALS.find((rival) => rival.id === pilot)?.color ?? '#e8f1ff'),
        you: pilot === 'player',
      })),
      contracts: this.contracts.listings(ranked),
      jobs: this.services.jobRows(),
      contractSummary: this.contracts.summary(this.campaign.director.phase === 'field'),
      laserHeat: this.laser.heat,
      overheated: this.laser.overheated,
      missiles: this.missiles.ammunition,
      boost: ship.boostEnergy,
      shield: ship.shield,
      hull: ship.hull,
      speed: ship.velocity.length(),
      shipPosition: ship.position,
      fuel: ship.fuel,
      station: this.stationOps.hudInfo(),
      altitude: altitudeReadout(ship.position.length(), EARTH_RADIUS),
      zone: this.hazards.zone,
      sites: this.sites.sites,
      controls: {
        mouseCaptured: this.deps.input.pointerLocked,
        assist: ship.assist,
        autopilot: this.hazards.pullingUp ? 'AUTO PULL-UP' : this.hazards.returning ? 'AUTOPILOT RETURNING' : null,
        thrusting: this.deps.input.isDown('KeyW'),
        braking: this.deps.input.isDown('KeyS'),
        towing: this.services.work.towStatus(),
      },
    });
    const range = (this.sites.isStanding('radar') ? SCANNER_RANGE : SCANNER_RANGE / 2) * this.satellites.scannerBonus;
    const urgent = new Set(ranked.slice(0, 3).filter((threat) => threat.timeToImpact !== null).map((threat) => threat.id));
    radar.draw(deltaSeconds, shipModel.group, this.field.all, urgent, this.missiles.lockedTarget?.id ?? null, EARTH_RADIUS, range, this.stationOps.present ? this.stationOps.station.position : null, this.campaign.scannerBlind, this.satellites.positions(), this.services.radarContacts());
    if (!showTargets || !this.shipActive || !this.targeting || this.stationOps.holdingShip) {
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
      stationMarkers: [...this.stationOps.markers(), ...this.services.markers()],
      guidance: {
        guidance: this.guidance,
        satellites: this.satellites.all,
        shipPosition: ship.position,
        shipVelocity: ship.velocity,
        showDrift: !ship.assist,
        priorityPay: this.guidance.priority ? this.contracts.offerFor(this.guidance.priority.item) : 0,
        waypoint: this.services.waypoint(),
        debris: this.services.debris.labels(ship.position),
        priorityEstimate: this.guidance.priority ? !this.guidance.priority.item.identified : false,
      },
    });
  }
}
