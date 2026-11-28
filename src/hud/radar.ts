import * as THREE from 'three';
import type { Asteroid } from '../asteroids/asteroidField';
import type { AsteroidSize } from '../logic/asteroidClasses';
import { projectToScanner, SCANNER_TILT, type ScannerPoint } from '../logic/scannerProjection';
import { formatDistance } from '../logic/units';

export const SCANNER_RANGE = 460;
const BLIP_SIZE: Record<AsteroidSize, number> = { small: 2.2, medium: 3.2, large: 4.6, giant: 6.5 };

interface Contact {
  point: ScannerPoint;
  color: string;
  size: number;
  locked: boolean;
  /** Drawn as a square: the station. */
  square?: boolean;
  /** Drawn as a triangle: a rival ship. */
  triangle?: boolean;
  /** Drawn as a dashed ring sized by its mass: a debris cloud. */
  cloud?: number;
  /** Drawn as a diamond: a rock on its way to the planet. */
  diamond?: boolean;
  /** Harmless: drawn small and faint so threats stand out. */
  faded?: boolean;
}

/**
 * 3D scanner. The disc is the ship's wing plane seen from behind and above,
 * with the ship at the centre and its nose pointing up the screen. Every
 * contact sits on a stalk: rising from the disc when it is above the ship,
 * hanging below (drawn hollow) when it is beneath. Earth is shown the same
 * way, so the way home is always visible.
 */
export class Radar {
  private readonly context: CanvasRenderingContext2D;
  private readonly inverse = new THREE.Quaternion();
  private readonly local = new THREE.Vector3();
  private readonly rangeLabel = document.querySelector('#radar-range');
  private sweep = 0;
  private shownRange = 0;
  private shownCaption = '';
  /** What the navigation points at: highlighted with a pulsing ring and a line from the ship. */
  objective: { position: THREE.Vector3; color: string } | null = null;
  /** Chooses the range from the full range the scanner can see (auto-zoom, set by the navigation). */
  rangeFor: ((fullRange: number) => number) | null = null;
  /** Shown beside the range: AUTO, CLOSE, MEDIUM or FAR. */
  modeLabel = '';
  private pulse = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Scanner needs a 2D canvas context');
    }
    this.context = context;
    this.fitCanvas();
  }

  /** Larger while the pilot holds B to read it. */
  set enlarged(value: boolean) {
    const holder = this.canvas.parentElement;
    if (!holder || holder.classList.contains('enlarged') === value) {
      return;
    }
    holder.classList.toggle('enlarged', value);
  }

  /** Matches the drawing buffer to the canvas's size on screen, so it stays sharp at any size. */
  private fitCanvas(): void {
    const ratio = Math.min(window.devicePixelRatio, 2);
    this.canvas.width = Math.round(this.width * ratio);
    this.canvas.height = Math.round(this.height * ratio);
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  private get width(): number {
    return this.canvas.clientWidth || 240;
  }

  private get height(): number {
    return this.canvas.clientHeight || 210;
  }

  draw(
    deltaSeconds: number,
    ship: THREE.Object3D,
    asteroids: readonly Asteroid[],
    urgentIds: ReadonlySet<number>,
    lockedId: number | null,
    planetRadius: number,
    range = SCANNER_RANGE,
    station: THREE.Vector3 | null = null,
    blind = false,
    satellites: readonly THREE.Vector3[] = [],
    outposts: readonly { position: THREE.Vector3; color: string; triangle?: boolean; cloud?: number }[] = [],
  ): void {
    // The scanner can change size (hold B): keep the drawing buffer matched to it.
    if (this.canvas.width !== Math.round(this.width * Math.min(window.devicePixelRatio, 2))) {
      this.fitCanvas();
    }
    const context = this.context;
    const centreX = this.width / 2;
    const centreY = this.height / 2 + 8;
    const radius = this.width / 2 - 8;
    this.sweep = (this.sweep + deltaSeconds * 1.6) % (Math.PI * 2);
    this.pulse += deltaSeconds;
    this.inverse.copy(ship.quaternion).invert();
    range = this.rangeFor ? this.rangeFor(range) : range;
    const caption = `${this.modeLabel ? `${this.modeLabel} ` : ''}${formatDistance(range)}`;
    if ((range !== this.shownRange || caption !== this.shownCaption) && this.rangeLabel) {
      this.rangeLabel.textContent = caption;
      this.shownRange = range;
      this.shownCaption = caption;
    }

    const contacts: Contact[] = asteroids.map((asteroid) => {
      this.local.copy(asteroid.mesh.position).sub(ship.position).applyQuaternion(this.inverse);
      const urgent = urgentIds.has(asteroid.id);
      const threat = asteroid.timeToImpact !== null;
      return {
        point: projectToScanner(this.local.toArray(), range, radius),
        color: urgent ? '#ff5a4a' : !threat ? '#8a96a8' : asteroid.size === 'giant' || asteroid.size === 'large' ? '#ffb347' : '#ffd9a0',
        size: threat ? BLIP_SIZE[asteroid.size] : 1.6,
        locked: asteroid.id === lockedId,
        diamond: threat,
        faded: !threat,
      };
    });
    if (station) {
      this.local.copy(station).sub(ship.position).applyQuaternion(this.inverse);
      contacts.push({ point: projectToScanner(this.local.toArray(), range, radius), color: '#5fd8ff', size: 3.5, locked: false, square: true });
    }
    for (const outpost of outposts) {
      this.local.copy(outpost.position).sub(ship.position).applyQuaternion(this.inverse);
      contacts.push({
        point: projectToScanner(this.local.toArray(), range, radius),
        color: outpost.color,
        size: 3.5,
        locked: false,
        square: !outpost.triangle && outpost.cloud === undefined,
        triangle: outpost.triangle,
        cloud: outpost.cloud,
      });
    }
    for (const satellite of satellites) {
      this.local.copy(satellite).sub(ship.position).applyQuaternion(this.inverse);
      contacts.push({ point: projectToScanner(this.local.toArray(), range, radius), color: '#9aa6b5', size: 2, locked: false, square: true });
    }
    this.local.copy(ship.position).negate().applyQuaternion(this.inverse);
    const earth = projectToScanner(this.local.toArray(), range, radius);
    const earthSize = THREE.MathUtils.clamp((planetRadius / Math.max(this.local.length(), planetRadius)) * radius * 0.5, 5, 13);

    context.clearRect(0, 0, this.width, this.height);
    context.save();
    context.translate(centreX, centreY);
    if (blind) {
      // Solar flare: no contacts, only static.
      this.drawDisc(context, radius);
      context.fillStyle = 'rgba(255, 200, 120, 0.5)';
      for (let index = 0; index < 60; index += 1) {
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.sqrt(Math.random()) * radius;
        context.fillRect(Math.cos(angle) * distance, Math.sin(angle) * distance * SCANNER_TILT, 2, 1);
      }
      context.fillStyle = '#ffb347';
      context.font = '700 12px ui-monospace, SFMono-Regular, Menlo, monospace';
      context.textAlign = 'center';
      context.fillText('NO SIGNAL', 0, -radius * SCANNER_TILT - 12);
      context.restore();
      return;
    }
    // Things below the disc are drawn first so the disc overlaps them.
    if (!earth.above) {
      this.drawEarth(context, earth, earthSize);
    }
    for (const contact of contacts) {
      if (!contact.point.above) {
        this.drawContact(context, contact);
      }
    }
    this.drawDisc(context, radius);
    if (earth.above) {
      this.drawEarth(context, earth, earthSize);
    }
    for (const contact of contacts) {
      if (contact.point.above) {
        this.drawContact(context, contact);
      }
    }
    this.drawObjective(context, ship, range, radius);
    this.drawShip(context);
    context.restore();
  }

  /** The navigation's objective: a dashed line from the ship and a pulsing ring, with its height. */
  private drawObjective(context: CanvasRenderingContext2D, ship: THREE.Object3D, range: number, radius: number): void {
    if (!this.objective) {
      return;
    }
    this.local.copy(this.objective.position).sub(ship.position).applyQuaternion(this.inverse);
    const point = projectToScanner(this.local.toArray(), range, radius);
    context.save();
    context.strokeStyle = this.objective.color;
    context.fillStyle = this.objective.color;
    context.lineWidth = 1.5;
    context.setLineDash([3, 3]);
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(point.baseX, point.baseY);
    context.stroke();
    context.setLineDash([]);
    const size = 6 + 2.5 * Math.sin(this.pulse * 5);
    context.beginPath();
    context.arc(point.x, point.y, size, 0, Math.PI * 2);
    context.stroke();
    context.font = '700 10px ui-monospace, SFMono-Regular, Menlo, monospace';
    context.textAlign = 'center';
    const height = this.local.y;
    if (Math.abs(height) > 4) {
      context.fillText(`${height > 0 ? '▲' : '▼'}${formatDistance(Math.abs(height))}`, point.x, point.y - size - 4);
    }
    context.restore();
  }

  private drawDisc(context: CanvasRenderingContext2D, radius: number): void {
    const ellipse = (fraction: number) => {
      context.beginPath();
      context.ellipse(0, 0, radius * fraction, radius * fraction * SCANNER_TILT, 0, 0, Math.PI * 2);
    };
    ellipse(1);
    context.fillStyle = 'rgba(8, 26, 44, 0.62)';
    context.fill();
    context.lineWidth = 1;
    context.strokeStyle = 'rgba(120, 200, 255, 0.55)';
    context.stroke();
    context.strokeStyle = 'rgba(120, 200, 255, 0.22)';
    for (const fraction of [0.33, 0.66]) {
      ellipse(fraction);
      context.stroke();
    }
    context.beginPath();
    context.moveTo(-radius, 0);
    context.lineTo(radius, 0);
    context.moveTo(0, -radius * SCANNER_TILT);
    context.lineTo(0, radius * SCANNER_TILT);
    context.stroke();

    // Rotating sweep line on the disc.
    context.strokeStyle = 'rgba(120, 220, 255, 0.35)';
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(Math.cos(this.sweep) * radius, Math.sin(this.sweep) * radius * SCANNER_TILT);
    context.stroke();

    // What the cameras can see: a faint wedge ahead (about 47 degrees either side of the nose).
    const view = 0.82;
    context.fillStyle = 'rgba(125, 255, 176, 0.07)';
    context.beginPath();
    context.moveTo(0, 0);
    for (let step = 0; step <= 12; step += 1) {
      const angle = -view + (2 * view * step) / 12;
      context.lineTo(Math.sin(angle) * radius, -Math.cos(angle) * radius * SCANNER_TILT);
    }
    context.closePath();
    context.fill();

    // "Ahead" marker at the far edge.
    context.fillStyle = 'rgba(125, 255, 176, 0.9)';
    context.beginPath();
    context.moveTo(0, -radius * SCANNER_TILT - 7);
    context.lineTo(5, -radius * SCANNER_TILT + 1);
    context.lineTo(-5, -radius * SCANNER_TILT + 1);
    context.closePath();
    context.fill();
  }

  private drawContact(context: CanvasRenderingContext2D, contact: Contact): void {
    const { point, color, size } = contact;
    context.globalAlpha = (point.beyondRange ? 0.5 : 1) * (contact.faded ? 0.45 : 1);
    context.strokeStyle = color;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(point.baseX, point.baseY);
    context.lineTo(point.x, point.y);
    context.stroke();
    // Foot of the stalk on the disc.
    context.beginPath();
    context.ellipse(point.baseX, point.baseY, 2.5, 2.5 * SCANNER_TILT, 0, 0, Math.PI * 2);
    context.stroke();
    if (contact.cloud !== undefined) {
      // Debris: a dashed ring, larger for heavier clouds, never filled.
      context.setLineDash([2, 2]);
      context.beginPath();
      context.arc(point.x, point.y, 2.5 + Math.min(5, Math.sqrt(contact.cloud)), 0, Math.PI * 2);
      context.stroke();
      context.setLineDash([]);
      context.globalAlpha = 1;
      return;
    }
    context.beginPath();
    if (contact.diamond) {
      context.moveTo(point.x, point.y - size - 1);
      context.lineTo(point.x + size + 1, point.y);
      context.lineTo(point.x, point.y + size + 1);
      context.lineTo(point.x - size - 1, point.y);
      context.closePath();
    } else if (contact.triangle) {
      context.moveTo(point.x, point.y - size - 1);
      context.lineTo(point.x + size, point.y + size);
      context.lineTo(point.x - size, point.y + size);
      context.closePath();
    } else if (contact.square) {
      context.rect(point.x - size, point.y - size, size * 2, size * 2);
    } else {
      context.arc(point.x, point.y, size, 0, Math.PI * 2);
    }
    if (point.above) {
      context.fillStyle = color;
      context.fill();
    } else {
      context.fillStyle = 'rgba(4, 14, 24, 0.9)';
      context.fill();
      context.lineWidth = 1.5;
      context.stroke();
    }
    if (contact.locked) {
      context.strokeStyle = '#7dffb0';
      context.strokeRect(point.x - size - 3, point.y - size - 3, size * 2 + 6, size * 2 + 6);
    }
    context.globalAlpha = 1;
  }

  private drawEarth(context: CanvasRenderingContext2D, point: ScannerPoint, size: number): void {
    context.strokeStyle = 'rgba(90, 160, 255, 0.7)';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(point.baseX, point.baseY);
    context.lineTo(point.x, point.y);
    context.stroke();
    const gradient = context.createRadialGradient(point.x - size * 0.3, point.y - size * 0.3, 0, point.x, point.y, size);
    gradient.addColorStop(0, 'rgba(120, 190, 255, 0.95)');
    gradient.addColorStop(1, 'rgba(20, 70, 170, 0.85)');
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(point.x, point.y, size, 0, Math.PI * 2);
    context.fill();
  }

  private drawShip(context: CanvasRenderingContext2D): void {
    context.fillStyle = '#7dffb0';
    context.beginPath();
    context.moveTo(0, -7);
    context.lineTo(5, 4);
    context.lineTo(0, 1.5);
    context.lineTo(-5, 4);
    context.closePath();
    context.fill();
  }
}
