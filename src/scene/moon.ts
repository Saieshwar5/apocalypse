import * as THREE from 'three';
import { createSeededRandom } from '../logic/random';

/**
 * Far enough to be beyond the defence zone, large enough to read as a
 * landmark. (At true scale it would be 600 units away with a radius of 2.7.)
 */
const MOON_DISTANCE = 440;
const MOON_RADIUS = 15;

/** A cratered grey moon that gives the pilot a fixed reference in the sky. */
export function createMoon(direction: THREE.Vector3): THREE.Mesh {
  const surface = createMoonTexture();
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(MOON_RADIUS, 48, 24),
    new THREE.MeshStandardMaterial({ map: surface, bumpMap: surface, bumpScale: 1.4, roughness: 1, metalness: 0 }),
  );
  moon.position.copy(direction).normalize().multiplyScalar(MOON_DISTANCE);
  moon.rotation.set(0.3, 1.1, 0);
  return moon;
}

/** Grey regolith with dark seas and craters; brightness doubles as the bump map. */
function createMoonTexture(): THREE.CanvasTexture {
  const width = 1024;
  const height = 512;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('2D canvas is not available for the moon texture');
  }
  const rng = createSeededRandom(1969);
  context.fillStyle = '#b9b5ad';
  context.fillRect(0, 0, width, height);
  // Dark basalt seas.
  for (let index = 0; index < 9; index += 1) {
    const x = rng() * width;
    const y = height * (0.2 + rng() * 0.6);
    const radius = 40 + rng() * 110;
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, 'rgba(70, 70, 74, 0.75)');
    gradient.addColorStop(1, 'rgba(70, 70, 74, 0)');
    context.fillStyle = gradient;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  // Craters: dark floor, bright rim.
  for (let index = 0; index < 520; index += 1) {
    const x = rng() * width;
    const y = rng() * height;
    const radius = 1.5 + rng() * rng() * 22;
    context.fillStyle = `rgba(60, 58, 56, ${0.25 + rng() * 0.3})`;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = `rgba(215, 212, 205, ${0.25 + rng() * 0.35})`;
    context.lineWidth = Math.max(0.6, radius * 0.14);
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
