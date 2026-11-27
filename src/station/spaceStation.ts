import * as THREE from 'three';
import { STATION_STOCK, deliverSupplies, type StationStock } from '../logic/stationSupply';
import { orientationFromForward } from '../math/orientation';
import { requireNode } from '../scene/modelLibrary';
import { SHIP_SCALE } from '../ship/shipModel';

const ORBIT_RADIUS = 24;
const ORBIT_PERIOD_SECONDS = 320;
/** The station starts this far (radians) ahead of the ship along its path. */
const START_LEAD = 0.55;

/**
 * Aegis, the orbital supply station (model: art/blender/build_station.py).
 * It circles Earth with its docking bay facing the direction of travel, and
 * holds the fuel and missiles that supply rockets bring up.
 */
export class SpaceStation {
  readonly group = new THREE.Group();
  readonly velocity = new THREE.Vector3();
  stock: StationStock = { ...STATION_STOCK.initial };
  private readonly ring: THREE.Object3D;
  private readonly dockPort: THREE.Vector3;
  private readonly guideLights: THREE.MeshStandardMaterial[] = [];
  private readonly beacons: THREE.MeshStandardMaterial[] = [];
  private readonly axisA = new THREE.Vector3(1, 0, 0);
  private readonly axisB = new THREE.Vector3(0, 0, -1);
  private angle = 0;
  private elapsed = 0;

  constructor(source: THREE.Object3D) {
    const model = source.clone(true);
    model.scale.setScalar(SHIP_SCALE);
    this.group.add(model);
    this.group.updateMatrixWorld(true);
    this.ring = requireNode(model, 'Ring');
    this.dockPort = this.group.worldToLocal(requireNode(model, 'dock_port').getWorldPosition(new THREE.Vector3()));
    const seen = new Set<THREE.Material>();
    model.traverse((node) => {
      if (!(node instanceof THREE.Mesh) || seen.has(node.material as THREE.Material)) {
        return;
      }
      const material = node.material as THREE.MeshStandardMaterial;
      seen.add(material);
      if (material.name === 'GuideLight') {
        this.guideLights.push(material);
      } else if (material.name === 'StationBeacon') {
        this.beacons.push(material);
      }
    });
    this.group.visible = false;
  }

  get position(): THREE.Vector3 {
    return this.group.position;
  }

  /** Starts the orbit a little ahead of the ship, so the pilot sees the station on arrival. */
  placeAheadOf(shipPosition: THREE.Vector3, shipForward: THREE.Vector3): void {
    this.axisA.copy(shipPosition).normalize();
    this.axisB.copy(shipForward).addScaledVector(this.axisA, -shipForward.dot(this.axisA)).normalize();
    this.angle = START_LEAD;
    this.stock = { ...STATION_STOCK.initial };
    this.group.visible = true;
    this.update(0, false);
  }

  hide(): void {
    this.group.visible = false;
  }

  /** `docking` makes the bay's guide lights chase faster. */
  update(deltaSeconds: number, docking: boolean): void {
    this.elapsed += deltaSeconds;
    const rate = (Math.PI * 2) / ORBIT_PERIOD_SECONDS;
    this.angle += rate * deltaSeconds;
    const radial = this.axisA.clone().multiplyScalar(Math.cos(this.angle)).addScaledVector(this.axisB, Math.sin(this.angle));
    const prograde = this.axisB.clone().multiplyScalar(Math.cos(this.angle)).addScaledVector(this.axisA, -Math.sin(this.angle));
    this.group.position.copy(radial).multiplyScalar(ORBIT_RADIUS);
    this.velocity.copy(prograde).multiplyScalar(ORBIT_RADIUS * rate);
    // Bay (the model's -Z) faces the direction of travel; "up" is away from Earth.
    orientationFromForward(prograde, radial, this.group.quaternion);
    // The hub runs along the model's Z axis, so the ring spins about it.
    this.ring.rotateZ(deltaSeconds * 0.35);

    const pulse = docking ? 0.5 + 0.5 * Math.sin(this.elapsed * 14) : 0.6 + 0.4 * Math.sin(this.elapsed * 2.5);
    for (const light of this.guideLights) {
      light.emissiveIntensity = 2 + 5 * pulse;
    }
    const blink = this.elapsed % 1.4 < 0.15 ? 6 : 0.5;
    for (const beacon of this.beacons) {
      beacon.emissiveIntensity = blink;
    }
  }

  /** Where a docked ship sits: in the bay, nose pointing out. */
  dockPose(): { position: THREE.Vector3; orientation: THREE.Quaternion } {
    this.group.updateMatrixWorld(true);
    return { position: this.group.localToWorld(this.dockPort.clone()), orientation: this.group.quaternion.clone() };
  }

  receiveSupplies(): void {
    this.stock = deliverSupplies(this.stock);
  }
}
