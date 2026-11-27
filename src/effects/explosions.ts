import * as THREE from 'three';
import { getGlowTexture } from '../scene/glowTexture';

export type ExplosionStyle = 'fire' | 'ice' | 'spark' | 'dust';

interface Burst {
  points: THREE.Points;
  velocities: Float32Array;
  age: number;
  lifetime: number;
  material: THREE.PointsMaterial;
  startColor: THREE.Color;
}

interface Flash {
  sprite: THREE.Sprite;
  age: number;
  lifetime: number;
  maxScale: number;
}

interface Shockwave {
  mesh: THREE.Mesh;
  age: number;
  lifetime: number;
  maxScale: number;
}

const STYLE_COLORS: Record<ExplosionStyle, THREE.Color> = {
  dust: new THREE.Color(0.55, 0.5, 0.44),
  fire: new THREE.Color(5, 2.2, 0.7),
  ice: new THREE.Color(1.6, 3.2, 5),
  spark: new THREE.Color(6, 3.5, 1.5),
};

/**
 * Particle bursts, bright flashes and surface shockwaves. Everything is
 * additive and brighter than 1.0 so the bloom pass makes it glow.
 */
export class Explosions {
  readonly group = new THREE.Group();
  private readonly bursts: Burst[] = [];
  private readonly flashes: Flash[] = [];
  private readonly shockwaves: Shockwave[] = [];
  private readonly ringGeometry = new THREE.RingGeometry(0.94, 1, 64);

  /** `scale` is roughly the radius of what exploded. */
  spawnExplosion(point: THREE.Vector3, scale: number, style: ExplosionStyle): void {
    const count = Math.min(420, Math.round(70 + scale * 90));
    this.spawnBurst(point, count, scale * 4.5, 0.9 + scale * 0.25, style, scale);
    this.spawnFlash(point, scale * 6, 0.35 + scale * 0.05, STYLE_COLORS[style]);
  }

  /** Small spark burst where a bolt hits without destroying. */
  spawnHitSpark(point: THREE.Vector3): void {
    this.spawnBurst(point, 10, 6, 0.35, 'spark', 0.3);
  }

  /** Grey rock chips knocked off the surface by a hit. */
  spawnRockChips(point: THREE.Vector3, amount = 1): void {
    this.spawnBurst(point, Math.round(10 + amount * 14), 4 + amount * 3, 0.8, 'dust', 0.3 + amount * 0.2);
  }

  /** Flash and expanding ring lying on the planet's surface. */
  spawnSurfaceImpact(point: THREE.Vector3, scale: number): void {
    this.spawnFlash(point.clone().multiplyScalar(1.01), scale * 4.5, 1.2, new THREE.Color(5, 2.2, 0.8));
    const ring = new THREE.Mesh(
      this.ringGeometry,
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(4, 2, 1),
        transparent: true,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    ring.position.copy(point).multiplyScalar(1.004);
    ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), point.clone().normalize());
    this.group.add(ring);
    this.shockwaves.push({ mesh: ring, age: 0, lifetime: 2.2, maxScale: scale * 3.5 });
    this.spawnBurst(point, 120, scale * 3, 1.6, 'fire', scale);
  }

  update(deltaSeconds: number): void {
    this.updateBursts(deltaSeconds);
    for (const flash of [...this.flashes]) {
      flash.age += deltaSeconds;
      const t = flash.age / flash.lifetime;
      if (t >= 1) {
        this.removeFrom(this.flashes, flash, flash.sprite);
        continue;
      }
      flash.sprite.scale.setScalar(flash.maxScale * (0.4 + 0.6 * Math.sqrt(t)));
      flash.sprite.material.opacity = (1 - t) * (1 - t);
    }
    for (const wave of [...this.shockwaves]) {
      wave.age += deltaSeconds;
      const t = wave.age / wave.lifetime;
      if (t >= 1) {
        this.removeFrom(this.shockwaves, wave, wave.mesh);
        continue;
      }
      wave.mesh.scale.setScalar(wave.maxScale * Math.sqrt(t));
      (wave.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - t;
    }
  }

  clear(): void {
    for (const burst of [...this.bursts]) {
      this.removeFrom(this.bursts, burst, burst.points);
    }
    for (const flash of [...this.flashes]) {
      this.removeFrom(this.flashes, flash, flash.sprite);
    }
    for (const wave of [...this.shockwaves]) {
      this.removeFrom(this.shockwaves, wave, wave.mesh);
    }
  }

  private spawnBurst(
    point: THREE.Vector3,
    count: number,
    speed: number,
    lifetime: number,
    style: ExplosionStyle,
    scale: number,
  ): void {
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      positions.set([point.x, point.y, point.z], index * 3);
      const direction = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      const magnitude = speed * (0.25 + Math.random() * 0.75);
      velocities.set([direction.x * magnitude, direction.y * magnitude, direction.z * magnitude], index * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const startColor = STYLE_COLORS[style].clone();
    const material = new THREE.PointsMaterial({
      size: Math.max(0.12, scale * 0.28),
      map: getGlowTexture(),
      color: startColor.clone(),
      transparent: true,
      depthWrite: false,
      blending: style === 'dust' ? THREE.NormalBlending : THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    this.group.add(points);
    this.bursts.push({ points, velocities, age: 0, lifetime, material, startColor });
  }

  private spawnFlash(point: THREE.Vector3, size: number, lifetime: number, color: THREE.Color): void {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: getGlowTexture(),
        color,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    sprite.position.copy(point);
    this.group.add(sprite);
    this.flashes.push({ sprite, age: 0, lifetime, maxScale: size });
  }

  private updateBursts(deltaSeconds: number): void {
    const slowdown = Math.exp(-1.6 * deltaSeconds);
    for (const burst of [...this.bursts]) {
      burst.age += deltaSeconds;
      const t = burst.age / burst.lifetime;
      if (t >= 1) {
        this.removeFrom(this.bursts, burst, burst.points);
        continue;
      }
      const attribute = burst.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      const positions = attribute.array as Float32Array;
      for (let index = 0; index < positions.length; index += 1) {
        burst.velocities[index] *= slowdown;
        positions[index] += burst.velocities[index] * deltaSeconds;
      }
      attribute.needsUpdate = true;
      // Hot white-orange to dim red smoke.
      const heat = 1 - t;
      burst.material.color.setRGB(
        burst.startColor.r * heat,
        burst.startColor.g * heat * heat,
        burst.startColor.b * heat * heat * heat,
      );
      burst.material.opacity = Math.min(1, heat * 1.5);
    }
  }

  private removeFrom<T>(list: T[], item: T, object: THREE.Object3D): void {
    const index = list.indexOf(item);
    if (index !== -1) {
      list.splice(index, 1);
    }
    this.group.remove(object);
    if (object instanceof THREE.Points || object instanceof THREE.Mesh || object instanceof THREE.Sprite) {
      if (object instanceof THREE.Points) {
        object.geometry.dispose();
      }
      (object.material as THREE.Material).dispose();
    }
  }
}
