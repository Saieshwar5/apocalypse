import * as THREE from 'three';
import type { ModuleId } from '../logic/shipModules';

/**
 * The modules as hardware on the hull, so a fitted ship looks loaded: a
 * cargo pod slung under the belly, a pressurised crew cabin on the spine,
 * conformal tanks on the flanks, a winch drum at the tail, the folded
 * sweeper net, missile pods under the wings and a scanner dish on a mast.
 * Built from simple shapes in the ship's own frame (forward is -Z), sized
 * from the hull's bounds.
 */
export class ModuleHardware {
  readonly group = new THREE.Group();
  private readonly parts = new Map<ModuleId, THREE.Group>();
  private readonly dish: THREE.Object3D;
  private readonly beacon: THREE.MeshStandardMaterial;

  constructor(bounds: THREE.Box3) {
    const size = bounds.getSize(new THREE.Vector3());
    const centre = bounds.getCenter(new THREE.Vector3());
    const length = size.z;
    const half = size.x / 2;
    const top = bounds.max.y;
    const belly = bounds.min.y;
    const tail = bounds.max.z;

    const hull = new THREE.MeshStandardMaterial({ color: 0xa7b0ba, metalness: 0.65, roughness: 0.38 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x262b33, metalness: 0.5, roughness: 0.55 });
    const hazard = new THREE.MeshStandardMaterial({ color: 0xff8a2a, metalness: 0.3, roughness: 0.5 });
    const yellow = new THREE.MeshStandardMaterial({ color: 0xf2c230, metalness: 0.35, roughness: 0.45 });
    const warm = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffc27a, emissiveIntensity: 2.2 });
    const cyan = new THREE.MeshStandardMaterial({ color: 0x0c2a33, emissive: 0x47e6ff, emissiveIntensity: 1.4, metalness: 0.4, roughness: 0.4 });
    const red = new THREE.MeshStandardMaterial({ color: 0xd8322a, metalness: 0.3, roughness: 0.4 });
    this.beacon = new THREE.MeshStandardMaterial({ color: 0x0a1a0e, emissive: 0x6dff9a, emissiveIntensity: 3 });

    const r = length * 0.065;

    // Cargo pod: a capsule slung under the belly on two pylons, with hazard bands.
    this.add('cargoPod', (part) => {
      const pod = new THREE.Mesh(new THREE.CapsuleGeometry(r * 1.0, length * 0.26, 6, 16), hull);
      pod.rotation.x = Math.PI / 2;
      pod.position.set(0, belly - r * 1.2, centre.z + length * 0.06);
      for (const offset of [-0.11, 0.11]) {
        const band = new THREE.Mesh(new THREE.TorusGeometry(r * 1.02, r * 0.11, 6, 24), hazard);
        band.position.set(0, pod.position.y, pod.position.z + length * offset);
        const pylon = new THREE.Mesh(new THREE.BoxGeometry(r * 0.25, r * 0.6, r * 0.9), dark);
        pylon.position.set(0, belly - r * 0.25, pod.position.z + length * offset * 1.2);
        part.add(band, pylon);
      }
      part.add(pod);
    });

    // Crew cabin: a pressurised can on the spine with lit windows.
    this.add('crewCabin', (part) => {
      const can = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.7, r * 0.7, length * 0.18, 18), hull);
      can.rotation.x = Math.PI / 2;
      can.position.set(0, top - r * 0.15, centre.z + length * 0.14);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(r * 0.7, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), hull);
      cap.rotation.x = -Math.PI / 2;
      cap.position.set(0, can.position.y, can.position.z - length * 0.09);
      part.add(can, cap);
      for (const side of [-1, 1]) {
        for (let index = 0; index < 3; index += 1) {
          const window = new THREE.Mesh(new THREE.BoxGeometry(r * 0.05, r * 0.28, r * 0.32), warm);
          window.position.set(side * r * 0.7, can.position.y + r * 0.12, can.position.z - length * 0.05 + index * length * 0.05);
          part.add(window);
        }
      }
    });

    // Auxiliary tank: conformal tanks along both flanks.
    this.add('auxTank', (part) => {
      for (const side of [-1, 1]) {
        const tank = new THREE.Mesh(new THREE.CapsuleGeometry(r * 0.55, length * 0.32, 6, 14), new THREE.MeshStandardMaterial({ color: 0xe9ecef, metalness: 0.25, roughness: 0.5 }));
        tank.rotation.x = Math.PI / 2;
        tank.position.set(side * half * 0.62, centre.y - r * 0.4, centre.z + length * 0.1);
        const stripe = new THREE.Mesh(new THREE.TorusGeometry(r * 0.56, r * 0.07, 6, 18), hazard);
        stripe.position.copy(tank.position);
        part.add(tank, stripe);
      }
    });

    // Heavy winch: a yellow drum across the tail with dark cable wound on it.
    this.add('heavyWinch', (part) => {
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, r * 2.2, 18), dark);
      drum.rotation.z = Math.PI / 2;
      drum.position.set(0, belly + r * 0.1, tail - length * 0.06);
      for (const side of [-1, 1]) {
        const plate = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r * 0.8, r * 0.18, 18), yellow);
        plate.rotation.z = Math.PI / 2;
        plate.position.set(side * r * 1.15, drum.position.y, drum.position.z);
        part.add(plate);
      }
      part.add(drum);
    });

    // Sweeper net: a folded hexagonal frame with a faint glowing mesh, on the back.
    this.add('sweeperNet', (part) => {
      const frame = new THREE.Mesh(new THREE.TorusGeometry(r * 1.4, r * 0.09, 4, 6), cyan);
      frame.position.set(0, top + r * 0.2, tail - length * 0.2);
      frame.rotation.x = Math.PI / 2;
      const net = new THREE.Mesh(
        new THREE.CircleGeometry(r * 1.35, 6),
        new THREE.MeshBasicMaterial({ color: 0x47e6ff, wireframe: true, transparent: true, opacity: 0.35 }),
      );
      net.position.copy(frame.position);
      net.rotation.x = -Math.PI / 2;
      part.add(frame, net);
    });

    // Missile pod: a pod under each wing with three red-tipped rounds.
    this.add('missilePod', (part) => {
      for (const side of [-1, 1]) {
        const pod = new THREE.Mesh(new THREE.BoxGeometry(r * 1.1, r * 0.75, length * 0.3), dark);
        pod.position.set(side * half * 0.8, belly + r * 0.3, centre.z + length * 0.05);
        part.add(pod);
        for (let index = -1; index <= 1; index += 1) {
          const tip = new THREE.Mesh(new THREE.ConeGeometry(r * 0.16, r * 0.5, 10), red);
          tip.rotation.x = -Math.PI / 2;
          tip.position.set(pod.position.x + index * r * 0.33, pod.position.y, pod.position.z - length * 0.15 - r * 0.2);
          part.add(tip);
        }
      }
    });

    // Long-range scanner: a dish on a mast that sweeps slowly, with a beacon.
    const mast = new THREE.Group();
    this.dish = mast;
    this.add('longScanner', (part) => {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.08, r * 0.1, r * 1.2, 8), dark);
      pole.position.y = r * 0.6;
      const dish = new THREE.Mesh(new THREE.SphereGeometry(r * 0.75, 18, 8, 0, Math.PI * 2, 0, Math.PI / 3.2), new THREE.MeshStandardMaterial({ color: 0xdfe5ea, metalness: 0.5, roughness: 0.3, side: THREE.DoubleSide }));
      dish.position.y = r * 1.3;
      dish.rotation.x = Math.PI * 0.62;
      const light = new THREE.Mesh(new THREE.SphereGeometry(r * 0.09, 8, 6), this.beacon);
      light.position.y = r * 1.3;
      mast.add(pole, dish, light);
      mast.position.set(0, top - r * 0.3, centre.z - length * 0.12);
      part.add(mast);
    });
  }

  show(fitted: readonly ModuleId[]): void {
    for (const [id, part] of this.parts) {
      part.visible = fitted.includes(id);
    }
  }

  update(elapsedSeconds: number): void {
    this.dish.rotation.y = elapsedSeconds * 0.9;
    this.beacon.emissiveIntensity = elapsedSeconds % 1.4 < 0.15 ? 4 : 0.6;
  }

  private add(id: ModuleId, build: (part: THREE.Group) => void): void {
    const part = new THREE.Group();
    part.name = `module-${id}`;
    part.visible = false;
    build(part);
    this.parts.set(id, part);
    this.group.add(part);
  }
}
