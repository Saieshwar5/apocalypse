import * as THREE from 'three';
import type { ScreenProjector } from './screenProjector';

export type HitQuality = 'solid' | 'weak-range' | 'resisted';

interface FloatingText {
  world: THREE.Vector3;
  /** Sideways pixel offset so numbers from rapid hits do not stack. */
  drift: number;
  text: string;
  color: string;
  size: number;
  age: number;
  lifetime: number;
}

const HIT_MARKER_SECONDS = 0.18;
const MAX_TEXTS = 40;

const QUALITY_COLOR: Record<HitQuality, string> = {
  solid: '#ffffff',
  'weak-range': '#ffb347',
  resisted: '#9aa6b5',
};

/**
 * Tells the player their shots connect: a hit marker on the reticle, damage
 * numbers that rise from the impact point, and a kill confirmation with the
 * score earned. Colour says how good the hit was: white solid, amber weak
 * because of range, grey resisted by iron.
 */
export class CombatFeedback {
  hitMarker = 0;
  hitQuality: HitQuality = 'solid';
  killMarker = 0;
  private readonly texts: FloatingText[] = [];

  hit(point: THREE.Vector3, damage: number, quality: HitQuality): void {
    this.hitMarker = HIT_MARKER_SECONDS;
    this.hitQuality = quality;
    const suffix = quality === 'resisted' ? ' RESISTED' : quality === 'weak-range' ? ' FAR' : '';
    this.push({
      world: point.clone(),
      drift: (Math.random() - 0.5) * 56,
      text: `-${Math.max(1, Math.round(damage))}${suffix}`,
      color: QUALITY_COLOR[quality],
      size: 12,
      age: 0,
      lifetime: 0.9,
    });
  }

  kill(point: THREE.Vector3, score: number, label: string): void {
    this.killMarker = 0.45;
    this.push({ world: point.clone(), drift: 0, text: `${label}  +${score}`, color: '#7dffb0', size: 16, age: 0, lifetime: 1.6 });
  }

  /** Short text at a world point, for example a shield hit near the ship. */
  note(point: THREE.Vector3, text: string, color: string): void {
    this.push({ world: point.clone(), drift: 0, text, color, size: 13, age: 0, lifetime: 1.2 });
  }

  update(deltaSeconds: number): void {
    this.hitMarker = Math.max(0, this.hitMarker - deltaSeconds);
    this.killMarker = Math.max(0, this.killMarker - deltaSeconds);
    for (let index = this.texts.length - 1; index >= 0; index -= 1) {
      const text = this.texts[index];
      text.age += deltaSeconds;
      if (text.age >= text.lifetime) {
        this.texts.splice(index, 1);
      }
    }
  }

  draw(context: CanvasRenderingContext2D, projector: ScreenProjector): void {
    context.save();
    context.textAlign = 'center';
    for (const text of this.texts) {
      const point = projector.project(text.world);
      if (!point.visible) {
        continue;
      }
      const t = text.age / text.lifetime;
      context.globalAlpha = 1 - t * t;
      context.font = `700 ${text.size}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      context.fillStyle = 'rgba(0, 0, 0, 0.55)';
      const y = point.y - 18 - t * 34;
      const x = point.x + text.drift * (0.4 + t);
      context.fillText(text.text, x + 1, y + 1);
      context.fillStyle = text.color;
      context.fillText(text.text, x, y);
    }
    context.restore();
  }

  clear(): void {
    this.texts.length = 0;
    this.hitMarker = 0;
    this.killMarker = 0;
  }

  private push(text: FloatingText): void {
    this.texts.push(text);
    if (this.texts.length > MAX_TEXTS) {
      this.texts.shift();
    }
  }
}
