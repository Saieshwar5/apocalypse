import { OrbitRings } from '../world/orbitRings';
import * as THREE from 'three';
import type { Hud } from '../hud/hud';
import type { NavigationObjective } from '../hud/navigationOverlay';
import type { Radar } from '../hud/radar';
import type { TargetOverlay } from '../hud/targetOverlay';
import type { InputState } from '../input/inputState';
import { MATERIAL_TRAITS } from '../logic/asteroidClasses';
import { directorAdvice, meetingPoint, viaAround } from '../logic/flightDirector';
import { FLIGHT } from '../logic/flightModel';
import {
  OBJECTIVE_NAME,
  SCANNER_MODES,
  nextObjectiveMode,
  resolveObjective,
  scannerRange,
  type ObjectiveKind,
  type ObjectiveMode,
  type ObjectiveOptions,
  type ScannerMode,
} from '../logic/navigation';
import { handlingShare } from '../logic/shipModules';
import { DOCKING } from '../logic/stationSupply';
import { formatCountdown, formatSpeed } from '../logic/units';
import { VERDICT_COLOR, VERDICT_TEXT } from '../hud/guidanceOverlay';
import { TOW, TOW_BRAKE_SHARE, TOW_SPEED } from '../logic/towing';
import { damping, orientationFromForward } from '../math/orientation';
import { EARTH_RADIUS } from '../scene/earth';
import { IDLE_INPUT, type FlightInput, type ShipController } from '../ship/shipController';
import type { GameSession } from './gameSession';
import type { Delivery } from './delivery';
import { NavComputer, type NavEntry } from './navComputer';
import { AIM_DISTANCE, type PlaySession } from './playSession';
import type { RadioNet } from './radioNet';

export interface NavigationDependencies {
  play: PlaySession;
  ship: ShipController;
  input: InputState;
  hud: Hud;
  overlay: TargetOverlay;
  radar: Radar;
  session: GameSession;
  radio?: RadioNet;
  /** Where the tactical map's orbit lines are drawn. */
  scene?: THREE.Scene;
}

export type Objective = NavigationObjective & { kind: ObjectiveKind };

/** Routes keep this far above the surface, and pass the planet with this much to spare. */
const ROUTE = { clearAltitude: 11, margin: 7 } as const;
/** A quick tap of B cycles the scanner range; holding it enlarges the scanner. */
const HOLD_SECONDS = 0.3;
const BERTH_SPEED = 3;
const COLORS: Record<ObjectiveKind, string> = { threat: '#ffd23f', job: '#8fd3ff', station: '#7dffb0', home: '#5fd8ff', target: '#e48cff' };

/**
 * One objective, shown the same way everywhere: the compass, steering arrow
 * and flight director by the crosshair, the route line and meeting point in
 * space, the scanner highlight and the approach guide. G chooses what it
 * points at, N opens the navigation computer to pick anything by name,
 * B sets the scanner's range (hold to enlarge), X turns the nose towards
 * the objective and U flies there on the approach autopilot.
 */
export class Navigation {
  mode: ObjectiveMode = 'auto';
  scannerMode: ScannerMode = 'auto';
  objective: Objective | null = null;
  readonly computer: NavComputer;
  /** The approach autopilot is flying to the objective. */
  autopilotOn = false;
  private readonly lastWorld = new THREE.Vector3();
  private lastKey = '';
  private readonly velocity = new THREE.Vector3();
  private bHeld = 0;
  private warned = false;
  private wasTowing = false;
  /** The fastest worth flying with what is on the tow line. */
  private speedCap = Infinity;
  private readonly rings = new OrbitRings();

  constructor(private readonly deps: NavigationDependencies) {
    this.computer = new NavComputer({ play: deps.play, ship: deps.ship, input: deps.input, hud: deps.hud });
    deps.radar.rangeFor = (full) => scannerRange(this.scannerMode, full, this.objective ? this.objective.world.distanceTo(deps.ship.position) : null);
    deps.play.autopilot = (input, deltaSeconds) => this.autopilotInput(input, deltaSeconds);
    deps.scene?.add(this.rings.group);
  }

  reset(): void {
    this.mode = 'auto';
    this.objective = null;
    this.lastKey = '';
    this.warned = false;
    this.computer.reset();
    this.disengage(null);
  }

  /** Before the play session updates: keys, the objective, the scanner. */
  update(deltaSeconds: number, flying: boolean): void {
    const { input, hud, radar, play } = this.deps;
    const holding = play.stationOps.holdingShip || play.services.berths.holding;
    if (holding && this.autopilotOn) {
      // The docking guides or the berth have the ship: the trip is over.
      this.disengage('Autopilot: arrived. The station has the ship');
    }
    const picked = this.computer.update(deltaSeconds, flying && !holding);
    if (picked === 'cleared') {
      this.mode = 'auto';
      hud.showMessage('Nav target cleared: the compass follows the action', 'info', 2.5);
    } else if (picked) {
      this.mode = 'target';
      const entry = this.computer.current();
      if (entry) {
        hud.showMessage(`Nav target: ${entry.label}. Follow the compass and the flight director`, 'info', 3);
        const { ship } = this.deps;
        const local = entry.world.clone().sub(ship.position).applyQuaternion(ship.object.quaternion.clone().invert());
        const tip =
          entry.group === 'satellite' || (entry.group === 'job' && entry.velocity)
            ? 'It is moving: fly for the meet-here mark, not where it is now.'
            : entry.group === 'station'
              ? `Come alongside under ${formatSpeed(entry.arriveSpeed + 0.5)}.`
              : null;
        this.deps.radio?.navCallout(entry.label, entry.world.distanceTo(ship.position), [local.x, local.y, local.z], tip);
      }
    }
    // Connecting the tow line changes the question from "where is it?" to "where does it go?".
    const towing = play.services.delivery() !== null;
    if (towing && !this.wasTowing && this.mode !== 'auto') {
      this.mode = 'auto';
      this.computer.selected = null;
    }
    this.wasTowing = towing;
    const options = this.options();
    if (this.mode === 'target' && !options.target) {
      this.mode = 'auto';
      this.computer.selected = null;
      hud.showMessage('Nav target lost', 'warning', 2.5);
    }
    if (input.consumePress('KeyG')) {
      this.mode = nextObjectiveMode(this.mode, options);
      this.computer.selected = this.mode === 'target' ? this.computer.selected : null;
      hud.showMessage(`Compass: ${OBJECTIVE_NAME[this.mode]}${this.mode === 'auto' ? ' (follows the action)' : ''}`, 'info', 2);
    }
    if (input.consumePress('KeyU')) {
      this.toggleAutopilot();
    }
    this.handleScannerKey(deltaSeconds);
    this.objective = this.build(resolveObjective(this.mode, options), deltaSeconds);
    if (!this.objective && this.autopilotOn) {
      this.disengage('Autopilot off: nothing to fly to');
    }
    radar.objective = this.objective ? { position: this.objective.world, color: this.objective.color } : null;
    radar.modeLabel = this.scannerMode.toUpperCase();
    this.deps.overlay.compassActive = this.objective !== null;
    this.deps.overlay.delivering = this.objective?.zone !== undefined;
    if (flying && input.isDown('KeyX') && !this.autopilotOn) {
      this.align(deltaSeconds);
    }
    this.showOrbits();
  }

  /** On the tactical map: the stations' orbits, and the nav target's in its own colour. */
  private showOrbits(): void {
    const { play } = this.deps;
    if (!play.tactical) {
      this.rings.show([]);
      return;
    }
    const orbits = play.services.outposts.list.map((outpost) => ({ position: outpost.position, velocity: outpost.velocity, color: outpost.color }));
    const aegis = play.stationOps.whereabouts();
    if (aegis) {
      orbits.push({ ...aegis, color: '#5fd8ff' });
    }
    if (this.objective) {
      orbits.unshift({ position: this.objective.world, velocity: this.objective.velocity, color: this.objective.color });
    }
    this.rings.show(orbits);
  }

  /** After the play session has drawn the overlay: the navigation aids and the list numbers. */
  draw(): void {
    const { play, ship, overlay } = this.deps;
    const visible = play.shipActive && !play.stationOps.holdingShip && !play.services.berths.holding;
    if (!visible) {
      return;
    }
    overlay.drawNavTags(this.computer.visibleEntries().map(({ number, entry }) => ({ number, world: entry.world, label: entry.label })));
    if (!this.objective || play.tactical) {
      return;
    }
    const aimPoint = new THREE.Vector3(0, 0, -AIM_DISTANCE).applyMatrix4(ship.object.matrixWorld);
    overlay.drawNavigationAids(
      {
        objective: this.objective,
        shipPosition: ship.position,
        shipVelocity: ship.velocity,
        shipQuaternion: ship.object.quaternion,
        chosen: this.mode !== 'auto' && this.mode !== 'target',
        autopilot: this.autopilotOn,
      },
      aimPoint,
    );
  }

  private options(): ObjectiveOptions {
    const { play, ship } = this.deps;
    return {
      threat: play.guidance.priority !== null,
      job: play.services.waypoint() !== null,
      committed: play.services.delivery() !== null || play.services.crew.aboard,
      station: true,
      home: play.stationOps.present,
      target: this.computer.selected !== null && this.computer.current() !== null,
      needsHome: ship.fuel < ship.fuelCapacity * 0.25 || ship.hull < 35,
    };
  }

  private build(kind: ObjectiveKind | null, deltaSeconds: number): Objective | null {
    if (!kind) {
      return null;
    }
    const { play, ship } = this.deps;
    let world: THREE.Vector3 | null = null;
    let label = '';
    let tag = '';
    let arriveSpeed = 6;
    let arriveRange = 14;
    let knownVelocity: THREE.Vector3 | null = null;
    let key: string = kind;
    let zone: NavigationObjective['zone'];
    let note: NavigationObjective['note'];
    if (kind === 'threat' && play.guidance.priority) {
      const rock = play.guidance.priority.item;
      world = rock.mesh.position;
      knownVelocity = rock.velocity;
      const what = rock.identified ? `${rock.size} ${MATERIAL_TRAITS[rock.material].label.toLowerCase()}` : `${rock.size} rock`;
      label = `${what}${rock.targetSite ? ` → ${rock.targetSite}` : ''}`;
      tag = 'PRIORITY';
      key = `threat-${rock.id}`;
      const verdict = play.guidance.priority.verdict;
      note = { text: `IMPACT ${formatCountdown(play.guidance.priority.impactSeconds)} · ${VERDICT_TEXT[verdict]}`, color: VERDICT_COLOR[verdict] };
    } else if (kind === 'job' && play.services.delivery()) {
      // Something is on the line: steer for its drop zone.
      const delivery = play.services.delivery() as Delivery;
      // Fly the ship to the middle of the zone and stop: the load, on its short line, settles inside it.
      world = delivery.world;
      knownVelocity = delivery.velocity;
      label = `${delivery.load} to ${delivery.place}`;
      tag = `DELIVER · ${delivery.place.toUpperCase()}`;
      arriveSpeed = delivery.maxSpeed - 0.5;
      arriveRange = 1.2;
      key = `deliver-${delivery.load}-${delivery.place}`;
      zone = { center: delivery.world, radius: delivery.radius, state: delivery.step.state, text: delivery.step.state === 'travel' ? `DROP ZONE · ${delivery.place.toUpperCase()}` : delivery.step.text.toUpperCase() };
    } else if (kind === 'job') {
      const waypoint = play.services.waypoint();
      if (waypoint) {
        world = waypoint.world;
        label = waypoint.label;
        tag = 'JOB';
        arriveSpeed = TOW.attachSpeed;
        arriveRange = 8;
        key = `job-${waypoint.label}`;
      }
    } else if (kind === 'home') {
      const aegis = play.stationOps.whereabouts();
      if (aegis) {
        world = aegis.position;
        knownVelocity = aegis.velocity;
        label = 'Aegis station: dock to refuel, rearm and repair';
        tag = 'HOME · AEGIS';
        arriveSpeed = DOCKING.maxRelativeSpeed - 1;
        arriveRange = DOCKING.range - 3;
      }
    } else if (kind === 'target') {
      const entry = this.computer.current();
      if (entry) {
        ({ world, label, arriveSpeed, arriveRange } = entry);
        knownVelocity = entry.velocity;
        tag = `NAV · ${shortName(entry)}`;
        key = `target-${entry.id}`;
      }
    } else {
      const outposts = play.services.outposts.list;
      const nearest = outposts.reduce((best, outpost) => (outpost.position.distanceTo(ship.position) < best.position.distanceTo(ship.position) ? outpost : best));
      world = play.services.outposts.portPosition(nearest.id);
      knownVelocity = nearest.velocity;
      label = nearest.name;
      tag = nearest.name;
      arriveSpeed = BERTH_SPEED - 0.5;
      arriveRange = 4;
      key = `station-${nearest.id}`;
    }
    if (!world) {
      return null;
    }
    // Waypoints carry no velocity: estimate it from how the point moves between frames.
    if (knownVelocity) {
      this.velocity.copy(knownVelocity);
    } else if (key === this.lastKey && deltaSeconds > 0) {
      this.velocity.lerp(world.clone().sub(this.lastWorld).divideScalar(deltaSeconds), Math.min(1, deltaSeconds * 4));
    } else {
      this.velocity.set(0, 0, 0);
    }
    this.lastWorld.copy(world);
    this.lastKey = key;
    const velocity = this.velocity.clone();
    return { kind, label, tag, world, velocity, color: COLORS[kind], approachSpeed: kind === 'threat' ? null : arriveSpeed, approachRange: 60, zone, note, ...this.plan(world, velocity, arriveSpeed, arriveRange) };
  }

  /** The meeting point and the flight director's advice for this trip. */
  private plan(world: THREE.Vector3, velocity: THREE.Vector3, arriveSpeed: number, arriveRange: number): Pick<NavigationObjective, 'meet' | 'director' | 'via'> {
    const { ship } = this.deps;
    // A load on the line is dragged to a stop by the ship: the same thrusters slow more mass.
    const tow = this.deps.play.services.tow;
    const fragile = tow.load !== null;
    const brake = (FLIGHT.brake * ship.thrustMultiplier * handlingShare(ship.massFactor) * ship.massFactor * (tow.loadMass > 0 ? TOW_BRAKE_SHARE : 1)) / (ship.massFactor + tow.loadMass);
    this.speedCap = fragile ? TOW_SPEED.fragile : tow.loadMass > 0 ? TOW_SPEED.heavy : Infinity;
    const first = directorAdvice(this.directorInput(world, velocity, arriveSpeed, arriveRange, brake));
    // Aim where the target will be when the ship gets there, unless it is already close.
    const distance = world.distanceTo(ship.position);
    const meet =
      distance > arriveRange * 3
        ? new THREE.Vector3(...meetingPoint(ship.position.toArray(), world.toArray(), velocity.toArray(), Math.max(first.targetSpeed, 6)).point)
        : world.clone();
    const input = this.directorInput(meet, velocity, arriveSpeed, arriveRange, brake);
    // Earth in the way: steer round it. No stopping at the corner, so the leg is flown at speed.
    const round = viaAround(ship.position.toArray(), meet.toArray(), EARTH_RADIUS + ROUTE.clearAltitude, ROUTE.margin);
    if (round) {
      const via = new THREE.Vector3(...round);
      const leg = directorAdvice({ ...this.directorInput(via, new THREE.Vector3(), Math.min(FLIGHT.cruiseSpeed, this.speedCap), 0, brake), relativeSpeed: Infinity });
      const phase = leg.phase === 'turn' || leg.phase === 'burn' ? leg.phase : 'coast';
      return { meet, via, director: { phase, targetSpeed: leg.targetSpeed, brakeIn: null } };
    }
    return { meet, director: directorAdvice(input) };
  }

  private directorInput(point: THREE.Vector3, velocity: THREE.Vector3, arriveSpeed: number, arriveRange: number, brake: number) {
    const { ship } = this.deps;
    const offset = point.clone().sub(ship.position);
    const distance = offset.length();
    const relative = ship.velocity.clone().sub(velocity);
    const direction = distance > 0 ? offset.clone().divideScalar(distance) : new THREE.Vector3(0, 0, -1);
    return {
      distance,
      closingSpeed: relative.dot(direction),
      relativeSpeed: relative.length(),
      angle: ship.forward().angleTo(direction),
      brake,
      cruiseSpeed: Math.min(FLIGHT.cruiseSpeed, this.speedCap),
      boostSpeed: Math.min(FLIGHT.boostSpeed, this.speedCap),
      arriveRange,
      arriveSpeed,
    };
  }

  private handleScannerKey(deltaSeconds: number): void {
    const { input, radar, hud } = this.deps;
    input.consumePress('KeyB');
    if (input.isDown('KeyB')) {
      this.bHeld += deltaSeconds;
      radar.enlarged = this.bHeld > HOLD_SECONDS;
      return;
    }
    if (this.bHeld > 0 && this.bHeld <= HOLD_SECONDS) {
      this.scannerMode = SCANNER_MODES[(SCANNER_MODES.indexOf(this.scannerMode) + 1) % SCANNER_MODES.length];
      hud.showMessage(`Scanner range: ${this.scannerMode}${this.scannerMode === 'auto' ? ' (zooms to the objective)' : ''}`, 'info', 2);
    }
    this.bHeld = 0;
    radar.enlarged = false;
  }

  private hardcoreRefuses(): boolean {
    if (!this.deps.session.hardcore) {
      return false;
    }
    if (!this.warned) {
      this.deps.hud.showMessage('Hardcore licence: no steering assist or autopilot. Fly it yourself', 'warning', 2.5);
      this.warned = true;
    }
    return true;
  }

  /** Hold X: the ship turns its nose towards the objective (turning only; the pilot still thrusts). */
  private align(deltaSeconds: number): void {
    const { play } = this.deps;
    if (!this.objective || play.hazards.autopilot || this.hardcoreRefuses()) {
      return;
    }
    this.turnTowards(steerPoint(this.objective), deltaSeconds, 3);
  }

  private turnTowards(point: THREE.Vector3, deltaSeconds: number, sharpness: number): void {
    const { ship } = this.deps;
    const direction = point.clone().sub(ship.position).normalize();
    ship.object.quaternion.slerp(orientationFromForward(direction, ship.up()), damping(sharpness, deltaSeconds));
  }

  private toggleAutopilot(): void {
    if (this.autopilotOn) {
      this.disengage('Autopilot off. You have the controls');
      return;
    }
    if (this.hardcoreRefuses()) {
      return;
    }
    if (!this.objective) {
      this.deps.hud.showMessage('Autopilot: pick something to fly to first (N or G)', 'warning', 2.5);
      return;
    }
    this.autopilotOn = true;
    this.deps.play.autopilotLabel = `AUTOPILOT → ${this.objective.tag}`;
    this.deps.hud.showMessage(`Autopilot engaged: flying to ${this.objective.label}. Any control takes over`, 'info', 3);
  }

  private disengage(message: string | null): void {
    if (this.autopilotOn && message) {
      this.deps.hud.showMessage(message, 'info', 2.5);
    }
    this.autopilotOn = false;
    this.deps.play.autopilotLabel = null;
  }

  /**
   * The approach autopilot: turns to the meeting point and follows the
   * flight director, burning, coasting and braking, until the ship is
   * beside the target at its speed. Any steering or thrust from the pilot
   * hands control back. It flies a little cautiously, so a good pilot is faster.
   */
  private autopilotInput(input: FlightInput, deltaSeconds: number): FlightInput {
    if (!this.autopilotOn) {
      return input;
    }
    const pilotActing =
      input.thrust > 0 || input.brake > 0 || input.strafe !== 0 || input.lift !== 0 || input.pitch !== 0 || input.yaw !== 0 || Math.hypot(input.look.x, input.look.y) > 2;
    const objective = this.objective;
    if (pilotActing || !objective?.director) {
      this.disengage('Autopilot off. You have the controls');
      return input;
    }
    const { ship } = this.deps;
    const phase = objective.director.phase;
    const delivery = this.deps.play.services.delivery();
    if (delivery && !delivery.dodge) {
      // Towing: the job is done when the load sits in the drop zone, slow enough to let go.
      if (delivery.step.state === 'release') {
        this.disengage('Autopilot: the load is in the drop zone. Release it (T)');
        return IDLE_INPUT;
      }
      if (phase === 'arrived') {
        return IDLE_INPUT;
      }
    } else if (phase === 'arrived') {
      this.disengage(`Autopilot: arrived at ${objective.label}. You have the controls`);
      return IDLE_INPUT;
    }
    this.turnTowards(steerPoint(objective), deltaSeconds, 2.2);
    const facing = ship.forward().angleTo(steerPoint(objective).clone().sub(ship.position)) < 0.35;
    if (phase === 'brake' || phase === 'arrive') {
      return { ...IDLE_INPUT, brake: 1 };
    }
    if (phase === 'burn' && facing) {
      return { ...IDLE_INPUT, thrust: 1, boost: objective.director.targetSpeed > FLIGHT.cruiseSpeed && ship.boostEnergy > 20 };
    }
    return IDLE_INPUT;
  }
}

/** Where to point the nose: round the planet first, then the meeting point. */
function steerPoint(objective: Objective): THREE.Vector3 {
  return objective.via ?? objective.meet ?? objective.world;
}

/** The compass tag for a nav target: the call sign or station name, kept short. */
function shortName(entry: NavEntry): string {
  const match = entry.label.match(/(WX|NAV|COM)-\d [A-Z]+/);
  if (match) {
    return match[0];
  }
  return entry.label.replace(/ \(home\)$/, '').slice(0, 18).toUpperCase();
}
