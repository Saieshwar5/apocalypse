import * as THREE from 'three';
import { OUTPOST_ORBITS, STATIONS, type StationId } from '../logic/stations';
import { orbitState } from '../logic/satellites';
import { orientationFromForward } from '../math/orientation';
import { requireNode } from '../scene/modelLibrary';
import { SHIP_SCALE } from '../ship/shipModel';
import { CITY_IDS, type CityId } from '../logic/cities';
import { buildCity, type CityModel } from './cityModels';

export type OutpostId = Exclude<StationId, 'aegis'>;
/** The smaller outposts, whose shapes are Blender models. */
export type ModelOutpostId = Exclude<OutpostId, CityId>;

/** Root node names in the Blender files (art/blender/build_outposts.py). */
const MODEL_ROOTS: Record<ModelOutpostId, string> = { vulcan: 'Vulcan', ceres: 'Ceres', halo: 'Halo' };
/** The ship is pushed out of this sphere around each station's centre. */
const BODY_RADIUS: Record<ModelOutpostId, number> = { vulcan: 3.2, ceres: 3.6, halo: 3.8 };
const CITY_SPIN: Record<CityId, number> = { meridian: 0.1, anchor: 0, farwatch: 0.03 };
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
  /** The ship is pushed out of this sphere at the centre. */
  readonly bodyRadius: number;
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
  private readonly cities = new Map<CityId, CityModel>();
  private elapsed = 0;

  constructor(models: Record<ModelOutpostId, THREE.Object3D>) {
    this.group.name = 'outposts';
    const toned = new Set<THREE.Material>();
    const ports: Record<ModelOutpostId, string> = { vulcan: 'drop_zone', ceres: 'intake', halo: 'crew_port' };
    this.list = (Object.keys(MODEL_ROOTS) as ModelOutpostId[]).map((id): Outpost => {
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
        dimWindows(node, toned);
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
        bodyRadius: BODY_RADIUS[id],
      };
    });
    // The three great stations are built here from repeated parts.
    for (const id of CITY_IDS) {
      const city = buildCity(id);
      this.cities.set(id, city);
      this.group.add(city.group);
      this.list.push({ id, name: STATIONS[id].name, color: STATIONS[id].color, group: city.group, position: city.group.position, velocity: new THREE.Vector3(), port: city.port, bodyRadius: city.bodyRadius });
    }
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
      this.ring.rotation.z += HALO_SPIN * deltaSeconds;
    }
    for (const [id, city] of this.cities) {
      if (city.turning) {
        city.turning.rotation.z += CITY_SPIN[id] * deltaSeconds;
      }
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
      const radius = outpost.bodyRadius;
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

  /** How brightly a great station's windows burn, 0..1: it follows the station's supplies. */
  setCityLights(id: CityId, level: number): void {
    const city = this.cities.get(id);
    if (city) {
      city.lights.emissiveIntensity = 0.1 + level * 1.7;
    }
  }

  /** World position of a station's port. */
  portPosition(id: OutpostId, target = new THREE.Vector3()): THREE.Vector3 {
    return this.get(id).port.getWorldPosition(target);
  }
}

/**
 * Hundreds of lit windows add up under bloom and turn Halo's ring into a
 * white blur, so window and floodlight glow is turned down once per material.
 */
const GLOW_SCALE: Record<string, number> = { OutpostWindow: 0.3, Floodlight: 0.5, BlueLight: 0.6 };

function dimWindows(node: THREE.Object3D, toned: Set<THREE.Material>): void {
  if (!(node instanceof THREE.Mesh)) {
    return;
  }
  const materials = Array.isArray(node.material) ? node.material : [node.material];
  for (const material of materials) {
    const scale = GLOW_SCALE[material.name];
    if (scale !== undefined && !toned.has(material) && material instanceof THREE.MeshStandardMaterial) {
      material.emissiveIntensity *= scale;
      toned.add(material);
    }
  }
}
