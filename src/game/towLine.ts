import * as THREE from 'three';
import type { Asteroid } from '../asteroids/asteroidField';
import type { Satellite, SatelliteFleet } from '../satellites/satelliteFleet';
import type { ShipController } from '../ship/shipController';
import { LOAD_MASS, TOW, canAttach, loadStress, towStep } from '../logic/towing';

export type TowEvent =
  | { type: 'attached'; satellite: Satellite }
  | { type: 'released'; satellite: Satellite }
  | { type: 'snapped'; satellite: Satellite }
  | { type: 'wrecked'; satellite: Satellite }
  | { type: 'out-of-reach'; satellite: Satellite; surfaceDistance: number; relativeSpeed: number };

/**
 * The ship's tow line: connects to a satellite, pulls it with a rope that
 * only pulls, wears it down when jerked, and draws the cable.
 */
export class TowLine {
  /** The satellite on the line, or null. */
  load: Satellite | null = null;
  /** A rock being hauled, or null; never at the same time as a satellite. */
  rock: Asteroid | null = null;
  private rockMass = 1;
  /** Set when a hauled rock's line snaps; cleared by whoever reports it. */
  snapped = false;
  /** Latest pull on the line, for the HUD. */
  tension = 0;
  readonly mesh: THREE.Line;
  private readonly positions = new Float32Array(3 * 12);

  constructor(
    private readonly ship: ShipController,
    private readonly fleet: SatelliteFleet,
  ) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.mesh = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({ color: new THREE.Color(1.4, 1.1, 0.6), transparent: true, opacity: 0.85 }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  reset(): void {
    this.load = null;
    this.rock = null;
    this.tension = 0;
    this.mesh.visible = false;
  }

  /** Tries to connect to `satellite`; returns an event either way. */
  attach(satellite: Satellite): TowEvent {
    const surfaceDistance = satellite.position.distanceTo(this.ship.position) - satellite.radius;
    const relativeSpeed = satellite.velocity.distanceTo(this.ship.velocity);
    if (!canAttach(surfaceDistance, relativeSpeed)) {
      return { type: 'out-of-reach', satellite, surfaceDistance, relativeSpeed };
    }
    this.fleet.takeInTow(satellite);
    this.load = satellite;
    return { type: 'attached', satellite };
  }

  release(): TowEvent | null {
    const satellite = this.load;
    if (!satellite) {
      return null;
    }
    this.load = null;
    this.tension = 0;
    this.mesh.visible = false;
    return { type: 'released', satellite };
  }

  /** Connects to a rock for hauling; returns false when too far or too fast. */
  attachRock(asteroid: Asteroid, loadMass: number): boolean {
    const surfaceDistance = asteroid.mesh.position.distanceTo(this.ship.position) - asteroid.radius;
    if (this.load || !canAttach(surfaceDistance, asteroid.velocity.distanceTo(this.ship.velocity))) {
      return false;
    }
    this.rock = asteroid;
    this.rockMass = loadMass;
    return true;
  }

  /** Lets go of the hauled rock and returns it. */
  releaseRock(): Asteroid | null {
    const rock = this.rock;
    this.rock = null;
    this.tension = 0;
    this.mesh.visible = false;
    return rock;
  }

  /** Runs the line for one step; returns an event if it broke or the load was lost. */
  update(deltaSeconds: number): TowEvent | null {
    if (this.rock) {
      this.updateRock(this.rock, deltaSeconds);
      return null;
    }
    const satellite = this.load;
    if (!satellite) {
      return null;
    }
    if (!satellite.alive) {
      this.reset();
      return null;
    }
    const step = towStep(
      {
        shipPosition: this.ship.position.toArray(),
        shipVelocity: this.ship.velocity.toArray(),
        loadPosition: satellite.position.toArray(),
        loadVelocity: satellite.velocity.toArray(),
        loadMass: LOAD_MASS.satellite,
      },
      deltaSeconds,
    );
    if (step.snapped) {
      this.reset();
      return { type: 'snapped', satellite };
    }
    this.tension = step.tension;
    this.ship.velocity.add(new THREE.Vector3().fromArray(step.shipDelta));
    this.fleet.push(satellite, new THREE.Vector3().fromArray(step.loadDelta));
    if (!this.fleet.wear(satellite, loadStress(step.tension, deltaSeconds))) {
      this.reset();
      return { type: 'wrecked', satellite };
    }
    this.drawCable(satellite, step.stretch);
    return null;
  }

  /** Hauling a rock: heavy, but rock does not mind a hard pull. The line can still snap. */
  private updateRock(rock: Asteroid, deltaSeconds: number): void {
    if (!rock.alive) {
      this.releaseRock();
      return;
    }
    const step = towStep(
      {
        shipPosition: this.ship.position.toArray(),
        shipVelocity: this.ship.velocity.toArray(),
        loadPosition: rock.mesh.position.toArray(),
        loadVelocity: rock.velocity.toArray(),
        loadMass: this.rockMass,
      },
      deltaSeconds,
    );
    if (step.snapped) {
      this.releaseRock();
      this.snapped = true;
      return;
    }
    this.tension = step.tension;
    this.ship.velocity.add(new THREE.Vector3().fromArray(step.shipDelta));
    rock.velocity.add(new THREE.Vector3().fromArray(step.loadDelta));
    this.drawCable({ position: rock.mesh.position }, step.stretch);
  }

  /** A gentle sag while slack, straight when taut. */
  private drawCable(satellite: { position: THREE.Vector3 }, stretch: number): void {
    const start = this.ship.position.clone().add(new THREE.Vector3(0, 0, 0.8).applyQuaternion(this.ship.object.quaternion));
    const end = satellite.position;
    const sag = Math.max(0, 1 - stretch / 0.5) * 0.6;
    const down = start.clone().add(end).normalize().multiplyScalar(-sag);
    const count = this.positions.length / 3;
    const point = new THREE.Vector3();
    for (let index = 0; index < count; index += 1) {
      const t = index / (count - 1);
      point.lerpVectors(start, end, t).addScaledVector(down, Math.sin(Math.PI * t));
      point.toArray(this.positions, index * 3);
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.visible = true;
  }
}

/** For the HUD: attach range, so prompts can say how close to get. */
export const TOW_RANGE = TOW.attachRange;
