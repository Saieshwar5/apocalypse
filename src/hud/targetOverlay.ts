import { drawNavigation, type NavigationFrame } from './navigationOverlay';
import * as THREE from 'three';
import type { Asteroid } from '../asteroids/asteroidField';
import { THREAT_COLORS, threatTone } from '../asteroids/threatTone';
import type { TargetingInfo } from '../game/targeting';
import type { SiteLabel } from '../sites/siteMarkers';
import { RATING_COLOR, RATING_LABEL, ratingOf } from '../asteroids/identification';
import { MATERIAL_TRAITS, type AsteroidSize } from '../logic/asteroidClasses';
import { formatCountdown, formatDistance, formatSpeed } from '../logic/units';
import type { CombatFeedback } from './combatFeedback';
import type { StationMarker } from '../game/orbitServices';
import { drawGuidance, type GuidanceFrame } from './guidanceOverlay';
import { drawReticle } from './reticle';
import { drawMap, type MapFrame } from './mapOverlay';
import { ScreenProjector, type ScreenPoint } from './screenProjector';

const SIZE_LABEL: Record<AsteroidSize, string> = { small: 'S', medium: 'M', large: 'L', giant: 'GIANT' };
const MAX_LABELLED = 4;
const MAX_ARROWS = 6;
const MAX_IMPACT_TAGS = 3;
const MAX_TACTICAL_LABELS = 8;
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

export interface OverlayFrame {
  camera: THREE.PerspectiveCamera;
  aimPoint: THREE.Vector3;
  overheated: boolean;
  /** Every asteroid, most urgent first. */
  ranked: readonly Asteroid[];
  targeting: TargetingInfo;
  feedback: CombatFeedback;
  /** Zoomed-out planning view: label everything, no reticle. */
  tactical: boolean;
  shipPosition: THREE.Vector3;
  /** Priority sites on the side of Earth facing the camera. */
  sites: readonly SiteLabel[];
  stationMarkers: readonly StationMarker[];
  /** Priority target, satellite labels and the drift marker. */
  guidance: GuidanceFrame;
}

const SITE_LABEL_COLOR = { intact: '#7dffb0', damaged: '#ffb347', critical: '#ff5a4a', destroyed: '#7f8c9e' } as const;

/**
 * Screen-space layer over the 3D view: brackets and labels on asteroids,
 * health bars, missile lock, countdowns on predicted impact points, edge
 * arrows for threats out of view, the reticle and hit feedback.
 */
/** In quiet mode, stations are named only inside this distance. */
const QUIET_LABEL_RANGE = 80;

export class TargetOverlay {
  private readonly context: CanvasRenderingContext2D;
  private readonly projector = new ScreenProjector();
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
    this.canvas.width = window.innerWidth * ratio;
    this.canvas.height = window.innerHeight * ratio;
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  clear(): void {
    this.context.clearRect(0, 0, window.innerWidth, window.innerHeight);
  }

  /** Fewer words in the world: names only on what is near, threatened or needed. Set by the HUD density. */
  quietLabels = false;
  /** True while the target compass shows the way: the old off-screen arrows step aside. */
  compassActive = false;
  /** True while a towed load's drop zone is shown. */
  delivering = false;
  private quiet = false;

  draw(deltaSeconds: number, frame: OverlayFrame): void {
    this.elapsed += deltaSeconds;
    this.clear();
    this.projector.setFrame(frame.camera, window.innerWidth, window.innerHeight);
    const context = this.context;
    context.lineWidth = 1.5;
    context.font = `600 11px ${MONO}`;
    const lockedId = frame.targeting.target?.id ?? null;
    this.quiet = this.quietLabels && !frame.tactical;
    // On the map a site is named only when it is in danger or damaged.
    this.drawSiteLabels(frame.sites, this.quiet || frame.tactical);
    for (const marker of frame.stationMarkers) {
      this.drawStation(marker, frame.shipPosition, frame.tactical);
    }

    frame.ranked.forEach((asteroid, rank) => {
      const tone = threatTone(asteroid, rank);
      const color = THREAT_COLORS[tone];
      const point = this.projector.project(asteroid.mesh.position);
      if (point.visible) {
        const size = Math.max(frame.tactical ? 5 : 9, this.projector.projectedRadius(asteroid.radius, point.depth) * 1.15);
        this.drawBracket(point.x, point.y, size, color);
        if (asteroid.id === lockedId || asteroid.health < asteroid.maxHealth) {
          this.drawHealthBar(point.x, point.y + size + 6, Math.max(28, size * 1.6), asteroid, asteroid.id === lockedId);
        }
        // On the map only rocks that will hit are named; the rest are marks.
        if (frame.tactical ? rank < MAX_TACTICAL_LABELS && asteroid.timeToImpact !== null : rank < MAX_LABELLED) {
          this.drawLabel(asteroid, point.x + size + 6, point.y, color, frame.shipPosition);
        }
      } else if (rank < MAX_ARROWS && asteroid.timeToImpact !== null) {
        this.drawEdgeArrow(point, color, asteroid);
      }
      if (rank < MAX_IMPACT_TAGS) {
        this.drawImpactTag(asteroid, color);
      }
    });

    if (frame.targeting.target?.alive && !frame.tactical) {
      const point = this.projector.project(frame.targeting.target.mesh.position);
      if (point.visible) {
        const size = this.projector.projectedRadius(frame.targeting.target.radius, point.depth);
        this.drawLock(point.x, point.y, Math.max(14, size * 1.5));
      }
    }

    frame.feedback.draw(context, this.projector);
    if (frame.tactical) {
      this.drawShipMarker(frame.shipPosition);
    } else {
      drawGuidance(context, this.projector, { ...frame.guidance, quiet: this.quiet, compass: this.compassActive, delivering: this.delivering }, this.elapsed);
      drawReticle(context, this.projector, frame.aimPoint, frame.targeting, frame.feedback, frame.overheated, this.elapsed);
    }
  }

  /** Numbers beside the objects listed in the navigation computer, so the list matches the sky. */
  drawNavTags(tags: readonly { number: number; world: THREE.Vector3; label: string }[]): void {
    const context = this.context;
    context.save();
    context.font = `800 11px ${MONO}`;
    for (const tag of tags) {
      const point = this.projector.project(tag.world);
      if (!point.visible) {
        continue;
      }
      const text = String(tag.number);
      context.fillStyle = 'rgba(228, 140, 255, 0.9)';
      context.fillRect(point.x - 22, point.y - 22, 15, 15);
      context.fillStyle = '#10061a';
      context.fillText(text, point.x - 18, point.y - 10);
    }
    context.restore();
  }

  /** The tactical map's navigation layer; call after draw(). */
  drawMap(frame: MapFrame): void {
    drawMap(this.context, this.projector, frame);
  }

  /** Navigation aids on top of this frame's overlay; call after draw(), which sets up the projector. */
  drawNavigationAids(frame: Omit<NavigationFrame, 'aim'>, aimPoint: THREE.Vector3): void {
    const aim = this.projector.project(aimPoint);
    const centre = { x: this.projector.width / 2, y: this.projector.height / 2 };
    drawNavigation(this.context, this.projector, { ...frame, aim: aim.visible ? aim : centre }, this.elapsed);
  }

  private drawSiteLabels(sites: readonly SiteLabel[], quiet: boolean): void {
    const context = this.context;
    context.save();
    context.font = `700 11px ${MONO}`;
    for (const { site, world, condition } of sites) {
      const point = this.projector.project(world);
      if (!point.visible) {
        continue;
      }
      const threatened = site.threatenedIn !== null && condition !== 'destroyed';
      if (quiet && !threatened && condition === 'intact') {
        continue;
      }
      const color = threatened ? '#ff5a4a' : SITE_LABEL_COLOR[condition];
      const name = site.definition.name.toUpperCase();
      const text =
        condition === 'destroyed'
          ? `${name} LOST`
          : threatened
            ? `${name} ${formatCountdown(site.threatenedIn ?? 0)}`
            : condition === 'intact'
              ? name
              : `${name} ${Math.ceil(site.health)}%`;
      const width = context.measureText(text).width;
      // Installations label to the left so they do not cover a nearby city.
      const x = site.definition.kind === 'city' ? point.x + 13 : point.x - 13 - width;
      context.fillStyle = 'rgba(4, 10, 18, 0.6)';
      context.fillRect(x - 4, point.y - 9, width + 8, 16);
      context.fillStyle = color;
      context.fillText(text, x, point.y + 3);
    }
    context.restore();
  }

  /** Cyan marker on the station, or an arrow at the screen edge towards it. */
  private drawStation(station: StationMarker, shipPosition: THREE.Vector3, map: boolean): void {
    const context = this.context;
    const point = this.projector.project(station.world);
    // The map keeps to names and distances; prices are read when flying close.
    const name = !map ? station.name : station.shape === 'triangle' ? station.name.split(' ')[0] : station.name.split(' · ')[0];
    const label = `${name} ${formatDistance(station.world.distanceTo(shipPosition))}`;
    context.save();
    context.strokeStyle = station.color ?? '#5fd8ff';
    context.fillStyle = station.color ?? '#5fd8ff';
    context.font = `700 11px ${MONO}`;
    if (station.ghost) {
      // Destinations and supply rockets: a dashed marker, and no edge arrow.
      if (point.visible) {
        context.globalAlpha = 0.75;
        context.setLineDash([3, 3]);
        context.strokeRect(point.x - 7, point.y - 7, 14, 14);
        context.fillText(station.name, point.x + 12, point.y + 4);
      }
      context.restore();
      return;
    }
    if (point.visible) {
      if (station.shape === 'triangle') {
        context.beginPath();
        context.moveTo(point.x, point.y - 10);
        context.lineTo(point.x + 9, point.y + 7);
        context.lineTo(point.x - 9, point.y + 7);
        context.closePath();
        context.stroke();
      } else {
        context.strokeRect(point.x - 9, point.y - 9, 18, 18);
      }
      if (!this.quiet || station.world.distanceTo(shipPosition) < QUIET_LABEL_RANGE) {
        context.fillText(label, point.x + 14, point.y + 4);
      }
    } else if (station.edgeArrow !== false) {
      const width = this.projector.width;
      const height = this.projector.height;
      const angle = Math.atan2(point.y - height / 2, point.x - width / 2);
      const scale = Math.min((width / 2 - 70) / Math.abs(Math.cos(angle) || 1e-6), (height / 2 - 70) / Math.abs(Math.sin(angle) || 1e-6));
      const x = width / 2 + Math.cos(angle) * scale;
      const y = height / 2 + Math.sin(angle) * scale;
      context.translate(x, y);
      context.fillRect(-5, -5, 10, 10);
      context.rotate(angle);
      context.beginPath();
      context.moveTo(18, 0);
      context.lineTo(9, -6);
      context.lineTo(9, 6);
      context.closePath();
      context.fill();
      context.rotate(-angle);
      context.textAlign = 'center';
      context.fillText(label, 0, 22);
    }
    context.restore();
  }

  private drawBracket(x: number, y: number, size: number, color: string): void {
    const context = this.context;
    const arm = Math.max(4, size * 0.4);
    context.strokeStyle = color;
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

  private drawHealthBar(x: number, y: number, width: number, asteroid: Asteroid, locked: boolean): void {
    const context = this.context;
    const fraction = Math.max(0, asteroid.health / asteroid.maxHealth);
    context.fillStyle = 'rgba(0, 0, 0, 0.55)';
    context.fillRect(x - width / 2 - 1, y - 1, width + 2, 6);
    context.fillStyle = fraction > 0.5 ? '#7dffb0' : fraction > 0.25 ? '#ffb347' : '#ff5a4a';
    context.fillRect(x - width / 2, y, width * fraction, 4);
    if (locked) {
      context.strokeStyle = '#7dffb0';
      context.strokeRect(x - width / 2 - 1.5, y - 1.5, width + 3, 7);
    }
  }

  private drawLabel(asteroid: Asteroid, x: number, y: number, color: string, shipPosition: THREE.Vector3): void {
    const context = this.context;
    const distance = asteroid.mesh.position.distanceTo(shipPosition) - asteroid.radius;
    const where = asteroid.targetSite ? `→ ${asteroid.targetSite.toUpperCase()}` : 'IMPACT';
    const eta = asteroid.timeToImpact === null ? 'MISSES' : `${where} ${formatCountdown(asteroid.timeToImpact)}`;
    context.fillStyle = color;
    if (asteroid.identified) {
      const rating = ratingOf(asteroid);
      context.fillText(`${SIZE_LABEL[asteroid.size]} ${MATERIAL_TRAITS[asteroid.material].label.toUpperCase()}  ${eta}`, x, y - 4);
      context.fillStyle = RATING_COLOR[rating];
      context.fillText(RATING_LABEL[rating], x, y + 22);
    } else {
      context.fillText(`${SIZE_LABEL[asteroid.size]} UNIDENTIFIED  ${eta}`, x, y - 4);
      // Scan progress: aim at the contact to fill it.
      context.fillStyle = 'rgba(232, 241, 255, 0.25)';
      context.fillRect(x, y + 15, 70, 3);
      context.fillStyle = '#8fd3ff';
      context.fillRect(x, y + 15, 70 * Math.min(1, asteroid.scanProgress), 3);
    }
    context.fillStyle = 'rgba(232, 241, 255, 0.75)';
    context.fillText(`${formatDistance(distance)} · ${formatSpeed(asteroid.velocity.length())}`, x, y + 9);
  }

  /** Countdown text next to the pulsing marker on the globe. */
  private drawImpactTag(asteroid: Asteroid, color: string): void {
    if (asteroid.timeToImpact === null) {
      return;
    }
    const impact = asteroid.mesh.position.clone().addScaledVector(asteroid.velocity, asteroid.timeToImpact);
    const point = this.projector.project(impact);
    if (!point.visible) {
      return;
    }
    const context = this.context;
    context.fillStyle = color;
    context.beginPath();
    context.arc(point.x, point.y, 2.5, 0, Math.PI * 2);
    context.fill();
    context.fillText(`${SIZE_LABEL[asteroid.size]} ${formatCountdown(asteroid.timeToImpact)}`, point.x + 7, point.y + 4);
  }

  private drawEdgeArrow(point: ScreenPoint, color: string, asteroid: Asteroid): void {
    const width = this.projector.width;
    const height = this.projector.height;
    const angle = Math.atan2(point.y - height / 2, point.x - width / 2);
    const marginX = width / 2 - 48;
    const marginY = height / 2 - 48;
    const scale = Math.min(marginX / Math.abs(Math.cos(angle) || 1e-6), marginY / Math.abs(Math.sin(angle) || 1e-6));
    const x = width / 2 + Math.cos(angle) * scale;
    const y = height / 2 + Math.sin(angle) * scale;
    const context = this.context;
    context.save();
    context.translate(x, y);
    context.rotate(angle);
    context.globalAlpha = 0.65 + 0.35 * Math.sin(this.elapsed * 6);
    context.fillStyle = color;
    context.beginPath();
    context.moveTo(14, 0);
    context.lineTo(-6, -9);
    context.lineTo(-2, 0);
    context.lineTo(-6, 9);
    context.closePath();
    context.fill();
    context.restore();
    context.fillStyle = color;
    const eta = asteroid.timeToImpact === null ? '' : formatCountdown(asteroid.timeToImpact);
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
    context.textAlign = 'right';
    context.fillText('LOCK', x - size - 6, y + 4);
    context.textAlign = 'left';
  }

  private drawShipMarker(position: THREE.Vector3): void {
    const point = this.projector.project(position);
    if (!point.visible) {
      return;
    }
    const context = this.context;
    context.strokeStyle = '#7dffb0';
    context.lineWidth = 2;
    context.beginPath();
    context.arc(point.x, point.y, 8 + Math.sin(this.elapsed * 4) * 2, 0, Math.PI * 2);
    context.stroke();
    context.fillStyle = '#7dffb0';
    context.fillText('YOU', point.x + 14, point.y + 4);
  }
}
