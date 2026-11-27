import * as THREE from 'three';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import type { SiteDefinition } from '../logic/prioritySites';
import { createSeededRandom } from '../logic/random';
import type { PlanetSurface } from '../logic/starSystems';
import type { EarthTextures } from './earth';

const WIDTH = 1024;
const HEIGHT = 512;

/**
 * Generates the three maps the planet shader expects (day colour, night
 * lights, and bump/roughness/clouds) for a colony world, so new planets need
 * no downloaded art. Noise is sampled on the sphere itself, which leaves no
 * seam where the map wraps. Settlement lights are drawn at the site
 * positions, so the night side shows where the colonies are.
 */
export function generatePlanetTextures(surface: PlanetSurface, sites: readonly SiteDefinition[]): EarthTextures {
  const rng = createSeededRandom(surface.seed);
  const terrain = new SimplexNoise({ random: rng });
  const weather = new SimplexNoise({ random: rng });
  const day = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  const detail = new Uint8ClampedArray(WIDTH * HEIGHT * 4);

  const fbm = (noise: SimplexNoise, x: number, y: number, z: number, octaves: number): number => {
    let total = 0;
    let amplitude = 0.5;
    let frequency = 1;
    for (let octave = 0; octave < octaves; octave += 1) {
      total += noise.noise3d(x * frequency, y * frequency, z * frequency) * amplitude;
      amplitude *= 0.5;
      frequency *= 2.1;
    }
    return total;
  };

  // Height below which the surface is sea; fbm output is roughly -0.9..0.9.
  const seaHeight = (surface.seaLevel - 0.5) * 0.9;
  for (let row = 0; row < HEIGHT; row += 1) {
    const theta = ((row + 0.5) / HEIGHT) * Math.PI;
    const sinTheta = Math.sin(theta);
    const y = Math.cos(theta);
    for (let column = 0; column < WIDTH; column += 1) {
      const phi = ((column + 0.5) / WIDTH) * Math.PI * 2;
      const x = -Math.cos(phi) * sinTheta;
      const z = Math.sin(phi) * sinTheta;
      const height = fbm(terrain, x * 1.5, y * 1.5, z * 1.5, 6);
      const land = height > seaHeight;
      const altitude = land ? Math.min(1, (height - seaHeight) / 0.5) : 0;
      const polar = Math.abs(y) + fbm(terrain, x * 4, y * 4, z * 4, 2) * 0.08;
      const ice = polar > 0.86;

      let color: [number, number, number];
      if (ice) {
        color = surface.ice;
      } else if (land) {
        color = mix(surface.land, surface.highland, altitude);
      } else {
        const depth = Math.min(1, (seaHeight - height) / 0.4);
        color = mix(surface.sea, scale(surface.sea, 0.45), depth);
      }
      const shade = 0.85 + fbm(terrain, x * 9, y * 9, z * 9, 2) * 0.3;
      const offset = (row * WIDTH + column) * 4;
      day[offset] = color[0] * shade * 255;
      day[offset + 1] = color[1] * shade * 255;
      day[offset + 2] = color[2] * shade * 255;
      day[offset + 3] = 255;

      const cloud = fbm(weather, x * 2.2 + 5, y * 3.2, z * 2.2, 5) + 0.12;
      detail[offset] = land ? (0.25 + altitude * 0.75) * 255 : 40;
      // Roughness: water and ice are smooth and catch the sun; land is matte.
      detail[offset + 1] = land && !ice ? 235 : ice ? 120 : 45;
      detail[offset + 2] = Math.max(0, Math.min(1, cloud * 1.6)) * 255;
      detail[offset + 3] = 255;
    }
  }

  const dayTexture = toTexture(day, true);
  const detailTexture = toTexture(detail, false);
  return { day: dayTexture, night: drawNightLights(sites, rng), detail: detailTexture };
}

function drawNightLights(sites: readonly SiteDefinition[], rng: () => number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('2D canvas is not available for the night-lights map');
  }
  context.fillStyle = '#000';
  context.fillRect(0, 0, WIDTH, HEIGHT);
  for (const site of sites) {
    const centreX = ((site.longitude + 180) / 360) * WIDTH;
    const centreY = ((90 - site.latitude) / 180) * HEIGHT;
    const spread = site.kind === 'city' ? 10 + site.population * 1.6 : 6;
    const lights = site.kind === 'city' ? 90 + site.population * 30 : 30;
    for (let index = 0; index < lights; index += 1) {
      // Clustered towards the centre, like a settlement and its outskirts.
      const distance = spread * rng() * rng();
      const angle = rng() * Math.PI * 2;
      const brightness = 150 + rng() * 105;
      context.fillStyle = `rgba(${brightness}, ${brightness * 0.82}, ${brightness * 0.5}, 0.9)`;
      context.fillRect(centreX + Math.cos(angle) * distance, centreY + Math.sin(angle) * distance * 0.8, 1.4, 1.4);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function toTexture(data: Uint8ClampedArray, srgb: boolean): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('2D canvas is not available for planet textures');
  }
  context.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, WIDTH, HEIGHT), 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  if (srgb) {
    texture.colorSpace = THREE.SRGBColorSpace;
  }
  texture.anisotropy = 4;
  return texture;
}

function mix(a: readonly number[], b: readonly number[], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function scale(color: readonly number[], factor: number): [number, number, number] {
  return [color[0] * factor, color[1] * factor, color[2] * factor];
}
