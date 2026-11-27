import * as THREE from 'three';
import type { Asteroid } from '../asteroids/asteroidField';
import type { AsteroidSize } from '../logic/asteroidClasses';

const SIZE_LABEL: Record<AsteroidSize, string> = { small: 'S', medium: 'M', large: 'L', giant: 'GIANT' };
const MAX_LABELLED = 4;
const MAX_ARROWS = 6;

interface ScreenPoint {
  x: number;
  y: number;
  /** True when in front of the camera and inside the viewport. */
  visible: boolean;
  /** Distance from the camera along its view direction. */
  depth: number;
}

/**
 * Screen-space markers drawn over the 3D view: the aiming reticle, brackets
 * on asteroids, the missile lock and edge arrows pointing at urgent threats
 * that are behind or beside the camera.
 */
export class TargetOverlay {
  private readonly context: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private readonly scratch = new THREE.Vector3();
  private readonly cameraSpace = new THREE.Vector3();
  private elapsed = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Target overlay needs a 2D canvas context');
    }
    this.context = context;
    this.resize();
  }

  resize(): void {
    const ratio = Math.min(window.devicePixelRatio, 2);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = this.width * ratio;
    this.canvas.height = this.height * ratio;
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  clear(): void {
    this.context.clearRect(0, 0, this.width, this.height);
  }

  draw(
    deltaSeconds: number,
    camera: THREE.PerspectiveCamera,
    aimPoint: THREE.Vector3,
    overheated: boolean,
    rankedThreats: readonly Asteroid[],
    lockedTarget: Asteroid | null,
  ): void {
    this.elapsed += deltaSeconds;
    this.clear();
    const context = this.context;
    context.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
    context.lineWidth = 1.5;

    rankedThreats.forEach((asteroid, rank) => {
      const point = this.project(asteroid.mesh.position, camera);
      const colour = threatColour(asteroid, rank);
      if (point.visible) {
        const size = Math.max(9, this.projectedRadius(asteroid.radius, point.depth, camera) * 1.15);
        this.drawBracket(point.x, point.y, size, colour);
        if (rank < MAX_LABELLED) {
          this.drawLabel(asteroid, point.x + size + 6, point.y, colour, camera);
        }
      } else if (rank < MAX_ARROWS && asteroid.timeToImpact !== null) {
        this.drawEdgeArrow(point, colour, asteroid);
      }
    });

    if (lockedTarget?.alive) {
      const point = this.project(lockedTarget.mesh.position, camera);
      if (point.visible) {
        this.drawLock(point.x, point.y, Math.max(14, this.projectedRadius(lockedTarget.radius, point.depth, camera) * 1.5));
      }
    }

    const aim = this.project(aimPoint, camera);
    if (aim.visible) {
      this.drawReticle(aim.x, aim.y, overheated);
    }
  }

  private project(position: THREE.Vector3, camera: THREE.PerspectiveCamera): ScreenPoint {
    this.cameraSpace.copy(position).applyMatrix4(camera.matrixWorldInverse);
    const depth = -this.cameraSpace.z;
    if (depth <= 0.01) {
      // Behind the camera: report the direction so an edge arrow can point at it.
      const length = Math.hypot(this.cameraSpace.x, this.cameraSpace.y) || 1;
      return {
        x: this.width / 2 + (this.cameraSpace.x / length) * this.width,
        y: this.height / 2 - (this.cameraSpace.y / length) * this.height,
        visible: false,
        depth,
      };
    }
    this.scratch.copy(position).project(camera);
    const x = ((this.scratch.x + 1) / 2) * this.width;
    const y = ((1 - this.scratch.y) / 2) * this.height;
    const visible = x >= 0 && x <= this.width && y >= 0 && y <= this.height;
    return { x, y, visible, depth };
  }

  private projectedRadius(radius: number, depth: number, camera: THREE.PerspectiveCamera): number {
    const focal = this.height / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    return (radius / Math.max(depth, 0.01)) * focal;
  }

  private drawBracket(x: number, y: number, size: number, colour: string): void {
    const context = this.context;
    const arm = Math.max(4, size * 0.4);
    context.strokeStyle = colour;
    context.beginPath();
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      const cx = x + sx * size;
      const cy = y + sy * size;
      context.moveTo(cx - sx * arm, cy);
      context.lineTo(cx, cy);
      context.lineTo(cx, cy - sy * arm);
    }
    context.stroke();
  }

  private drawLabel(asteroid: Asteroid, x: number, y: number, colour: string, camera: THREE.PerspectiveCamera): void {
    const distance = Math.round(asteroid.mesh.position.distanceTo(camera.position));
    const eta = asteroid.timeToImpact === null ? 'miss' : `${Math.ceil(asteroid.timeToImpact)}s`;
    this.context.fillStyle = colour;
    this.context.fillText(`${SIZE_LABEL[asteroid.size]} ${asteroid.material.toUpperCase()}`, x, y - 3);
    this.context.fillText(`${distance}u  ${eta}`, x, y + 10);
  }

  private drawEdgeArrow(point: ScreenPoint, colour: string, asteroid: Asteroid): void {
    const centreX = this.width / 2;
    const centreY = this.height / 2;
    const angle = Math.atan2(point.y - centreY, point.x - centreX);
    const marginX = this.width / 2 - 48;
    const marginY = this.height / 2 - 48;
    const scale = Math.min(marginX / Math.abs(Math.cos(angle) || 1e-6), marginY / Math.abs(Math.sin(angle) || 1e-6));
    const x = centreX + Math.cos(angle) * scale;
    const y = centreY + Math.sin(angle) * scale;
    const pulse = 0.65 + 0.35 * Math.sin(this.elapsed * 6);
    const context = this.context;
    context.save();
    context.translate(x, y);
    context.rotate(angle);
    context.globalAlpha = pulse;
    context.fillStyle = colour;
    context.beginPath();
    context.moveTo(14, 0);
    context.lineTo(-6, -9);
    context.lineTo(-2, 0);
    context.lineTo(-6, 9);
    context.closePath();
    context.fill();
    context.restore();
    context.fillStyle = colour;
    const eta = asteroid.timeToImpact === null ? '' : `${Math.ceil(asteroid.timeToImpact)}s`;
    context.fillText(`${SIZE_LABEL[asteroid.size]} ${eta}`, x - 14, y + 24);
  }

  private drawLock(x: number, y: number, size: number): void {
    const context = this.context;
    context.save();
    context.translate(x, y);
    context.rotate(this.elapsed * 1.5);
    context.strokeStyle = '#7dffb0';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(0, -size);
    context.lineTo(size, 0);
    context.lineTo(0, size);
    context.lineTo(-size, 0);
    context.closePath();
    context.stroke();
    context.restore();
    context.fillStyle = '#7dffb0';
    context.fillText('LOCK', x - 14, y - size - 8);
  }

  private drawReticle(x: number, y: number, overheated: boolean): void {
    const context = this.context;
    context.strokeStyle = overheated ? '#ff5a4a' : 'rgba(180, 255, 220, 0.9)';
    context.lineWidth = 1.5;
    context.beginPath();
    context.arc(x, y, 12, 0, Math.PI * 2);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      context.moveTo(x + dx * 16, y + dy * 16);
      context.lineTo(x + dx * 24, y + dy * 24);
    }
    context.stroke();
    context.fillStyle = context.strokeStyle;
    context.fillRect(x - 1, y - 1, 2, 2);
  }
}

function threatColour(asteroid: Asteroid, rank: number): string {
  if (rank < 3 && asteroid.timeToImpact !== null) {
    return '#ff5a4a';
  }
  if (asteroid.size === 'giant' || asteroid.size === 'large') {
    return '#ffb347';
  }
  return 'rgba(232, 241, 255, 0.85)';
}
