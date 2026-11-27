import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import type { AsteroidMaterial, AsteroidSize } from '../logic/asteroidClasses';
import { createSeededRandom, randomUnitVector, type RandomSource } from '../logic/random';
import { RockSurfaceMaterial, type RockSurfaceLook } from './rockSurfaceMaterial';
import { getRockDetailTexture } from './rockTextures';

const SHAPES_PER_SIZE = 6;

/** Surface detail per size: more vertices where the rock fills more of the screen. */
const DETAIL_BY_SIZE: Record<AsteroidSize, number> = { small: 3, medium: 4, large: 4, giant: 5 };

/**
 * Surface texture repeats relative to the rock's size. A pebble shows a few
 * big features, a giant many small ones, so craters keep a believable
 * absolute size.
 */
const DETAIL_SCALE_BY_SIZE: Record<AsteroidSize, number> = { small: 0.55, medium: 0.75, large: 1, giant: 1.3 };

/**
 * Shared geometry and materials for asteroids. Each size has several unit
 * radius shapes made from layered noise and craters; meshes scale them to
 * their radius. Vertex colours darken crevices so the rock reads as solid;
 * a procedural detail texture per type (rock, iron, ice) adds the small
 * craters, boulders and gloss that the coarse geometry cannot carry.
 */
export class AsteroidMeshFactory {
  private readonly shapes = new Map<AsteroidSize, THREE.BufferGeometry[]>();
  private readonly materials: Record<AsteroidMaterial, RockSurfaceMaterial>;
  private readonly rng: RandomSource;

  constructor(seed = 2026) {
    this.rng = createSeededRandom(seed);
    this.materials = {
      // Dusty grey-brown regolith: matte, heavily cratered, strewn with boulders.
      rocky: createRockMaterial(
        { color: new THREE.Color(0.5, 0.45, 0.4), roughness: 0.97, metalness: 0 },
        {
          detailMap: getRockDetailTexture('rocky'),
          tiling: [0.55, 1.9],
          bump: [1.5, 0.9],
          darkTint: new THREE.Color(0.42, 0.35, 0.29),
          glossSmoothing: 0.1,
          glossMetal: 0,
          innerGlow: new THREE.Color(0, 0, 0),
        },
      ),
      // Dark nickel-iron: mostly dull, with polished hollows that catch the sun.
      iron: createRockMaterial(
        { color: new THREE.Color(0.36, 0.33, 0.32), roughness: 0.74, metalness: 0.72 },
        {
          detailMap: getRockDetailTexture('iron'),
          tiling: [0.5, 1.7],
          bump: [1.3, 0.7],
          darkTint: new THREE.Color(0.4, 0.27, 0.2),
          glossSmoothing: 0.46,
          glossMetal: 0.28,
          innerGlow: new THREE.Color(0, 0, 0),
        },
      ),
      // Pale blue-white ice: glossy sheets, frost patches and a faint cold glow.
      ice: createRockMaterial(
        { color: new THREE.Color(0.86, 0.92, 0.98), roughness: 0.6, metalness: 0 },
        {
          detailMap: getRockDetailTexture('ice'),
          tiling: [0.45, 1.5],
          bump: [1.3, 0.6],
          darkTint: new THREE.Color(0.58, 0.74, 0.92),
          glossSmoothing: 0.36,
          glossMetal: 0,
          innerGlow: new THREE.Color(0.07, 0.13, 0.2),
        },
      ),
    };
  }

  createMesh(size: AsteroidSize, material: AsteroidMaterial, radius: number): THREE.Mesh {
    const options = this.shapesFor(size);
    const geometry = options[Math.floor(this.rng() * options.length)];
    // Each asteroid gets its own material copy so it can flash when hit and
    // glow when entering the atmosphere. Copies share textures and one
    // compiled shader.
    const surface = this.materials[material].clone();
    surface.detailScale.value = DETAIL_SCALE_BY_SIZE[size] * (0.9 + this.rng() * 0.2);
    const mesh = new THREE.Mesh(geometry, surface);
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

function createRockMaterial(
  parameters: THREE.MeshStandardMaterialParameters,
  look: RockSurfaceLook,
): RockSurfaceMaterial {
  const material = new RockSurfaceMaterial({ ...parameters, vertexColors: true });
  material.look = look;
  return material;
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
