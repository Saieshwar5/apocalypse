import * as THREE from 'three';

const PARTICLES = 700;
const BOX = 70;
const HALF = BOX / 2;
/** Streak length is the ship's velocity multiplied by this many seconds. */
const STREAK_SECONDS = 0.07;

/**
 * Faint dust floating in space around the ship. It does not move; the ship
 * moves through it, so it shows the player's own speed and direction. Fast
 * flight stretches each speck into a streak. Particles wrap around a box
 * that follows the ship, so there are always some nearby.
 */
export class SpaceDust {
  readonly lines: THREE.LineSegments;
  private readonly anchors = new Float32Array(PARTICLES * 3);
  private readonly positions = new Float32Array(PARTICLES * 6);
  private readonly colors = new Float32Array(PARTICLES * 6);

  constructor() {
    for (let index = 0; index < PARTICLES; index += 1) {
      this.anchors.set([Math.random() * BOX, Math.random() * BOX, Math.random() * BOX], index * 3);
      const brightness = 0.12 + Math.random() * 0.2;
      this.colors.set([brightness, brightness * 1.05, brightness * 1.15, 0, 0, 0], index * 6);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.lines = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.lines.frustumCulled = false;
  }

  update(centre: THREE.Vector3, velocity: THREE.Vector3): void {
    const streakX = velocity.x * STREAK_SECONDS;
    const streakY = velocity.y * STREAK_SECONDS;
    const streakZ = velocity.z * STREAK_SECONDS;
    for (let index = 0; index < PARTICLES; index += 1) {
      const x = wrap(this.anchors[index * 3] - centre.x) + centre.x;
      const y = wrap(this.anchors[index * 3 + 1] - centre.y) + centre.y;
      const z = wrap(this.anchors[index * 3 + 2] - centre.z) + centre.z;
      const offset = index * 6;
      this.positions[offset] = x;
      this.positions[offset + 1] = y;
      this.positions[offset + 2] = z;
      // Minimum length keeps a speck visible when the ship is still.
      this.positions[offset + 3] = x - streakX + 0.03;
      this.positions[offset + 4] = y - streakY;
      this.positions[offset + 5] = z - streakZ;
    }
    this.lines.geometry.getAttribute('position').needsUpdate = true;
  }
}

/** Maps any offset into [-HALF, HALF) so the dust box follows the ship. */
function wrap(value: number): number {
  return ((((value + HALF) % BOX) + BOX) % BOX) - HALF;
}
