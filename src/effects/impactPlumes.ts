import * as THREE from 'three';
import { EARTH_RADIUS, type Earth } from '../scene/earth';
import { getGlowTexture } from '../scene/glowTexture';

const MAX_PLUMES = 28;
const FIRE_SECONDS = 30;
const SMOKE_SECONDS = 75;

interface Plume {
  fire: THREE.Sprite;
  smoke: THREE.Sprite;
  age: number;
  size: number;
  seed: number;
}

/**
 * Fires and smoke left where asteroids hit Earth, visible from orbit. They
 * are fixed to the surface and turn with the planet: a flickering fire glow
 * for half a minute and a dark smoke pall that spreads and thins for longer.
 * The permanent dark scar is drawn by the Earth shader.
 */
export class ImpactPlumes {
  private readonly plumes: Plume[] = [];

  constructor(private readonly earth: Earth) {}

  /** `size` is the crater's angular radius in radians. */
  add(worldPoint: THREE.Vector3, size: number): void {
    if (this.plumes.length >= MAX_PLUMES) {
      this.remove(this.plumes[0]);
    }
    const local = this.earth.worldToLocalDirection(worldPoint);
    const sprite = (color: THREE.Color, blending: THREE.Blending, height: number) => {
      const made = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: getGlowTexture(), color, transparent: true, blending, depthWrite: false }),
      );
      made.position.copy(local).multiplyScalar(EARTH_RADIUS * height);
      this.earth.attachToSurface(made);
      return made;
    };
    this.plumes.push({
      fire: sprite(new THREE.Color(4, 1.4, 0.3), THREE.AdditiveBlending, 1.011),
      smoke: sprite(new THREE.Color(0.05, 0.045, 0.04), THREE.NormalBlending, 1.016),
      age: 0,
      size: size * EARTH_RADIUS,
      seed: Math.random() * 100,
    });
  }

  update(deltaSeconds: number): void {
    for (const plume of [...this.plumes]) {
      plume.age += deltaSeconds;
      if (plume.age >= SMOKE_SECONDS) {
        this.remove(plume);
        continue;
      }
      const fire = Math.max(0, 1 - plume.age / FIRE_SECONDS);
      const flicker = 0.75 + 0.25 * Math.sin(plume.age * 11 + plume.seed) * Math.sin(plume.age * 7.3);
      plume.fire.scale.setScalar(plume.size * (1.2 + fire));
      plume.fire.material.opacity = fire * flicker;
      const t = plume.age / SMOKE_SECONDS;
      plume.smoke.scale.setScalar(plume.size * (2 + t * 7));
      plume.smoke.material.opacity = Math.min(1, plume.age / 3) * (1 - t) * 0.8;
    }
  }

  clear(): void {
    for (const plume of [...this.plumes]) {
      this.remove(plume);
    }
  }

  private remove(plume: Plume): void {
    for (const sprite of [plume.fire, plume.smoke]) {
      sprite.parent?.remove(sprite);
      sprite.material.dispose();
    }
    const index = this.plumes.indexOf(plume);
    if (index !== -1) {
      this.plumes.splice(index, 1);
    }
  }
}
