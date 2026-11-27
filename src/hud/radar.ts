import * as THREE from 'three';
import type { Asteroid } from '../asteroids/asteroidField';
import type { AsteroidSize } from '../logic/asteroidClasses';
import { formatDistance } from '../logic/units';

const RANGE = 240;
const BLIP_SIZE: Record<AsteroidSize, number> = { small: 2, medium: 3, large: 4.5, giant: 6.5 };

/**
 * Ship-centred radar. Up on the radar is the ship's nose. Distance is
 * compressed (square root) so nearby rocks are spread out while far
 * approaches still show at the edge. A short line from each blip shows
 * whether the contact is above or below the ship.
 */
export class Radar {
  private readonly context: CanvasRenderingContext2D;
  private readonly inverse = new THREE.Quaternion();
  private readonly local = new THREE.Vector3();
  private readonly localVelocity = new THREE.Vector3();
  private sweep = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Radar needs a 2D canvas context');
    }
    this.context = context;
    const ratio = Math.min(window.devicePixelRatio, 2);
    const size = canvas.clientWidth || 220;
    canvas.width = size * ratio;
    canvas.height = size * ratio;
    context.scale(ratio, ratio);
    const rangeLabel = document.querySelector('#radar-range');
    if (rangeLabel) {
      rangeLabel.textContent = formatDistance(RANGE);
    }
  }

  draw(
    deltaSeconds: number,
    ship: THREE.Object3D,
    asteroids: readonly Asteroid[],
    urgentIds: ReadonlySet<number>,
    lockedId: number | null,
    planetRadius: number,
  ): void {
    const size = this.canvas.clientWidth || 220;
    const centre = size / 2;
    const radius = centre - 6;
    const context = this.context;
    this.sweep = (this.sweep + deltaSeconds * 1.6) % (Math.PI * 2);
    this.inverse.copy(ship.quaternion).invert();

    context.clearRect(0, 0, size, size);
    this.drawFrame(context, centre, radius);
    this.drawPlanet(context, ship, centre, radius, planetRadius);

    for (const asteroid of asteroids) {
      this.local.copy(asteroid.mesh.position).sub(ship.position).applyQuaternion(this.inverse);
      const distance = this.local.length();
      const scaled = Math.sqrt(Math.min(distance / RANGE, 1)) * radius;
      const flat = Math.hypot(this.local.x, this.local.z) || 1;
      const x = centre + (this.local.x / flat) * scaled;
      const y = centre + (this.local.z / flat) * scaled;
      const elevation = THREE.MathUtils.clamp(this.local.y / Math.max(distance, 1), -1, 1) * 16;
      const urgent = urgentIds.has(asteroid.id);
      const colour = urgent ? '#ff5a4a' : asteroid.size === 'giant' || asteroid.size === 'large' ? '#ffb347' : '#e8f1ff';

      context.strokeStyle = colour;
      context.globalAlpha = 0.55;
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x, y - elevation);
      context.stroke();
      context.globalAlpha = distance > RANGE ? 0.5 : 1;
      context.fillStyle = colour;
      context.beginPath();
      context.arc(x, y - elevation, BLIP_SIZE[asteroid.size], 0, Math.PI * 2);
      context.fill();
      // Heading tick: direction of travel, longer for faster rocks.
      this.localVelocity.copy(asteroid.velocity).applyQuaternion(this.inverse);
      const flatSpeed = Math.hypot(this.localVelocity.x, this.localVelocity.z) || 1;
      const tick = 4 + asteroid.velocity.length() * 2.2;
      context.strokeStyle = colour;
      context.beginPath();
      context.moveTo(x, y - elevation);
      context.lineTo(x + (this.localVelocity.x / flatSpeed) * tick, y - elevation + (this.localVelocity.z / flatSpeed) * tick);
      context.stroke();
      if (asteroid.id === lockedId) {
        context.strokeStyle = '#7dffb0';
        context.globalAlpha = 1;
        context.strokeRect(x - 6, y - elevation - 6, 12, 12);
      }
    }
    context.globalAlpha = 1;
    this.drawShipMarker(context, centre);
  }

  private drawFrame(context: CanvasRenderingContext2D, centre: number, radius: number): void {
    context.fillStyle = 'rgba(4, 14, 24, 0.72)';
    context.beginPath();
    context.arc(centre, centre, radius, 0, Math.PI * 2);
    context.fill();

    context.strokeStyle = 'rgba(120, 200, 255, 0.25)';
    context.lineWidth = 1;
    for (const fraction of [0.33, 0.66, 1]) {
      context.beginPath();
      context.arc(centre, centre, radius * fraction, 0, Math.PI * 2);
      context.stroke();
    }
    context.beginPath();
    context.moveTo(centre - radius, centre);
    context.lineTo(centre + radius, centre);
    context.moveTo(centre, centre - radius);
    context.lineTo(centre, centre + radius);
    context.stroke();

    // View cone ahead of the ship.
    context.fillStyle = 'rgba(120, 200, 255, 0.06)';
    context.beginPath();
    context.moveTo(centre, centre);
    context.arc(centre, centre, radius, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55);
    context.closePath();
    context.fill();

    const gradient = context.createConicGradient(this.sweep, centre, centre);
    gradient.addColorStop(0, 'rgba(120, 220, 255, 0.22)');
    gradient.addColorStop(0.08, 'rgba(120, 220, 255, 0)');
    gradient.addColorStop(1, 'rgba(120, 220, 255, 0)');
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(centre, centre, radius, 0, Math.PI * 2);
    context.fill();
  }

  private drawPlanet(
    context: CanvasRenderingContext2D,
    ship: THREE.Object3D,
    centre: number,
    radius: number,
    planetRadius: number,
  ): void {
    this.local.copy(ship.position).negate().applyQuaternion(this.inverse);
    const distance = this.local.length();
    const flat = Math.hypot(this.local.x, this.local.z) || 1;
    const scaled = Math.sqrt(Math.min(distance / RANGE, 1)) * radius;
    const x = centre + (this.local.x / flat) * scaled;
    const y = centre + (this.local.z / flat) * scaled;
    const near = Math.sqrt(Math.max(distance - planetRadius, 0) / RANGE) * radius;
    const far = Math.sqrt(Math.min((distance + planetRadius) / RANGE, 1)) * radius;
    const discRadius = Math.max(5, (far - near) / 2);
    const gradient = context.createRadialGradient(x, y, 0, x, y, discRadius);
    gradient.addColorStop(0, 'rgba(70, 150, 255, 0.85)');
    gradient.addColorStop(1, 'rgba(30, 90, 200, 0.35)');
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(x, y, discRadius, 0, Math.PI * 2);
    context.fill();
  }

  private drawShipMarker(context: CanvasRenderingContext2D, centre: number): void {
    context.fillStyle = '#7dffb0';
    context.beginPath();
    context.moveTo(centre, centre - 6);
    context.lineTo(centre + 4.5, centre + 5);
    context.lineTo(centre - 4.5, centre + 5);
    context.closePath();
    context.fill();
  }
}
