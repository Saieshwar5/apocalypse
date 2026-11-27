import * as THREE from 'three';
import { OUTPOST_ORBITS, STATIONS, type StationId } from '../logic/stations';
import { orbitState } from '../logic/satellites';
import { orientationFromForward } from '../math/orientation';
import { requireNode } from '../scene/modelLibrary';
import { SHIP_SCALE } from '../ship/shipModel';

export type OutpostId = Exclude<StationId, 'aegis'>;

/** Root node names in the Blender files (art/blender/build_outposts.py). */
const MODEL_ROOTS: Record<OutpostId, string> = { vulcan: 'Vulcan', ceres: 'Ceres', halo: 'Halo' };
/** The ship is pushed out of this sphere around each station's centre. */
const BODY_RADIUS: Record<OutpostId, number> = { vulcan: 3.2, ceres: 3.6, halo: 3.8 };
const HALO_SPIN = 0.12;

export interface Outpost {
  readonly id: OutpostId;
  readonly name: string;
  readonly color: string;
  readonly group: THREE.Group;
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  /** Socket on the model: the repair cradle, the refinery intake or the crew port. */
  readonly port: THREE.Object3D;
}

/**
 * Vulcan Yard, Ceres Works and Halo: stations on fixed orbits of their own,
 * at different heights, so each trip between them is a real flight.
 */
export class Outposts {
  readonly group = new THREE.Group();
  readonly list: Outpost[];
  private readonly beacons: THREE.Object3D[] = [];
  private readonly ring: THREE.Object3D | null;
  private elapsed = 0;

  constructor(models: Record<OutpostId, THREE.Object3D>) {
    this.group.name = 'outposts';
    const ports: Record<OutpostId, string> = { vulcan: 'drop_zone', ceres: 'intake', halo: 'crew_port' };
    this.list = (Object.keys(MODEL_ROOTS) as OutpostId[]).map((id) => {
      const group = new THREE.Group();
      group.name = `outpost-${id}`;
      const model = requireNode(models[id], MODEL_ROOTS[id]).clone(true);
      model.position.set(0, 0, 0);
      model.scale.setScalar(SHIP_SCALE);
      group.add(model);
      model.traverse((node) => {
        if (node.name.startsWith('Beacon')) {
          this.beacons.push(node);
        }
      });
      this.group.add(group);
      return {
        id,
        name: STATIONS[id].name,
        color: STATIONS[id].color,
        group,
        position: group.position,
        velocity: new THREE.Vector3(),
        port: requireNode(model, ports[id]),
      };
    });
    this.ring = this.get('halo').group.getObjectByName('HaloRing') ?? null;
    this.reset();
  }

  get(id: OutpostId): Outpost {
    const outpost = this.list.find((candidate) => candidate.id === id);
    if (!outpost) {
      throw new Error(`Unknown outpost ${id}`);
    }
    return outpost;
  }

  reset(): void {
    this.elapsed = 0;
    this.update(0);
  }

  update(deltaSeconds: number): void {
    this.elapsed += deltaSeconds;
    const forward = new THREE.Vector3();
    const up = new THREE.Vector3();
    for (const outpost of this.list) {
      const state = orbitState(OUTPOST_ORBITS[outpost.id], this.elapsed);
      outpost.position.fromArray(state.position);
      outpost.velocity.fromArray(state.velocity);
      forward.copy(outpost.velocity).normalize();
      up.copy(outpost.position).normalize();
      orientationFromForward(forward, up, outpost.group.quaternion);
    }
    if (this.ring) {
      this.ring.rotation.y += HALO_SPIN * deltaSeconds;
    }
    const blink = Math.sin(this.elapsed * 3) > 0.6;
    for (const beacon of this.beacons) {
      beacon.visible = blink;
    }
    this.group.updateMatrixWorld();
  }

  /** Bumps the ship off a station's body instead of letting it fly through. */
  collide(position: THREE.Vector3, velocity: THREE.Vector3): void {
    for (const outpost of this.list) {
      const offset = position.clone().sub(outpost.position);
      const distance = offset.length();
      const radius = BODY_RADIUS[outpost.id];
      if (distance >= radius || distance === 0) {
        continue;
      }
      const normal = offset.divideScalar(distance);
      position.copy(outpost.position).addScaledVector(normal, radius);
      const inward = velocity.clone().sub(outpost.velocity).dot(normal);
      if (inward < 0) {
        velocity.addScaledVector(normal, -inward * 1.4);
      }
    }
  }

  /** World position of a station's port. */
  portPosition(id: OutpostId, target = new THREE.Vector3()): THREE.Vector3 {
    return this.get(id).port.getWorldPosition(target);
  }
}
