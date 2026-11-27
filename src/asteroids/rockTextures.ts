import * as THREE from 'three';
import type { AsteroidMaterial } from '../logic/asteroidClasses';
import { createSeededRandom, type RandomSource } from '../logic/random';
import { WrappedField, tileableFractalNoise } from './tileableNoise';

/** Power of two, so the fields can wrap with a bit mask. */
const SIZE = 512;

/**
 * The three layers a surface recipe paints. Height is in texels, so a slope
 * of 1 means 45 degrees; shade and gloss are 0..1.
 */
interface SurfaceLayers {
  height: WrappedField;
  /** Albedo: 0 takes the material's dark tint, 1 its full colour. */
  shade: WrappedField;
  /** Where the surface is smoother (and for iron, more metallic). */
  gloss: WrappedField;
}

const cache = new Map<AsteroidMaterial, THREE.DataTexture>();

/** The painted surfaces; other asteroid types reuse one with different tints. */
export type DetailRecipe = 'rocky' | 'iron' | 'ice';

/**
 * Tiling detail texture for one asteroid type, built once and shared by
 * every asteroid of that type. Channels: RG = tangent-space normal XY,
 * B = albedo shade, A = gloss. Sampled triplanar, so it needs no UVs.
 */
export function getRockDetailTexture(material: DetailRecipe): THREE.DataTexture {
  let texture = cache.get(material);
  if (!texture) {
    // Fixed seeds: the look should not change between sessions.
    const rng = createSeededRandom({ rocky: 811, iron: 1291, ice: 4409 }[material]);
    texture = packTexture(RECIPES[material](rng));
    cache.set(material, texture);
  }
  return texture;
}

const RECIPES: Record<DetailRecipe, (rng: RandomSource) => SurfaceLayers> = {
  rocky: paintRegolith,
  iron: paintIron,
  ice: paintIce,
};

/** Dusty, lumpy ground peppered with craters of all sizes and loose boulders. */
function paintRegolith(rng: RandomSource): SurfaceLayers {
  const height = tileableFractalNoise(SIZE, 4, 7, rng);
  const grain = tileableFractalNoise(SIZE, 64, 3, rng);
  const mottle = tileableFractalNoise(SIZE, 3, 5, rng);
  const shade = new WrappedField(SIZE);
  const gloss = new WrappedField(SIZE);
  for (let index = 0; index < height.data.length; index += 1) {
    height.data[index] = height.data[index] * 22 + grain.data[index] * 2.4;
    shade.data[index] = 0.5 + mottle.data[index] * 0.42 + (grain.data[index] - 0.5) * 0.22;
    gloss.data[index] = grain.data[index] * 0.2;
  }
  // Many small craters and few large ones, as on real bodies.
  for (let count = 0; count < 130; count += 1) {
    const radius = 3.5 + 50 * rng() ** 2.6;
    const fresh = rng() < 0.18;
    addCrater(height, shade, rng() * SIZE, rng() * SIZE, radius, radius * (fresh ? 0.42 : 0.26), fresh);
  }
  for (let count = 0; count < 320; count += 1) {
    const radius = 1.4 + 5.5 * rng() ** 2.5;
    const lift = radius * (0.7 + rng() * 0.5);
    const tone = 0.1 + rng() * 0.16;
    height.stamp(rng() * SIZE, rng() * SIZE, radius, (index, t) => {
      height.data[index] += lift * Math.sqrt(1 - t * t);
      shade.data[index] += tone * (1 - t);
    });
  }
  return { height, shade, gloss };
}

/** Smooth thumb-print hollows with sharp ridges between, and polished patches. */
function paintIron(rng: RandomSource): SurfaceLayers {
  const height = tileableFractalNoise(SIZE, 3, 5, rng);
  const grain = tileableFractalNoise(SIZE, 96, 2, rng);
  const mottle = tileableFractalNoise(SIZE, 5, 5, rng);
  const polish = tileableFractalNoise(SIZE, 7, 4, rng);
  const shade = new WrappedField(SIZE);
  const gloss = new WrappedField(SIZE);
  for (let index = 0; index < height.data.length; index += 1) {
    height.data[index] = height.data[index] * 30 + grain.data[index] * 1.1;
    shade.data[index] = 0.35 + mottle.data[index] * 0.65;
    gloss.data[index] = smoothstep(0.42, 0.68, polish.data[index]) * 0.28 + grain.data[index] * 0.1;
  }
  for (let count = 0; count < 190; count += 1) {
    const radius = 9 + 34 * rng() ** 1.6;
    const depth = radius * 0.24;
    height.stamp(rng() * SIZE, rng() * SIZE, radius, (index, t) => {
      const bowl = (1 - t * t) ** 2;
      height.data[index] -= depth * bowl;
      // Hollows are scoured clean, so they shine more than the ridges.
      gloss.data[index] += 0.08 * bowl;
    });
  }
  for (let count = 0; count < 70; count += 1) {
    const radius = 1.6 + rng() * 3.2;
    height.stamp(rng() * SIZE, rng() * SIZE, radius, (index, t) => {
      height.data[index] -= radius * 0.9 * (1 - t * t);
      shade.data[index] -= 0.25 * (1 - t);
    });
  }
  // Sparse mirror-bright crystal faces: these make the glints.
  for (let count = 0; count < 1100; count += 1) {
    gloss.stamp(rng() * SIZE, rng() * SIZE, 1.2 + rng() * 1.8, (index) => {
      gloss.data[index] = 1;
    });
  }
  return { height, shade, gloss };
}

/** Smooth sheets split by cracks, with rough frost lying in patches. */
function paintIce(rng: RandomSource): SurfaceLayers {
  const height = tileableFractalNoise(SIZE, 3, 4, rng);
  const cracks = tileableFractalNoise(SIZE, 5, 4, rng, true);
  const frost = tileableFractalNoise(SIZE, 9, 5, rng);
  const grain = tileableFractalNoise(SIZE, 80, 2, rng);
  const shade = new WrappedField(SIZE);
  const gloss = new WrappedField(SIZE);
  for (let index = 0; index < height.data.length; index += 1) {
    const crack = 1 - smoothstep(0.0, 0.07, cracks.data[index]);
    const frosted = smoothstep(0.4, 0.72, frost.data[index]);
    height.data[index] = height.data[index] * 26 - crack * 12 + frosted * grain.data[index] * 3.2;
    shade.data[index] = (0.55 + frosted * 0.45) * (1 - crack * 0.55);
    gloss.data[index] = 1 - frosted * 0.8;
  }
  for (let count = 0; count < 26; count += 1) {
    const radius = 6 + 30 * rng() ** 2.4;
    addCrater(height, shade, rng() * SIZE, rng() * SIZE, radius, radius * 0.16, false);
  }
  return { height, shade, gloss };
}

/** Bowl with a raised rim; fresh craters are deeper with a pale ejecta ring. */
function addCrater(
  height: WrappedField,
  shade: WrappedField,
  x: number,
  y: number,
  radius: number,
  depth: number,
  fresh: boolean,
): void {
  // The stamp reaches past the rim so the rim can fall away outside it.
  const reach = 1.55;
  height.stamp(x, y, radius * reach, (index, t) => {
    const u = t * reach;
    const bowl = u < 1 ? 1 - u * u : 0;
    const rim = Math.exp(-(((u - 1) / 0.2) ** 2));
    height.data[index] += depth * (rim * 0.38 - bowl);
    shade.data[index] += (fresh ? 0.2 : 0.05) * rim - (fresh ? 0.04 : 0.1) * bowl;
  });
}

function packTexture(layers: SurfaceLayers): THREE.DataTexture {
  const { height, shade, gloss } = layers;
  const pixels = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const slopeX = (height.get(x + 1, y) - height.get(x - 1, y)) * 0.5;
      const slopeY = (height.get(x, y + 1) - height.get(x, y - 1)) * 0.5;
      const length = Math.hypot(slopeX, slopeY, 1);
      const index = y * SIZE + x;
      pixels[index * 4] = toByte(0.5 - (slopeX / length) * 0.5);
      pixels[index * 4 + 1] = toByte(0.5 - (slopeY / length) * 0.5);
      pixels[index * 4 + 2] = toByte(shade.data[index]);
      pixels[index * 4 + 3] = toByte(gloss.data[index]);
    }
  }
  const texture = new THREE.DataTexture(pixels, SIZE, SIZE, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  // Rocks are mostly seen at grazing angles near their limb.
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function toByte(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 255);
}

function smoothstep(low: number, high: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
}
