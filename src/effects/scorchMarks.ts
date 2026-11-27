import * as THREE from 'three';
import { getGlowTexture } from '../scene/glowTexture';

const MAX_PER_ASTEROID = 6;
/** Seconds a mark glows hot before cooling to a dark scorch. */
const COOL_SECONDS = 1.4;

interface Mark {
  sprite: THREE.Sprite;
  age: number;
}

/**
 * Glowing marks left on an asteroid where shots land. They stay attached and
 * turn with the rock, so the player can see where they have been hitting.
 * Marks are children of the asteroid mesh and disappear with it.
 */
export class ScorchMarks {
  private readonly marks: Mark[] = [];
  private readonly counts = new WeakMap<THREE.Object3D, number>();

  add(target: THREE.Mesh, worldPoint: THREE.Vector3, size: number): void {
    const count = this.counts.get(target) ?? 0;
    if (count >= MAX_PER_ASTEROID) {
      // Re-heat the oldest mark on this rock instead of adding another.
      const existing = this.marks.find((mark) => mark.sprite.parent === target);
      if (existing) {
        existing.age = 0;
        existing.sprite.position.copy(target.worldToLocal(worldPoint.clone()));
      }
      return;
    }
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: getGlowTexture(),
        color: new THREE.Color(4, 1.6, 0.5),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    // Children inherit the rock's scale, so divide it out.
    const local = target.worldToLocal(worldPoint.clone());
    sprite.position.copy(local);
    sprite.scale.setScalar(size / Math.max(target.scale.x, 0.01));
    target.add(sprite);
    this.counts.set(target, count + 1);
    this.marks.push({ sprite, age: 0 });
  }

  update(deltaSeconds: number): void {
    for (let index = this.marks.length - 1; index >= 0; index -= 1) {
      const mark = this.marks[index];
      if (!mark.sprite.parent) {
        mark.sprite.material.dispose();
        this.marks.splice(index, 1);
        continue;
      }
      mark.age += deltaSeconds;
      const heat = Math.max(0, 1 - mark.age / COOL_SECONDS);
      // Hot orange flash cooling to a faint ember that stays visible.
      mark.sprite.material.color.setRGB(0.5 + 3.5 * heat, 0.15 + 1.45 * heat, 0.05 + 0.45 * heat);
      mark.sprite.material.opacity = 0.35 + heat * 0.65;
    }
  }

  clear(): void {
    for (const mark of this.marks) {
      mark.sprite.parent?.remove(mark.sprite);
      mark.sprite.material.dispose();
    }
    this.marks.length = 0;
  }
}
