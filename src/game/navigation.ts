import * as THREE from 'three';
import type { Hud } from '../hud/hud';
import type { NavigationObjective } from '../hud/navigationOverlay';
import type { Radar } from '../hud/radar';
import type { TargetOverlay } from '../hud/targetOverlay';
import type { InputState } from '../input/inputState';
import { MATERIAL_TRAITS } from '../logic/asteroidClasses';
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
import { DOCKING } from '../logic/stationSupply';
import { TOW } from '../logic/towing';
import { damping, orientationFromForward } from '../math/orientation';
import type { ShipController } from '../ship/shipController';
import type { GameSession } from './gameSession';
import { AIM_DISTANCE, type PlaySession } from './playSession';

export interface NavigationDependencies {
  play: PlaySession;
  ship: ShipController;
  input: InputState;
  hud: Hud;
  overlay: TargetOverlay;
  radar: Radar;
  session: GameSession;
}

/** A quick tap of B cycles the scanner range; holding it enlarges the scanner. */
const HOLD_SECONDS = 0.3;
/** Berths take the ship below this relative speed. */
const BERTH_SPEED = 3;
const COLORS: Record<ObjectiveKind, string> = { threat: '#ffd23f', job: '#8fd3ff', station: '#7dffb0', home: '#5fd8ff' };

/**
 * One objective, shown the same way everywhere: the target compass and
 * steering arrow by the crosshair, the highlight on the scanner and the
 * approach guide near stations. G chooses what it points at, B sets the
 * scanner's range (hold to enlarge), X turns the nose towards it.
 */
export class Navigation {
  mode: ObjectiveMode = 'auto';
  scannerMode: ScannerMode = 'auto';
  objective: (NavigationObjective & { kind: ObjectiveKind }) | null = null;
  private readonly lastWorld = new THREE.Vector3();
  private lastKey = '';
  private readonly velocity = new THREE.Vector3();
  private bHeld = 0;
  private alignWarned = false;

  constructor(private readonly deps: NavigationDependencies) {
    deps.radar.rangeFor = (full) => scannerRange(this.scannerMode, full, this.objective ? this.objective.world.distanceTo(deps.ship.position) : null);
  }

  reset(): void {
    this.mode = 'auto';
    this.objective = null;
    this.lastKey = '';
    this.alignWarned = false;
  }

  /** Before the play session updates: keys, the objective, the scanner. */
  update(deltaSeconds: number, flying: boolean): void {
    const { input, hud, radar } = this.deps;
    const options = this.options();
    if (input.consumePress('KeyG')) {
      this.mode = nextObjectiveMode(this.mode, options);
      hud.showMessage(`Compass: ${OBJECTIVE_NAME[this.mode]}${this.mode === 'auto' ? ' (follows the action)' : ''}`, 'info', 2);
    }
    this.handleScannerKey(deltaSeconds);
    this.objective = this.build(resolveObjective(this.mode, options), deltaSeconds);
    radar.objective = this.objective ? { position: this.objective.world, color: this.objective.color } : null;
    radar.modeLabel = this.scannerMode.toUpperCase();
    this.deps.overlay.compassActive = this.objective !== null;
    if (flying && input.isDown('KeyX')) {
      this.align(deltaSeconds);
    }
  }

  /** After the play session has drawn the overlay: the compass, arrow, velocity marker and approach guide. */
  draw(): void {
    const { play, ship, overlay } = this.deps;
    const visible = play.shipActive && !play.tactical && !play.stationOps.holdingShip && !play.services.berths.holding;
    if (!this.objective || !visible) {
      return;
    }
    const aimPoint = new THREE.Vector3(0, 0, -AIM_DISTANCE).applyMatrix4(ship.object.matrixWorld);
    overlay.drawNavigationAids(
      {
        objective: this.objective,
        shipPosition: ship.position,
        shipVelocity: ship.velocity,
        shipQuaternion: ship.object.quaternion,
        chosen: this.mode !== 'auto',
      },
      aimPoint,
    );
  }

  private options(): ObjectiveOptions {
    const { play, ship } = this.deps;
    return {
      threat: play.guidance.priority !== null,
      job: play.services.waypoint() !== null,
      station: true,
      home: play.stationOps.present,
      needsHome: ship.fuel < ship.fuelCapacity * 0.25 || ship.hull < 35,
    };
  }

  private build(kind: ObjectiveKind | null, deltaSeconds: number): (NavigationObjective & { kind: ObjectiveKind }) | null {
    if (!kind) {
      return null;
    }
    const { play, ship } = this.deps;
    let world: THREE.Vector3 | null = null;
    let label = '';
    let tag = '';
    let approachSpeed: number | null = null;
    let knownVelocity: THREE.Vector3 | null = null;
    let key: string = kind;
    if (kind === 'threat' && play.guidance.priority) {
      const rock = play.guidance.priority.item;
      world = rock.mesh.position;
      knownVelocity = rock.velocity;
      const what = rock.identified ? `${rock.size} ${MATERIAL_TRAITS[rock.material].label.toLowerCase()}` : `${rock.size} rock`;
      label = `${what}${rock.targetSite ? ` → ${rock.targetSite}` : ''}`;
      tag = 'PRIORITY';
      key = `threat-${rock.id}`;
    } else if (kind === 'job') {
      const waypoint = play.services.waypoint();
      if (waypoint) {
        world = waypoint.world;
        label = waypoint.label;
        tag = 'JOB';
        approachSpeed = TOW.attachSpeed;
        key = `job-${waypoint.label}`;
      }
    } else if (kind === 'home') {
      const aegis = play.stationOps.whereabouts();
      if (aegis) {
        world = aegis.position;
        knownVelocity = aegis.velocity;
        label = 'Aegis station: dock to refuel, rearm and repair';
        tag = 'HOME · AEGIS';
        approachSpeed = DOCKING.maxRelativeSpeed;
      }
    } else {
      const outposts = play.services.outposts.list;
      const nearest = outposts.reduce((best, outpost) => (outpost.position.distanceTo(ship.position) < best.position.distanceTo(ship.position) ? outpost : best));
      world = nearest.position;
      knownVelocity = nearest.velocity;
      label = nearest.name;
      tag = nearest.name;
      approachSpeed = BERTH_SPEED;
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
    return { kind, label, tag, world, velocity: this.velocity.clone(), color: COLORS[kind], approachSpeed, approachRange: 60 };
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

  /** Hold X: the ship turns its nose towards the objective (turning only; the pilot still thrusts). */
  private align(deltaSeconds: number): void {
    const { ship, session, hud, play } = this.deps;
    if (!this.objective || play.hazards.autopilot) {
      return;
    }
    if (session.hardcore) {
      if (!this.alignWarned) {
        hud.showMessage('Hardcore licence: no steering assist. Fly it yourself', 'warning', 2.5);
        this.alignWarned = true;
      }
      return;
    }
    const direction = this.objective.world.clone().sub(ship.position).normalize();
    const target = orientationFromForward(direction, ship.up());
    ship.object.quaternion.slerp(target, damping(3, deltaSeconds));
  }
}
