import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import type { AsteroidMaterial, AsteroidSize } from '../logic/asteroidClasses';
import { createSeededRandom, randomUnitVector, type RandomSource } from '../logic/random';

const SHAPES_PER_SIZE = 6;

/** Surface detail per size: more vertices where the rock fills more of the screen. */
const DETAIL_BY_SIZE: Record<AsteroidSize, number> = { small: 2, medium: 3, large: 4, giant: 5 };


/**
 * Shared geometry and materials for asteroids. Each size has several unit
 * radius shapes made from layered noise and craters; meshes scale them to
 * their radius. Vertex colours darken crevices so the rock reads as solid;
 * the material colour tints them per type (rock, iron, ice).
 */
export class AsteroidMeshFactory {
  private readonly shapes = new Map<AsteroidSize, THREE.BufferGeometry[]>();
  private readonly materials: Record<AsteroidMaterial, THREE.MeshStandardMaterial>;
  private readonly rng: RandomSource;

  constructor(seed = 2026) {
    this.rng = createSeededRandom(seed);
    this.materials = {
      rocky: new THREE.MeshStandardMaterial({
        color: new THREE.Color(0.42, 0.37, 0.32),
        vertexColors: true,
        roughness: 0.95,
        metalness: 0.02,
      }),
      iron: new THREE.MeshStandardMaterial({
        color: new THREE.Color(0.34, 0.31, 0.29),
        vertexColors: true,
        roughness: 0.45,
        metalness: 0.75,
      }),
      ice: new THREE.MeshStandardMaterial({
        color: new THREE.Color(0.72, 0.84, 0.95),
        vertexColors: true,
        roughness: 0.25,
        metalness: 0.05,
        emissive: new THREE.Color(0.02, 0.06, 0.1),
      }),
    };
  }

  createMesh(size: AsteroidSize, material: AsteroidMaterial, radius: number): THREE.Mesh {
    const options = this.shapesFor(size);
    const geometry = options[Math.floor(this.rng() * options.length)];
    // Each asteroid gets its own material copy so it can flash when hit and
    // glow when entering the atmosphere. Copies share one compiled shader.
    const mesh = new THREE.Mesh(geometry, this.materials[material].clone());
    // Uneven scaling makes shared shapes look less alike.
    mesh.scale.set(
      radius * (0.85 + this.rng() * 0.3),
      radius * (0.75 + this.rng() * 0.3),
      radius * (0.85 + this.rng() * 0.3),
    );
    mesh.rotation.set(this.rng() * Math.PI, this.rng() * Math.PI, this.rng() * Math.PI);
    return mesh;
  }

  private shapesFor(size: AsteroidSize): THREE.BufferGeometry[] {
    let list = this.shapes.get(size);
    if (!list) {
      list = Array.from({ length: SHAPES_PER_SIZE }, () => createRockGeometry(DETAIL_BY_SIZE[size], this.rng));
      this.shapes.set(size, list);
    }
    return list;
  }
}

function createRockGeometry(detail: number, rng: RandomSource): THREE.BufferGeometry {
  const noise = new SimplexNoise({ random: rng });
  const base = new THREE.IcosahedronGeometry(1, detail);
  base.deleteAttribute('normal');
  base.deleteAttribute('uv');
  const geometry = mergeVertices(base);
  base.dispose();

  const craters = Array.from({ length: 4 + Math.floor(rng() * 6) }, () => ({
    centre: new THREE.Vector3(...randomUnitVector(rng)),
    radius: 0.2 + rng() * 0.45,
    depth: 0.05 + rng() * 0.12,
  }));

  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  const heights = new Float32Array(positions.count);
  const point = new THREE.Vector3();
  let minHeight = Infinity;
  let maxHeight = -Infinity;

  for (let index = 0; index < positions.count; index += 1) {
    point.fromBufferAttribute(positions, index).normalize();
    let height = 1;
    height += fractalNoise(noise, point, 1.1, 4) * 0.32;
    height += fractalNoise(noise, point, 4.5, 3) * 0.06;
    for (const crater of craters) {
      const distance = point.distanceTo(crater.centre);
      if (distance < crater.radius) {
        const t = distance / crater.radius;
        // Bowl with a slightly raised rim.
        height -= crater.depth * (1 - t * t) - crater.depth * 0.35 * Math.max(0, t - 0.75) * 4 * (1 - t);
      }
    }
    heights[index] = height;
    minHeight = Math.min(minHeight, height);
    maxHeight = Math.max(maxHeight, height);
    positions.setXYZ(index, point.x * height, point.y * height, point.z * height);
  }

  const colors = new Float32Array(positions.count * 3);
  for (let index = 0; index < positions.count; index += 1) {
    const relative = (heights[index] - minHeight) / Math.max(maxHeight - minHeight, 1e-6);
    const speckle = 0.9 + rng() * 0.2;
    const shade = (0.45 + relative * 0.75) * speckle;
    colors.set([shade, shade * 0.97, shade * 0.93], index * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function fractalNoise(noise: SimplexNoise, point: THREE.Vector3, frequency: number, octaves: number): number {
  let total = 0;
  let amplitude = 1;
  let scale = frequency;
  let normaliser = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    total += noise.noise3d(point.x * scale, point.y * scale, point.z * scale) * amplitude;
    normaliser += amplitude;
    amplitude *= 0.5;
    scale *= 2;
  }
  return total / normaliser;
}
