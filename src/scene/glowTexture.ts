import * as THREE from 'three';

let cached: THREE.CanvasTexture | null = null;

/** Soft radial gradient shared by stars, the sun, flashes and particles. */
export function getGlowTexture(): THREE.CanvasTexture {
  if (cached) {
    return cached;
  }
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('2D canvas is not available for the glow texture');
  }
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.2, 'rgba(255,255,255,0.85)');
  gradient.addColorStop(0.45, 'rgba(255,255,255,0.28)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  cached = new THREE.CanvasTexture(canvas);
  return cached;
}
