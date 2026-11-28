import * as THREE from 'three';

const SEGMENTS = 96;
const POOL = 9;

/**
 * Orbit lines for the tactical map: for each object, the circle it is
 * flying, worked out from where it is and which way it moves. Shown on the
 * map for the stations and the nav target, so the pilot sees where things
 * will be, not only where they are.
 */
export class OrbitRings {
  readonly group = new THREE.Group();
  private readonly rings: THREE.LineLoop[] = [];

  constructor() {
    for (let index = 0; index < POOL; index += 1) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SEGMENTS * 3), 3));
      const ring = new THREE.LineLoop(geometry, new THREE.LineBasicMaterial({ transparent: true, opacity: 0.4, depthWrite: false }));
      ring.frustumCulled = false;
      ring.visible = false;
      this.rings.push(ring);
      this.group.add(ring);
    }
  }

  /** `orbits`: the objects to draw rings for (position, velocity and colour), or none to hide them all. */
  show(orbits: readonly { position: THREE.Vector3; velocity: THREE.Vector3; color: string }[]): void {
    this.rings.forEach((ring, index) => {
      const orbit = orbits[index];
      if (!orbit || orbit.velocity.lengthSq() < 1e-6) {
        ring.visible = false;
        return;
      }
      const radius = orbit.position.length();
      const u = orbit.position.clone().normalize();
      const normal = orbit.position.clone().cross(orbit.velocity).normalize();
      const v = normal.clone().cross(u).normalize();
      const positions = ring.geometry.attributes.position as THREE.BufferAttribute;
      for (let step = 0; step < SEGMENTS; step += 1) {
        const angle = (step / SEGMENTS) * Math.PI * 2;
        positions.setXYZ(step, (u.x * Math.cos(angle) + v.x * Math.sin(angle)) * radius, (u.y * Math.cos(angle) + v.y * Math.sin(angle)) * radius, (u.z * Math.cos(angle) + v.z * Math.sin(angle)) * radius);
      }
      positions.needsUpdate = true;
      (ring.material as THREE.LineBasicMaterial).color.set(orbit.color);
      ring.visible = true;
    });
  }
}
