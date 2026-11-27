import * as THREE from 'three';
import {
  orbitState,
  planFleet,
  segmentSphereHit,
  type CircularOrbit,
  type SatelliteKind,
  type SatellitePlan,
} from '../logic/satellites';
import { orientationFromForward } from '../math/orientation';
import { requireNode } from '../scene/modelLibrary';
import { SHIP_SCALE } from '../ship/shipModel';
import { DebrisCloud, createFragmentGeometry, createFragmentMaterial } from './debrisCloud';

/** A working (or lost) satellite, as the rest of the game sees it. */
export interface Satellite {
  /** Unique within the fleet and stable for the whole run. */
  readonly id: number;
  readonly kind: SatelliteKind;
  /** World position. After destruction it stays where the satellite died. */
  readonly position: THREE.Vector3;
  /** World velocity in units per second. */
  readonly velocity: THREE.Vector3;
  /** Collision radius in world units. */
  readonly radius: number;
  readonly alive: boolean;
  /**
   * orbit: flying its own orbit. towed: on the pilot's tow line, moving
   * freely. yard: in the repair cradle at Vulcan Yard. returning: placed
   * back in its slot and easing onto the orbit.
   */
  readonly mode: SatelliteMode;
  /** A fault stops it working until the yard repairs it. */
  readonly broken: boolean;
  /** 100 when undamaged; rough towing wears it down, and at 0 it breaks up. */
  readonly condition: number;
}

export type SatelliteMode = 'orbit' | 'towed' | 'yard' | 'returning';

/** Seconds a placed satellite takes to ease back onto its orbit. */
const RETURN_SECONDS = 2.5;

/** A debris field the ship should stay out of. */
export interface DebrisHazard {
  readonly position: THREE.Vector3;
  readonly radius: number;
}

export interface SatelliteFleetOptions {
  /** Unit vector from the planet towards the sun; solar wings turn to face it. */
  sunDirection?: THREE.Vector3;
}

/** Root node in satellites.glb (art/blender/build_satellites.py) for each kind. */
const MODEL_NODES: Record<SatelliteKind, string> = {
  comms: 'Sat_Comms',
  nav: 'Sat_Nav',
  weather: 'Sat_Weather',
};

/**
 * Collision spheres, in world units. They reach to about the wing tips of
 * each model at game scale: generous for the thin wings, but a pilot who
 * clips a solar array has still hit the satellite.
 */
const COLLISION_RADIUS: Record<SatelliteKind, number> = {
  comms: 0.9,
  nav: 1.0,
  weather: 0.75,
};

/** Matches the sun the game lights the scene with (SUN_DIRECTION in game.ts). */
const DEFAULT_SUN_DIRECTION = new THREE.Vector3(1, 0.25, 0.45).normalize();

interface LiveSatellite extends Satellite {
  alive: boolean;
  mode: SatelliteMode;
  broken: boolean;
  condition: number;
  /** Seconds into the return to orbit. */
  returnTimer: number;
  /** Where a returning satellite started from, and the yard cradle it sits in. */
  readonly returnFrom: THREE.Vector3;
  holder: THREE.Object3D | null;
  /** Small red fault light, shown while broken. */
  readonly faultLight: THREE.Mesh;
  readonly orbit: CircularOrbit;
  /** Holds the model; positioned and turned each frame. */
  readonly object: THREE.Group;
  /** Solar wing pivots; each turns about its own X axis. */
  readonly wings: THREE.Object3D[];
}

const FAULT_GEOMETRY = new THREE.SphereGeometry(0.12, 8, 6);
const FAULT_MATERIAL = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.3, 0.2) });

const scratchForward = new THREE.Vector3();
const scratchUp = new THREE.Vector3();
const scratchSun = new THREE.Vector3();
const scratchQuaternion = new THREE.Quaternion();

/**
 * The planet's artificial satellites: eight of them on tilted circular
 * orbits at three heights. They are bystanders in the fight. Each one that
 * survives extends the scanner (see `scannerRangeBonus`); each one destroyed
 * leaves a debris cloud on the same orbit for the rest of the run.
 *
 * Add `group` to the scene at the origin with no transform: positions
 * reported here are world positions only under that assumption.
 */
export class SatelliteFleet {
  readonly group = new THREE.Group();
  private readonly prototypes: Record<SatelliteKind, THREE.Object3D>;
  private readonly sunDirection: THREE.Vector3;
  private readonly fragmentGeometry = createFragmentGeometry();
  private readonly fragmentMaterial = createFragmentMaterial();
  private live: LiveSatellite[] = [];
  private clouds: DebrisCloud[] = [];
  /** Seconds since the last reset; every orbit is a function of this clock. */
  private elapsed = 0;

  /**
   * @param source the loaded satellites.glb scene (`models.satellites`)
   * @param rng picks the orbits on every reset, and the debris scatter
   */
  constructor(
    source: THREE.Object3D,
    private readonly rng: () => number,
    options: SatelliteFleetOptions = {},
  ) {
    this.group.name = 'satellites';
    this.sunDirection = (options.sunDirection ?? DEFAULT_SUN_DIRECTION).clone().normalize();
    this.prototypes = {
      comms: createPrototype(source, 'comms'),
      nav: createPrototype(source, 'nav'),
      weather: createPrototype(source, 'weather'),
    };
    this.reset();
  }

  /** Every satellite of this run, including destroyed ones (`alive` false). */
  get satellites(): readonly Satellite[] {
    return this.live;
  }

  /** Debris clouds from satellites destroyed this run. */
  get debrisClouds(): readonly DebrisHazard[] {
    return this.clouds;
  }

  /** Satellites doing their job: alive, not broken and in orbit. */
  get aliveCount(): number {
    let count = 0;
    for (const satellite of this.live) {
      count += satellite.alive && !satellite.broken && satellite.mode === 'orbit' ? 1 : 0;
    }
    return count;
  }

  /** Where the satellite's place on its orbit is, `secondsAhead` from now. */
  slot(satellite: Satellite, secondsAhead = 0): { position: THREE.Vector3; velocity: THREE.Vector3 } {
    const state = orbitState(this.find(satellite).orbit, this.elapsed + secondsAhead);
    return { position: new THREE.Vector3().fromArray(state.position), velocity: new THREE.Vector3().fromArray(state.velocity) };
  }

  /** Takes the satellite off its orbit onto the tow line; it keeps its motion. */
  takeInTow(satellite: Satellite): void {
    const target = this.find(satellite);
    if (target.mode === 'yard' && target.holder) {
      target.holder.getWorldPosition(target.position);
      target.holder = null;
      this.group.add(target.object);
    }
    target.mode = 'towed';
  }

  /** Changes a towed satellite's velocity (the tow line's pull). */
  push(satellite: Satellite, deltaVelocity: THREE.Vector3): void {
    this.find(satellite).velocity.add(deltaVelocity);
  }

  /** Rough handling wears the satellite down; at zero it breaks up. Returns true if it survives. */
  wear(satellite: Satellite, amount: number): boolean {
    const target = this.find(satellite);
    target.condition = Math.max(0, target.condition - amount);
    return target.condition > 0;
  }

  /** Leaves the satellite in a yard cradle, following `holder`. */
  stow(satellite: Satellite, holder: THREE.Object3D): void {
    const target = this.find(satellite);
    target.mode = 'yard';
    target.holder = holder;
    target.velocity.set(0, 0, 0);
  }

  /** Released in its slot: eases back onto its orbit. */
  returnToOrbit(satellite: Satellite): void {
    const target = this.find(satellite);
    target.mode = 'returning';
    target.returnTimer = 0;
    target.returnFrom.copy(target.position);
  }

  breakDown(satellite: Satellite): void {
    this.find(satellite).broken = true;
  }

  repair(satellite: Satellite): void {
    const target = this.find(satellite);
    target.broken = false;
    target.condition = 100;
  }

  /** Clears wrecks and debris and launches a fresh fleet on new orbits. */
  reset(): void {
    for (const satellite of this.live) {
      // The clones share geometry and materials with the loaded model, so
      // there is nothing of their own to free: detaching is enough.
      satellite.object.removeFromParent();
    }
    for (const cloud of this.clouds) {
      cloud.dispose();
    }
    this.clouds = [];
    this.elapsed = 0;
    this.live = planFleet(this.rng).map((plan, index) => this.launch(plan, index + 1));
    this.update(0);
  }

  /** Advances the orbits, the solar wings and the debris clouds. */
  update(deltaSeconds: number): void {
    this.elapsed += deltaSeconds;
    for (const satellite of this.live) {
      if (!satellite.alive) {
        continue;
      }
      satellite.faultLight.visible = satellite.broken && Math.sin(this.elapsed * 6) > 0;
      if (satellite.mode === 'orbit') {
        this.place(satellite);
      } else if (satellite.mode === 'towed') {
        satellite.position.addScaledVector(satellite.velocity, deltaSeconds);
      } else if (satellite.mode === 'yard' && satellite.holder) {
        // Follow the cradle, and keep its velocity so the ship can match it.
        satellite.returnFrom.copy(satellite.position);
        satellite.holder.getWorldPosition(satellite.position);
        if (deltaSeconds > 0) {
          satellite.velocity.subVectors(satellite.position, satellite.returnFrom).divideScalar(deltaSeconds);
        }
        satellite.holder.getWorldQuaternion(satellite.object.quaternion);
      } else if (satellite.mode === 'returning') {
        this.easeBack(satellite, deltaSeconds);
      }
    }
    for (const cloud of this.clouds) {
      cloud.update(this.elapsed, deltaSeconds);
    }
  }

  /**
   * Removes a satellite and leaves a debris cloud on its orbit. Returns
   * where it was so the caller can play the explosion there. Destroying the
   * same satellite twice is harmless and makes no second cloud.
   */
  destroy(satellite: Satellite): THREE.Vector3 {
    const target = this.live.find((candidate) => candidate === satellite || candidate.id === satellite.id);
    if (target?.alive) {
      target.alive = false;
      target.holder = null;
      target.object.removeFromParent();
      const cloud = new DebrisCloud(this.fragmentGeometry, this.fragmentMaterial, target.orbit, this.rng);
      cloud.update(this.elapsed, 0);
      this.clouds.push(cloud);
      this.group.add(cloud.mesh);
    }
    return satellite.position.clone();
  }

  /**
   * The first living satellite that the segment from `start` to `end`
   * touches: one frame of travel of a laser bolt or missile.
   */
  findHit(start: THREE.Vector3, end: THREE.Vector3): Satellite | null {
    const from = start.toArray();
    const to = end.toArray();
    let nearest: Satellite | null = null;
    let nearestAt = Infinity;
    for (const satellite of this.live) {
      if (!satellite.alive) {
        continue;
      }
      const at = segmentSphereHit(from, to, satellite.position.toArray(), satellite.radius);
      if (at !== null && at < nearestAt) {
        nearest = satellite;
        nearestAt = at;
      }
    }
    return nearest;
  }

  /** The closest living satellite whose sphere overlaps the given sphere (ship, asteroid). */
  findOverlap(position: THREE.Vector3, radius: number, ignore: Satellite | null = null): Satellite | null {
    let nearest: Satellite | null = null;
    let nearestGap = 0;
    for (const satellite of this.live) {
      if (!satellite.alive || satellite === ignore || satellite.mode === 'yard') {
        continue;
      }
      const gap = satellite.position.distanceTo(position) - satellite.radius - radius;
      if (gap < nearestGap) {
        nearest = satellite;
        nearestGap = gap;
      }
    }
    return nearest;
  }

  /** For when the fleet itself is thrown away (not needed between runs). */
  dispose(): void {
    for (const satellite of this.live) {
      satellite.object.removeFromParent();
    }
    for (const cloud of this.clouds) {
      cloud.dispose();
    }
    this.live = [];
    this.clouds = [];
    this.fragmentGeometry.dispose();
    this.fragmentMaterial.dispose();
  }

  private launch(plan: SatellitePlan, id: number): LiveSatellite {
    const object = new THREE.Group();
    object.name = `satellite-${id}-${plan.kind}`;
    const model = this.prototypes[plan.kind].clone(true);
    object.add(model);
    this.group.add(object);
    const faultLight = new THREE.Mesh(FAULT_GEOMETRY, FAULT_MATERIAL);
    faultLight.position.set(0, COLLISION_RADIUS[plan.kind] * 0.6, 0);
    faultLight.visible = false;
    object.add(faultLight);
    return {
      id,
      kind: plan.kind,
      position: object.position,
      velocity: new THREE.Vector3(),
      radius: COLLISION_RADIUS[plan.kind],
      alive: true,
      mode: 'orbit',
      broken: false,
      condition: 100,
      returnTimer: 0,
      returnFrom: new THREE.Vector3(),
      holder: null,
      faultLight,
      orbit: plan.orbit,
      object,
      wings: model.children.filter((child) => child.name.startsWith('Wing_')),
    };
  }

  private find(satellite: Satellite): LiveSatellite {
    const target = this.live.find((candidate) => candidate === satellite || candidate.id === satellite.id);
    if (!target) {
      throw new Error(`Satellite ${satellite.id} is not in this fleet`);
    }
    return target;
  }

  /** Slides a placed satellite from where it was left onto its moving slot. */
  private easeBack(satellite: LiveSatellite, deltaSeconds: number): void {
    satellite.returnTimer += deltaSeconds;
    const t = Math.min(1, satellite.returnTimer / RETURN_SECONDS);
    const blend = t * t * (3 - 2 * t);
    const from = satellite.returnFrom.clone();
    this.place(satellite);
    satellite.position.lerpVectors(from, satellite.position, blend);
    if (t >= 1) {
      satellite.mode = 'orbit';
    }
  }

  private place(satellite: LiveSatellite): void {
    const state = orbitState(satellite.orbit, this.elapsed);
    satellite.position.fromArray(state.position);
    satellite.velocity.fromArray(state.velocity);
    // The model flies -Z first with +Y away from the planet, so its dish
    // and antennas (on -Y) always look down at the ground.
    scratchForward.copy(satellite.velocity).normalize();
    scratchUp.copy(satellite.position).normalize();
    orientationFromForward(scratchForward, scratchUp, satellite.object.quaternion);
    // The body turns once per orbit to keep facing the planet, so the wings
    // must counter-rotate to keep their cells on the sun. A wing can only
    // turn about its long (X) axis: aim its cell side (+Y) at the part of
    // the sun direction that lies across that axis.
    scratchSun.copy(this.sunDirection).applyQuaternion(scratchQuaternion.copy(satellite.object.quaternion).invert());
    const wingAngle = Math.atan2(scratchSun.z, scratchSun.y);
    for (const wing of satellite.wings) {
      wing.rotation.set(wingAngle, 0, 0);
    }
  }
}

/**
 * Cuts one satellite out of the shared file. The three roots sit side by
 * side there (for the Blender preview), so the copy is moved to its own
 * origin and scaled from metres to game units.
 */
function createPrototype(source: THREE.Object3D, kind: SatelliteKind): THREE.Object3D {
  const prototype = requireNode(source, MODEL_NODES[kind]).clone(true);
  prototype.position.set(0, 0, 0);
  prototype.scale.setScalar(SHIP_SCALE);
  return prototype;
}
