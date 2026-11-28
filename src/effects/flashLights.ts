import * as THREE from 'three';

interface Flash {
  light: THREE.PointLight;
  age: number;
  lifetime: number;
  peak: number;
}

/** Lights are costly, so a few are shared: a new flash takes over the dimmest one. */
const POOL = 3;

/**
 * Real light from explosions: for a moment a blast lights the ship's hull,
 * nearby rocks and the station, so it is felt as an event in the world and
 * not only seen as a sprite. The lights stay in the scene at zero strength
 * between flashes, so no material is ever rebuilt mid-fight.
 */
export class FlashLights {
  readonly group = new THREE.Group();
  private readonly flashes: Flash[] = [];

  constructor() {
    for (let index = 0; index < POOL; index += 1) {
      const light = new THREE.PointLight(0xffffff, 0, 1, 1.6);
      this.group.add(light);
      this.flashes.push({ light, age: 1, lifetime: 1, peak: 0 });
    }
  }

  /** `reach` is how far the light carries; `strength` its brightness at the start. */
  flash(point: THREE.Vector3, color: THREE.ColorRepresentation, strength: number, reach: number, seconds: number): void {
    let slot = this.flashes[0];
    for (const flash of this.flashes) {
      if (flash.light.intensity < slot.light.intensity) {
        slot = flash;
      }
    }
    slot.light.position.copy(point);
    slot.light.color.set(color);
    slot.light.distance = reach;
    slot.light.intensity = strength;
    slot.age = 0;
    slot.lifetime = seconds;
    slot.peak = strength;
  }

  update(deltaSeconds: number): void {
    for (const flash of this.flashes) {
      if (flash.light.intensity <= 0) {
        continue;
      }
      flash.age += deltaSeconds;
      const left = Math.max(0, 1 - flash.age / flash.lifetime);
      flash.light.intensity = flash.peak * left * left;
    }
  }

  clear(): void {
    for (const flash of this.flashes) {
      flash.light.intensity = 0;
      flash.peak = 0;
    }
  }
}
