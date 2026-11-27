import * as THREE from 'three';

export type DebrisKind = 'rock' | 'ice';

export interface DebrisOptions {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  /** Rough radius; each chunk is squashed a little differently. */
  size: number;
  lifetime: number;
  /** 0 = cold, 1 = glowing from the blast. Ignored by ice. */
  heat: number;
}

interface Chunk {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  axis: THREE.Vector3;
  scale: THREE.Vector3;
  angle: number;
  spinRate: number;
  age: number;
  lifetime: number;
  heat: number;
  phase: number;
}

/** Chunks drift on almost unbraked; a little drag keeps them near the blast. */
const DRAG = 0.35;
/** Chunks shrink away over this last fraction of their life instead of popping. */
const VANISH_FRACTION = 0.3;
const HEAT_FADE_PER_SECOND = 1.9;

const matrix = new THREE.Matrix4();
const rotation = new THREE.Quaternion();
const scale = new THREE.Vector3();

/**
 * Solid tumbling fragments, drawn as one instanced mesh per kind. Rock
 * chunks are lit by the sun and glow where the blast heated them, cooling
 * as they fly; ice shards are glossy slivers that flash as they turn.
 */
export class DebrisChunks {
  readonly mesh: THREE.InstancedMesh;
  private readonly chunks: Chunk[];
  private readonly glow: THREE.InstancedBufferAttribute;
  private count = 0;

  constructor(
    private readonly kind: DebrisKind,
    capacity: number,
  ) {
    const geometry = kind === 'rock' ? createRockChunkGeometry() : createShardGeometry();
    this.glow = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.glow.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aGlow', this.glow);
    this.mesh = new THREE.InstancedMesh(geometry, createMaterial(kind), capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    // Instances are spread over the whole play area.
    this.mesh.frustumCulled = false;
    this.chunks = Array.from({ length: capacity }, () => ({
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      axis: new THREE.Vector3(0, 1, 0),
      scale: new THREE.Vector3(1, 1, 1),
      angle: 0,
      spinRate: 0,
      age: 0,
      lifetime: 1,
      heat: 0,
      phase: 0,
    }));
  }

  /** Does nothing when the pool is full: missing a few chunks is not noticeable. */
  spawn(options: DebrisOptions): void {
    if (this.count >= this.chunks.length) {
      return;
    }
    const chunk = this.chunks[this.count];
    this.count += 1;
    chunk.position.copy(options.position);
    chunk.velocity.copy(options.velocity);
    chunk.axis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    chunk.scale
      .set(0.7 + Math.random() * 0.6, 0.55 + Math.random() * 0.5, 0.7 + Math.random() * 0.6)
      .multiplyScalar(options.size);
    chunk.angle = Math.random() * Math.PI * 2;
    // Small pieces spin faster, as they would for the same kick.
    chunk.spinRate = (1.5 + Math.random() * 5) / Math.max(0.35, Math.sqrt(options.size * 6));
    chunk.age = 0;
    chunk.lifetime = options.lifetime;
    chunk.heat = options.heat;
    chunk.phase = Math.random() * Math.PI * 2;
  }

  update(deltaSeconds: number): void {
    const glow = this.glow.array as Float32Array;
    const slowdown = Math.exp(-DRAG * deltaSeconds);
    let index = 0;
    while (index < this.count) {
      const chunk = this.chunks[index];
      chunk.age += deltaSeconds;
      if (chunk.age >= chunk.lifetime) {
        this.count -= 1;
        this.chunks[index] = this.chunks[this.count];
        this.chunks[this.count] = chunk;
        continue;
      }
      chunk.velocity.multiplyScalar(slowdown);
      chunk.position.addScaledVector(chunk.velocity, deltaSeconds);
      chunk.angle += chunk.spinRate * deltaSeconds;
      const remaining = 1 - chunk.age / chunk.lifetime;
      const shrink = Math.min(1, remaining / VANISH_FRACTION);
      rotation.setFromAxisAngle(chunk.axis, chunk.angle);
      matrix.compose(chunk.position, rotation, scale.copy(chunk.scale).multiplyScalar(shrink));
      matrix.toArray(this.mesh.instanceMatrix.array, index * 16);
      this.writeGlow(chunk, glow, index * 3);
      index += 1;
    }
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.glow.needsUpdate = true;
  }

  clear(): void {
    this.count = 0;
    this.mesh.count = 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }

  private writeGlow(chunk: Chunk, target: Float32Array, offset: number): void {
    if (this.kind === 'ice') {
      // A brief flash twice per turn, as if a flat face caught the sun.
      const glint = Math.max(0, Math.sin(chunk.angle * 2 + chunk.phase)) ** 12;
      target[offset] = 0.03 + glint * 2.2;
      target[offset + 1] = 0.06 + glint * 3.0;
      target[offset + 2] = 0.1 + glint * 3.8;
      return;
    }
    // Black-body-like cooling: blue goes first, then green, red last.
    const heat = chunk.heat * Math.exp(-chunk.age * HEAT_FADE_PER_SECOND);
    target[offset] = 4.2 * heat ** 1.4;
    target[offset + 1] = 2.0 * heat ** 2.4;
    target[offset + 2] = 0.6 * heat ** 3.6;
  }
}

function createMaterial(kind: DebrisKind): THREE.MeshStandardMaterial {
  const material =
    kind === 'rock'
      ? new THREE.MeshStandardMaterial({ color: 0x5a5048, roughness: 0.95, metalness: 0.05, flatShading: true })
      : new THREE.MeshStandardMaterial({ color: 0xd4e6f7, roughness: 0.18, metalness: 0, flatShading: true });
  // Per-instance emissive, so each chunk cools or glints on its own. Only
  // the faces on one side glow: the fresh fracture, not the old crust.
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aGlow;\nvarying vec3 vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow * (0.06 + 0.94 * smoothstep(-0.25, 0.7, normal.y));');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vGlow;');
  };
  return material;
}

/** Angular lump: a coarse icosahedron with its corners pushed in and out. */
function createRockChunkGeometry(): THREE.BufferGeometry {
  return jitter(new THREE.IcosahedronGeometry(1, 0), 0.38);
}

/** Thin splinter: an octahedron stretched long and pressed flat. */
function createShardGeometry(): THREE.BufferGeometry {
  const geometry = jitter(new THREE.OctahedronGeometry(1, 0), 0.25);
  geometry.scale(0.42, 1.5, 0.16);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Moves each corner by an amount that depends only on where it is, so the
 * copies of a corner in neighbouring faces stay together.
 */
function jitter(geometry: THREE.BufferGeometry, amount: number): THREE.BufferGeometry {
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  const point = new THREE.Vector3();
  for (let index = 0; index < positions.count; index += 1) {
    point.fromBufferAttribute(positions, index);
    const hash = Math.sin(point.x * 12.9898 + point.y * 78.233 + point.z * 37.719) * 43758.5453;
    point.multiplyScalar(1 + (hash - Math.floor(hash) - 0.5) * 2 * amount);
    positions.setXYZ(index, point.x, point.y, point.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}
