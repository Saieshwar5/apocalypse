import * as THREE from 'three';
import { DebrisChunks } from './debrisChunks';
import {
  AFTERGLOW,
  CORE_FLASH,
  DUST,
  FIREBALL,
  GRIT,
  ICE_FLASH,
  ICE_GLITTER,
  ICE_MIST,
  IMPACT_FLASH,
  SPARK,
} from './explosionRamps';
import { PuffParticles, type ColorRamp } from './puffParticles';

export type ExplosionStyle = 'fire' | 'ice' | 'spark' | 'dust';

interface Shockwave {
  mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  age: number;
  lifetime: number;
  maxScale: number;
}

/** Enough for several giants going up at once; beyond that old particles are reused. */
const MAX_PUFFS = 2400;
const MAX_CHUNKS = 360;
const MAX_SHARDS = 360;
const STILL = new THREE.Vector3();
const SURFACE_UP = new THREE.Vector3(0, 0, 1);

function between(low: number, high: number): number {
  return low + Math.random() * (high - low);
}

function countFor(base: number, perScale: number, scale: number, limit: number): number {
  return Math.min(limit, Math.round(base + perScale * scale));
}

/**
 * Everything that happens when something blows up or is hit: flash,
 * fireball cooling into smoke, sparks, tumbling debris and lingering dust,
 * or for ice a burst of vapour, shards and glitter. All of it comes from
 * three fixed-size pools, so heavy fighting cannot grow memory or draw calls.
 */
export class Explosions {
  readonly group = new THREE.Group();
  private readonly puffs = new PuffParticles(MAX_PUFFS);
  private readonly chunks = new DebrisChunks('rock', MAX_CHUNKS);
  private readonly shards = new DebrisChunks('ice', MAX_SHARDS);
  private readonly shockwaves: Shockwave[] = [];
  private readonly ringGeometry = new THREE.RingGeometry(0.94, 1, 64);
  private readonly position = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();

  constructor() {
    this.group.add(this.chunks.mesh, this.shards.mesh, this.puffs.mesh);
  }

  /**
   * `scale` is roughly the radius of what exploded. `inherited` is the
   * velocity of the thing that blew up; the cloud and debris keep it.
   */
  spawnExplosion(
    point: THREE.Vector3,
    scale: number,
    style: ExplosionStyle,
    inherited: THREE.Vector3 = STILL,
  ): void {
    switch (style) {
      case 'fire':
        this.spawnFireball(point, scale, inherited);
        break;
      case 'ice':
        this.spawnIceShatter(point, scale, inherited);
        break;
      case 'spark':
        this.spawnGlow(point, inherited, scale * 2, scale * 4, 0.2, CORE_FLASH, 0.6);
        this.spawnSparks(point, inherited, countFor(20, 40, scale, 140), scale * 5, scale);
        break;
      case 'dust':
        this.spawnDust(point, inherited, countFor(6, 6, scale, 30), scale);
        this.spawnDebris(this.chunks, point, inherited, countFor(4, 6, scale, 30), scale, 0);
        break;
    }
  }

  /** Small spark burst where a bolt hits without destroying. */
  spawnHitSpark(point: THREE.Vector3): void {
    this.spawnGlow(point, STILL, 0.3, 1.1, 0.14, CORE_FLASH, 0.45);
    this.spawnSparks(point, STILL, 10, 6, 0.3);
  }

  /** Grey rock chips knocked off the surface by a hit. */
  spawnRockChips(point: THREE.Vector3, amount = 1): void {
    const reach = 0.3 + amount * 0.2;
    for (let index = 0; index < Math.round(8 + amount * 10); index += 1) {
      this.aim(point, STILL, reach * 0.3, between(1, 4 + amount * 3));
      this.puffs.spawn({
        position: this.position,
        velocity: this.velocity,
        drag: 1.6,
        lifetime: between(0.5, 1.0),
        startSize: between(0.05, 0.12) + amount * 0.02,
        endSize: 0.03,
        ramp: GRIT,
        cloudiness: 0,
      });
    }
    for (let index = 0; index < Math.round(2 + amount * 2); index += 1) {
      this.aim(point, STILL, reach * 0.4, between(0.3, 1.2 + amount * 0.6));
      this.puffs.spawn({
        position: this.position,
        velocity: this.velocity,
        drag: 1.4,
        lifetime: between(0.8, 1.5),
        startSize: reach * 0.8,
        endSize: reach * 2.6,
        ramp: DUST,
        cloudiness: 1,
        brightness: 1.3,
      });
    }
    for (let index = 0; index < Math.round(3 + amount * 4); index += 1) {
      this.aim(point, STILL, reach * 0.3, between(1.2, 3.5 + amount * 2));
      this.chunks.spawn({
        position: this.position,
        velocity: this.velocity,
        size: between(0.03, 0.07) + amount * 0.015,
        lifetime: between(0.9, 1.7),
        heat: 0,
      });
    }
  }

  /** Flash, fire and an expanding ring lying on the planet's surface. */
  spawnSurfaceImpact(point: THREE.Vector3, scale: number): void {
    const up = this.direction.copy(point).normalize().clone();
    const flashPoint = point.clone().multiplyScalar(1.01);
    this.spawnGlow(flashPoint, STILL, scale * 2, scale * 4.5, 1.2, IMPACT_FLASH, 1);

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
    ring.quaternion.setFromUnitVectors(SURFACE_UP, up);
    ring.scale.setScalar(0.001);
    this.group.add(ring);
    this.shockwaves.push({ mesh: ring, age: 0, lifetime: 2.2, maxScale: scale * 3.5 });

    // Everything is thrown into the half of space above the ground.
    for (let index = 0; index < countFor(10, 5, scale, 34); index += 1) {
      this.aim(flashPoint, STILL, scale * 0.4, scale * between(0.3, 1.5), up);
      this.puffs.spawn({
        position: this.position,
        velocity: this.velocity,
        drag: 1.2,
        lifetime: between(1.2, 2.2),
        startSize: scale * 0.6,
        endSize: scale * between(1.3, 2.0),
        ramp: FIREBALL,
        cloudiness: 1,
      });
    }
    this.spawnSparks(flashPoint, STILL, countFor(30, 12, scale, 90), scale * 3, scale, up);
    this.spawnDebris(this.chunks, flashPoint, STILL, countFor(8, 5, scale, 30), scale, 1, up);
  }

  update(deltaSeconds: number): void {
    this.puffs.update(deltaSeconds);
    this.chunks.update(deltaSeconds);
    this.shards.update(deltaSeconds);
    for (let index = this.shockwaves.length - 1; index >= 0; index -= 1) {
      const wave = this.shockwaves[index];
      wave.age += deltaSeconds;
      const t = wave.age / wave.lifetime;
      if (t >= 1) {
        this.removeShockwave(index);
        continue;
      }
      wave.mesh.scale.setScalar(wave.maxScale * Math.sqrt(t));
      wave.mesh.material.opacity = 1 - t;
    }
  }

  clear(): void {
    this.puffs.clear();
    this.chunks.clear();
    this.shards.clear();
    for (let index = this.shockwaves.length - 1; index >= 0; index -= 1) {
      this.removeShockwave(index);
    }
  }

  /** Frees GPU resources; the instance must not be used afterwards. */
  dispose(): void {
    this.clear();
    this.puffs.dispose();
    this.chunks.dispose();
    this.shards.dispose();
    this.ringGeometry.dispose();
  }

  private spawnFireball(point: THREE.Vector3, scale: number, inherited: THREE.Vector3): void {
    this.spawnGlow(point, inherited, scale * 1.4, scale * 3.4, 0.18, CORE_FLASH, 1);
    this.spawnGlow(point, inherited, scale * 3, scale * 4.5, 0.9 + scale * 0.1, AFTERGLOW, 1);
    for (let index = 0; index < countFor(9, 6, scale, 40); index += 1) {
      this.aim(point, inherited, scale * 0.45, scale * between(0.4, 2.4));
      this.puffs.spawn({
        position: this.position,
        velocity: this.velocity,
        drag: 2.2,
        lifetime: (0.9 + scale * 0.14) * between(0.7, 1.3),
        startSize: scale * between(0.6, 0.9),
        endSize: scale * between(1.5, 2.3),
        ramp: FIREBALL,
        cloudiness: 1,
        brightness: between(0.75, 1.1),
      });
    }
    this.spawnSparks(point, inherited, countFor(24, 20, scale, 130), scale * 4 + 3, scale);
    this.spawnDust(point, inherited, countFor(6, 4, scale, 26), scale);
    this.spawnDebris(this.chunks, point, inherited, countFor(9, 9, scale, 56), scale, 1);
  }

  private spawnIceShatter(point: THREE.Vector3, scale: number, inherited: THREE.Vector3): void {
    this.spawnGlow(point, inherited, scale * 1.4, scale * 3.4, 0.18, ICE_FLASH, 1);
    for (let index = 0; index < countFor(7, 5, scale, 32); index += 1) {
      this.aim(point, inherited, scale * 0.5, scale * between(0.6, 2.6));
      this.puffs.spawn({
        position: this.position,
        velocity: this.velocity,
        drag: 1.7,
        lifetime: (1.2 + scale * 0.15) * between(0.7, 1.3),
        startSize: scale * between(0.6, 0.9),
        endSize: scale * between(1.8, 2.8),
        ramp: ICE_MIST,
        cloudiness: 1,
      });
    }
    for (let index = 0; index < countFor(40, 34, scale, 190); index += 1) {
      this.aim(point, inherited, scale * 0.6, scale * between(0.5, 3.4) + between(0, 1.5));
      this.puffs.spawn({
        position: this.position,
        velocity: this.velocity,
        drag: 1.1,
        lifetime: between(1.3, 3.0),
        startSize: between(0.07, 0.14) + scale * 0.03,
        endSize: 0.04,
        ramp: ICE_GLITTER,
        cloudiness: 0,
        brightness: between(0.5, 1.1),
        twinkle: between(1.5, 5),
      });
    }
    this.spawnDebris(this.shards, point, inherited, countFor(16, 15, scale, 84), scale, 0);
  }

  /** One soft additive disc; used for flashes. */
  private spawnGlow(
    point: THREE.Vector3,
    inherited: THREE.Vector3,
    startSize: number,
    endSize: number,
    lifetime: number,
    ramp: ColorRamp,
    brightness: number,
  ): void {
    this.puffs.spawn({
      position: point,
      velocity: inherited,
      drag: 0,
      lifetime,
      startSize,
      endSize,
      ramp,
      cloudiness: 0,
      brightness,
    });
  }

  private spawnSparks(
    point: THREE.Vector3,
    inherited: THREE.Vector3,
    count: number,
    speed: number,
    scale: number,
    up?: THREE.Vector3,
  ): void {
    for (let index = 0; index < count; index += 1) {
      this.aim(point, inherited, scale * 0.3, speed * between(0.25, 1), up);
      this.puffs.spawn({
        position: this.position,
        velocity: this.velocity,
        drag: 1.5,
        lifetime: between(0.4, 1.2),
        startSize: between(0.06, 0.13) + scale * 0.08,
        endSize: 0.03,
        ramp: SPARK,
        cloudiness: 0,
        brightness: between(0.5, 1),
      });
    }
  }

  private spawnDust(point: THREE.Vector3, inherited: THREE.Vector3, count: number, scale: number): void {
    for (let index = 0; index < count; index += 1) {
      this.aim(point, inherited, scale * 0.6, scale * between(0.25, 1.3));
      this.puffs.spawn({
        position: this.position,
        velocity: this.velocity,
        drag: 0.9,
        lifetime: between(2.4, 4.2),
        startSize: scale * between(0.8, 1.2),
        endSize: scale * between(2.4, 3.4),
        ramp: DUST,
        cloudiness: 1,
        brightness: between(0.8, 1.2),
      });
    }
  }

  private spawnDebris(
    pool: DebrisChunks,
    point: THREE.Vector3,
    inherited: THREE.Vector3,
    count: number,
    scale: number,
    heat: number,
    up?: THREE.Vector3,
  ): void {
    for (let index = 0; index < count; index += 1) {
      this.aim(point, inherited, scale * 0.6, 1 + scale * between(0.7, 2.8), up);
      // Mostly gravel with the odd large block.
      const size = scale * (0.045 + 0.17 * Math.random() ** 2.5);
      pool.spawn({
        position: this.position,
        velocity: this.velocity,
        size,
        lifetime: between(1.8, 3.6),
        heat: heat * between(0.45, 1),
      });
    }
  }

  /**
   * Fills `this.position` and `this.velocity` for one particle: a random
   * direction (kept above the ground when `up` is given), a start point up
   * to `spread` along it and `speed` on top of the inherited velocity.
   */
  private aim(
    point: THREE.Vector3,
    inherited: THREE.Vector3,
    spread: number,
    speed: number,
    up?: THREE.Vector3,
  ): void {
    this.direction.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    if (up && this.direction.dot(up) < 0.15) {
      this.direction.addScaledVector(up, 0.15 - 2 * this.direction.dot(up)).normalize();
    }
    this.position.copy(point).addScaledVector(this.direction, spread * Math.random());
    this.velocity.copy(inherited).addScaledVector(this.direction, speed);
  }

  private removeShockwave(index: number): void {
    const [wave] = this.shockwaves.splice(index, 1);
    this.group.remove(wave.mesh);
    wave.mesh.material.dispose();
  }
}
