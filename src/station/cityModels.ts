import * as THREE from 'three';
import type { CityId } from '../logic/cities';

/**
 * The three great stations, built from repeated parts so that even at
 * their size they cost little to draw: one material for the hull, one for
 * the dark trim, and one shared glowing material per station for every
 * window, which the game dims or brightens with the station's supplies.
 * Each is many times the size of Aegis: a ship beside one is a speck.
 */
export interface CityModel {
  group: THREE.Group;
  /** Where ships berth. */
  port: THREE.Object3D;
  /** Every window on the station shares this; its glow follows the station's supplies. */
  lights: THREE.MeshStandardMaterial;
  /** The part that turns (Meridian's ring, Farwatch's dishes), if any. */
  turning: THREE.Object3D | null;
  /** The ship is pushed out of this sphere at the station's centre. */
  bodyRadius: number;
}

const HULL = new THREE.MeshStandardMaterial({ color: 0xb9c0c9, metalness: 0.7, roughness: 0.42 });
const DARK = new THREE.MeshStandardMaterial({ color: 0x2a3038, metalness: 0.55, roughness: 0.6 });
const PANEL = new THREE.MeshStandardMaterial({ color: 0x16284a, metalness: 0.8, roughness: 0.3, emissive: 0x06102a, emissiveIntensity: 0.6 });
const GLASS = new THREE.MeshStandardMaterial({ color: 0x9fd8c0, metalness: 0.2, roughness: 0.15, emissive: 0x2f7a55, emissiveIntensity: 0.5, transparent: true, opacity: 0.75 });

function lightsMaterial(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x111111, emissive: color, emissiveIntensity: 1.6 });
}

/** Many small lit windows in one draw call, placed by `place(index, matrix)`. */
function windows(count: number, size: [number, number, number], material: THREE.Material, place: (index: number, dummy: THREE.Object3D) => void): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(...size), material, count);
  const dummy = new THREE.Object3D();
  for (let index = 0; index < count; index += 1) {
    dummy.position.set(0, 0, 0);
    dummy.rotation.set(0, 0, 0);
    place(index, dummy);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

function port(group: THREE.Group, x: number, y: number, z: number): THREE.Object3D {
  const socket = new THREE.Object3D();
  socket.name = 'port';
  socket.position.set(x, y, z);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 8), new THREE.MeshBasicMaterial({ color: 0x7dffb0 }));
  socket.add(beacon);
  group.add(socket);
  return socket;
}

/** Meridian: a turning habitat ring on six spokes round a long hub, with farms under glass. */
function meridian(): CityModel {
  const group = new THREE.Group();
  const lights = lightsMaterial(0xffd9a0);
  const ring = new THREE.Group();
  const radius = 15;
  ring.add(new THREE.Mesh(new THREE.TorusGeometry(radius, 1.5, 14, 96), HULL));
  ring.add(new THREE.Mesh(new THREE.TorusGeometry(radius, 1.56, 6, 96, Math.PI * 2), DARK).rotateX(0).translateZ(0));
  // Two rows of windows on the inner and outer faces of the ring.
  ring.add(
    windows(720, [0.16, 0.12, 0.34], lights, (index, dummy) => {
      const angle = (index / 180) * Math.PI * 2;
      const row = Math.floor(index / 180);
      const r = radius + (row < 2 ? 1.53 : -1.53);
      dummy.position.set(Math.cos(angle) * r, Math.sin(angle) * r, row % 2 === 0 ? 0.45 : -0.45);
      dummy.rotation.z = angle;
    }),
  );
  // Farms: glass roofs set into a third of the ring.
  for (let index = 0; index < 8; index += 1) {
    const angle = (index / 24) * Math.PI * 2 + 0.2;
    const farm = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.2, 2.2), GLASS);
    farm.position.set(Math.cos(angle) * (radius - 1.5), Math.sin(angle) * (radius - 1.5), 0);
    farm.rotation.z = angle + Math.PI / 2;
    ring.add(farm);
  }
  for (let index = 0; index < 6; index += 1) {
    const angle = (index / 6) * Math.PI * 2;
    const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, radius - 2, 8), DARK);
    spoke.position.set(Math.cos(angle) * (radius / 2 + 0.6), Math.sin(angle) * (radius / 2 + 0.6), 0);
    spoke.rotation.z = angle + Math.PI / 2;
    ring.add(spoke);
  }
  group.add(ring);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 13, 24), HULL);
  hub.rotation.x = Math.PI / 2;
  group.add(hub);
  group.add(
    windows(160, [0.14, 0.3, 0.14], lights, (index, dummy) => {
      const angle = (index % 16) * (Math.PI / 8);
      dummy.position.set(Math.cos(angle) * 2.22, Math.sin(angle) * 2.22, -5.5 + Math.floor(index / 16) * 1.2);
    }),
  );
  // The dock: a long arm off the end of the hub, clear of the turning ring.
  const arm = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 9), DARK);
  arm.position.set(0, 0, 11);
  group.add(arm);
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(11, 0.08, 4), PANEL);
    wing.position.set(side * 7.2, 0, -8.6);
    group.add(wing);
  }
  return { group, port: port(group, 0, 2.6, 15), lights, turning: ring, bodyRadius: 4.5 };
}

/** Anchor: a long harbour spine lined with docks and fuel tanks, under broad solar wings. */
function anchor(): CityModel {
  const group = new THREE.Group();
  const lights = lightsMaterial(0xa8f0dc);
  const length = 30;
  const spine = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, length), HULL);
  group.add(spine);
  group.add(
    windows(360, [0.12, 0.16, 0.3], lights, (index, dummy) => {
      const side = index % 4;
      const z = -length / 2 + 0.6 + Math.floor(index / 4) * ((length - 1.2) / 90);
      const offset = 1.22;
      dummy.position.set(side === 0 ? offset : side === 1 ? -offset : (side - 2.5) * 0.9, side < 2 ? (index % 3) * 0.5 - 0.5 : side === 2 ? offset : -offset, z);
      if (side >= 2) {
        dummy.rotation.z = Math.PI / 2;
      }
    }),
  );
  // Fuel tanks in pairs along the keel, and dock arms reaching out each side.
  const tank = new THREE.SphereGeometry(1.5, 18, 12);
  const armGeometry = new THREE.BoxGeometry(6, 0.5, 0.7);
  for (let index = 0; index < 7; index += 1) {
    const z = -length / 2 + 3 + index * 4;
    for (const side of [-1, 1]) {
      const sphere = new THREE.Mesh(tank, index % 2 === 0 ? HULL : DARK);
      sphere.position.set(side * 1.7, -2.3, z);
      const arm = new THREE.Mesh(armGeometry, DARK);
      arm.position.set(side * 4.2, 0.6, z + 1.6);
      group.add(sphere, arm);
    }
  }
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(16, 0.08, 7), PANEL);
    wing.position.set(side * 10.5, 3.2, -4);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 3.2, 8), DARK);
    mast.position.set(side * 2.8, 1.8, -4);
    mast.rotation.z = side * 0.9;
    group.add(wing, mast);
  }
  // The elevator head: where the lift from the ground arrives, pointing at Earth.
  const head = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.6, 4, 16), DARK);
  head.position.set(0, -4.6, 2);
  group.add(head);
  return { group, port: port(group, 8.2, 1.4, 6.6), lights, turning: null, bodyRadius: 3.6 };
}

/** Farwatch: three great dishes on a truss, and an open shipyard frame behind them. */
function farwatch(): CityModel {
  const group = new THREE.Group();
  const lights = lightsMaterial(0xd9c2ff);
  const truss = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 22), DARK);
  group.add(truss);
  const core = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 6, 20), HULL);
  core.rotation.x = Math.PI / 2;
  group.add(core);
  group.add(
    windows(96, [0.14, 0.26, 0.14], lights, (index, dummy) => {
      const angle = (index % 16) * (Math.PI / 8);
      dummy.position.set(Math.cos(angle) * 2.42, Math.sin(angle) * 2.42, -2.4 + Math.floor(index / 16) * 0.95);
    }),
  );
  const dishes = new THREE.Group();
  const bowl = new THREE.SphereGeometry(6, 28, 10, 0, Math.PI * 2, 0, Math.PI / 3.4);
  const white = new THREE.MeshStandardMaterial({ color: 0xe4e8ee, metalness: 0.45, roughness: 0.35, side: THREE.DoubleSide });
  for (let index = 0; index < 3; index += 1) {
    const angle = (index / 3) * Math.PI * 2;
    const dish = new THREE.Mesh(bowl, white);
    dish.position.set(Math.cos(angle) * 8, Math.sin(angle) * 8, -8);
    dish.rotation.x = -Math.PI / 2;
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 8, 8), DARK);
    strut.position.set(Math.cos(angle) * 4, Math.sin(angle) * 4, -8);
    strut.rotation.z = angle + Math.PI / 2;
    const feed = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), lights);
    feed.position.set(Math.cos(angle) * 8, Math.sin(angle) * 8, -11.5);
    dishes.add(dish, strut, feed);
  }
  group.add(dishes);
  // The yard: an open box frame where hulls are built.
  const beam = new THREE.BoxGeometry(0.4, 0.4, 10);
  for (const [x, y] of [[-4, -3], [4, -3], [-4, 3], [4, 3]] as const) {
    const rail = new THREE.Mesh(beam, HULL);
    rail.position.set(x, y, 8);
    group.add(rail);
  }
  for (const z of [3.2, 8, 12.8]) {
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(5, 0.2, 6, 4), DARK);
    hoop.position.z = z;
    hoop.rotation.z = Math.PI / 4;
    group.add(hoop);
  }
  return { group, port: port(group, 0, 5.4, 8), lights, turning: dishes, bodyRadius: 3.4 };
}

export function buildCity(id: CityId): CityModel {
  const model = id === 'meridian' ? meridian() : id === 'anchor' ? anchor() : farwatch();
  model.group.name = `city-${id}`;
  return model;
}
