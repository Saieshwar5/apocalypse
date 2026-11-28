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
import type { Radar } from '../hud/radar';
import type { TargetOverlay } from '../hud/targetOverlay';
import type { InputState } from '../input/inputState';
import type { RandomSource } from '../logic/random';
import { rankThreats } from '../logic/threats';
import { damping, orientationFromForward } from '../math/orientation';
import { EARTH_RADIUS, type Earth } from '../scene/earth';
import { ShieldBubble } from '../ship/shieldBubble';
import { RcsThrusters } from '../ship/rcsThrusters';
import { IDLE_INPUT, type FlightInput, type ShipController } from '../ship/shipController';
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
import type { RadioNet } from './radioNet';
import { WarningBeeps } from './warningBeeps';
import { Licence } from './licence';
import { ShipLoss } from './shipLoss';
import { OrbitServices } from './orbitServices';
import { feedHud } from './hudFeed';
import type { OutpostId } from '../station/outposts';

/** Missiles delivered by supply rocket after each wave, until the space base exists. */
export const AIM_DISTANCE = 24;
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
  /** The shared radio channel: mission control, station chiefs, rivals. */
  radio: RadioNet;
  onTrainingComplete: () => void;
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
  /** The approach autopilot (set by the navigation): replaces the pilot's input while engaged. */
  autopilot: ((input: FlightInput, deltaSeconds: number) => FlightInput) | null = null;
  /** What the approach autopilot is flying to, for the HUD; null when it is off. */
  autopilotLabel: string | null = null;
  private readonly visuals = new ThreatVisuals(EARTH_RADIUS);
  private readonly dust = new SpaceDust();
  private readonly scorches = new ScorchMarks();
  readonly feedback = new CombatFeedback();
  private readonly shield = new ShieldBubble();
  private readonly rcs: RcsThrusters;
  readonly sites: SiteDefence;
  readonly siteMarkers: SiteMarkers;
  private readonly plumes: ImpactPlumes;
  readonly hazards: FlightHazards;
  readonly stationOps: StationOperations;
  readonly satellites: SatelliteTraffic;
  readonly services: OrbitServices;
  readonly licence: Licence;
  private readonly loss: ShipLoss;
  targeting: TargetingInfo | null = null;
  guidance: Guidance = { priority: null, satelliteAhead: null };
  /** Map orbit angles, set from the ship's position when the map opens. */
  private readonly tacticalOrbit = new THREE.Spherical(TACTICAL_DISTANCE, Math.PI / 3, 0);
  private readonly beeps: WarningBeeps;
  private elapsed = 0;

  constructor(readonly deps: PlaySessionDependencies) {
    this.field = new AsteroidField(EARTH_RADIUS, deps.rng);
    this.beeps = new WarningBeeps(deps.sound);
    this.licence = new Licence({ session: deps.session, hud: deps.hud, sound: deps.sound, radio: deps.radio });
    this.loss = new ShipLoss({
      ship: deps.ship,
      missiles: this.missiles,
      licence: this.licence,
      explosions: deps.explosions,
      sound: deps.sound,
      cameraRig: deps.cameraRig,
      hud: deps.hud,
      station: () => this.stationOps.whereabouts(),
      onReplaced: () => this.rcs.reset(),
      radio: deps.radio,
    });
    this.contracts = new ContractBook({
      walletOf: (pilot) => deps.session.walletOf(pilot),
      events: deps.session.events,
      radio: deps.radio,
      hud: deps.hud,
      feedback: this.feedback,
    });
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
      fuelPrice: () => this.services.market.price('aegis', 'fuel'),
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
      stationOps: this.stationOps,
      explosions: deps.explosions,
      playerGoodStanding: () => this.licence.inGoodStanding,
      radio: deps.radio,
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
      extraHint: () => this.services.hint,
      calmZoneWork: () => this.services.calmZoneWork(),
      workingSatellites: () => this.satellites.fleet.aliveCount,
      radio: deps.radio,
      onTrainingComplete: deps.onTrainingComplete,
    });
  }

  /** Why the career ended because of the ship (bankruptcy), once known. */
  get shipFailure(): string | null {
    return this.loss.failure;
  }

  get shipActive(): boolean {
    return this.loss.shipActive;
  }

  /** `keepUpgrades` carries the workshop upgrades into the next star system. */
  reset(system: StarSystem = STAR_SYSTEMS[0], keepUpgrades = false, training = false): void {
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
    this.campaign.reset(system.difficulty, keepUpgrades, training);
    this.plumes.clear();
    this.hazards.reset();
    this.stationOps.reset();
    this.satellites.reset();
    this.services.reset();
    this.licence.reset();
    this.loss.reset();
    this.tactical = false;
    this.targeting = null;
  }

  /** Called when the launch hands over control. */
  beginDefence(): void {
    this.stationOps.begin();
    this.deps.radio.moment('run-start');
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
    this.deps.session.clock += deltaSeconds;
    const { ship, shipModel, earth, explosions, sound, cameraRig } = this.deps;
    const active = this.shipActive;
    const flying = active && !this.tactical && !this.stationOps.holdingShip && !this.services.berths.holding;
    const piloted = flying ? this.hazards.filterInput(readFlightInput(this.deps.input), deltaSeconds) : IDLE_INPUT;
    const input = flying && !this.hazards.autopilot && this.autopilot ? this.autopilot(piloted, deltaSeconds) : piloted;
    ship.assistOverride = this.hazards.autopilot || this.autopilotLabel !== null;
    ship.update(deltaSeconds, input);
    shipModel.group.updateMatrixWorld();
    this.rcs.update(deltaSeconds, active && !this.stationOps.holdingShip);
    sound.thrusters(this.rcs.activity);

    if (flying && !this.hazards.autopilot) {
      this.updateWeapons(deltaSeconds);
    }
    this.loss.update(deltaSeconds);
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
    this.services.update(deltaSeconds, flying && !this.hazards.autopilot, active, pilotBusy);
    const lostCause = this.combat.consumeShipLost();
    if (lostCause && active) {
      this.loss.destroy(lostCause);
    }
    this.campaign.update(deltaSeconds);
    this.licence.update(deltaSeconds);

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
    this.beeps.update(realDeltaSeconds, Boolean(this.targeting?.collision || this.guidance.satelliteAhead), this.field.all);
    this.updateCamera(realDeltaSeconds);
    shipModel.group.visible = this.shipActive && (cameraRig.view === 'chase' || this.tactical || this.stationOps.holdingShip); // the hull would block the cockpit view
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
    if (input.consumePress('KeyI') && this.stationOps.docking.state === 'docked') {
      this.licence.buyInsurance();
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

  private updateHud(deltaSeconds: number, ranked: readonly Asteroid[], showTargets = true): void {
    feedHud(this, deltaSeconds, ranked, showTargets);
  }
}
