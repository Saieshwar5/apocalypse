import * as THREE from 'three';
import type { Asteroid, AsteroidField } from '../asteroids/asteroidField';
import type { SoundEffects } from '../audio/soundEffects';
import type { Hud } from '../hud/hud';
import type { InputState } from '../input/inputState';
import type { ShipController } from '../ship/shipController';
import type { StationOperations } from '../station/stationOperations';
import type { RadioNet } from './radioNet';
import type { Waypoint } from './satelliteJobHelpers';

export interface TrainingDependencies {
  ship: ShipController;
  field: AsteroidField;
  stationOps: StationOperations;
  input: InputState;
  hud: Hud;
  sound: SoundEffects;
  radio: RadioNet;
  /** Called once when every step is done (to record it in the career). */
  onComplete: () => void;
}

interface Step {
  /** What Capcom asks for, on the radio and the hint line. */
  ask: string;
  /** Set-up when the step begins. */
  start?: () => void;
  done: () => boolean;
}

/**
 * The guided first flight: thrust, brake, steer, slide, scan, shoot and dock,
 * one step at a time, with Capcom on the radio and a marker where needed.
 * Debris fields wait until it is finished; Enter skips it.
 */
export class TrainingFlight {
  active = false;
  private steps: Step[] = [];
  private index = 0;
  private target: THREE.Vector3 | null = null;
  private rock: Asteroid | null = null;
  private pause = 0;
  /** The ship is turned along the orbit on the first flying frame, after the launch hands over. */
  private faced = false;

  constructor(private readonly deps: TrainingDependencies) {}

  start(): void {
    this.active = true;
    this.faced = false;
    this.index = 0;
    this.pause = 1;
    this.target = null;
    this.rock = null;
    this.steps = this.buildSteps();
    this.announce();
  }

  stop(): void {
    this.active = false;
    this.target = null;
    if (this.rock?.alive) {
      this.deps.field.remove(this.rock);
    }
    this.rock = null;
  }

  /** The marker for the current step, if it has one. */
  waypoint(): Waypoint | null {
    if (!this.active) {
      return null;
    }
    if (this.rock?.alive) {
      return { world: this.rock.mesh.position.clone(), label: 'PRACTICE ROCK' };
    }
    return this.target ? { world: this.target, label: 'TRAINING MARKER' } : null;
  }

  update(deltaSeconds: number): void {
    if (!this.active) {
      return;
    }
    const { input, hud } = this.deps;
    if (!this.faced) {
      this.faced = true;
      this.faceAlongOrbit();
    }
    if (input.consumePress('Enter')) {
      this.stop();
      hud.showMessage('Training skipped. The season begins', 'info', 3);
      return;
    }
    const step = this.steps[this.index];
    hud.setHint(`Training ${this.index + 1}/${this.steps.length}: ${step.ask} · Enter skips`);
    this.pause = Math.max(0, this.pause - deltaSeconds);
    if (this.pause > 0 || !step.done()) {
      return;
    }
    this.deps.sound.chime();
    this.index += 1;
    this.pause = 1.2;
    if (this.index >= this.steps.length) {
      this.stop();
      this.deps.radio.say('control', 'Training complete, {callsign}. You are cleared for the season. Launch when ready.', true);
      hud.showMessage('Training complete. The season begins when you leave the station', 'success', 5);
      this.deps.onComplete();
      return;
    }
    this.announce();
  }

  /** Training begins pointing along the orbit, away from Aegis, so the first thrust does not dock the ship. */
  private faceAlongOrbit(): void {
    const { ship } = this.deps;
    const up = ship.position.clone().normalize();
    const along = new THREE.Vector3(0, 1, 0).cross(up);
    if (along.lengthSq() < 1e-6) {
      along.set(1, 0, 0);
    }
    const forward = along.normalize();
    const right = forward.clone().cross(up).normalize();
    const lift = right.clone().cross(forward);
    ship.object.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, lift, forward.clone().negate()));
    ship.velocity.set(0, 0, 0);
  }

  private announce(): void {
    const step = this.steps[this.index];
    step.start?.();
    this.deps.radio.say('control', step.ask, true);
  }

  private buildSteps(): Step[] {
    const { ship, field, stationOps } = this.deps;
    let movedBefore = false;
    return [
      { ask: 'Hold W to fire the main engine until you are moving', done: () => ship.velocity.length() > 8 },
      {
        ask: 'Let go: in space you keep moving. Now hold S to brake to a stop',
        start: () => (movedBefore = false),
        done: () => {
          movedBefore ||= ship.velocity.length() > 3;
          return movedBefore && ship.velocity.length() < 0.8;
        },
      },
      {
        ask: 'Steer with the mouse or the arrow keys until the nose points at the cyan marker',
        start: () => {
          const side = new THREE.Vector3(1, 0, 0).applyQuaternion(ship.object.quaternion);
          this.target = ship.position.clone().addScaledVector(ship.forward(), 40).addScaledVector(side, 25);
        },
        done: () => this.target !== null && ship.forward().angleTo(this.target.clone().sub(ship.position)) < 0.12,
      },
      {
        ask: 'Slide sideways with A or D without turning',
        start: () => (this.target = null),
        done: () => Math.abs(ship.velocity.dot(new THREE.Vector3(1, 0, 0).applyQuaternion(ship.object.quaternion))) > 3,
      },
      {
        ask: 'A practice rock is ahead. Hold the crosshair on it to scan it',
        start: () => {
          const spot = ship.position.clone().addScaledVector(ship.forward(), 22);
          this.rock = field.spawnFragment('small', 'rocky', spot, ship.velocity.clone());
          this.rock.passerBy = true;
          this.rock.identified = false;
        },
        done: () => this.rock?.identified === true || this.rock?.alive === false,
      },
      { ask: 'Now destroy it: click or hold Space to fire the laser', done: () => this.rock?.alive === false },
      {
        ask: 'Fly to Aegis, brake close to it and let go of the controls to dock',
        start: () => (this.rock = null),
        done: () => stationOps.docking.state === 'docked' || !stationOps.present,
      },
    ];
  }
}
