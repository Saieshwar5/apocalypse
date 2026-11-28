import * as THREE from 'three';
import { DebrisChunks } from './debrisChunks';
import {
  AFTERGLOW,
  CORE_FLASH,
  DUST,
  EMBER,
  FIREBALL,
  GRIT,
  ICE_FLASH,
  ICE_GLITTER,
  ICE_MIST,
  IMPACT_FLASH,
  SPARK,
} from './explosionRamps';
import { FlashLights } from './flashLights';
import { PuffParticles, type ColorRamp } from './puffParticles';
import { Shockwaves } from './shockwaves';

/** 'blast' is a warhead: the same fire, with a harder flash, two rings and far-flung embers. */
export type ExplosionStyle = 'fire' | 'blast' | 'ice' | 'spark' | 'dust';

/** Enough for several giants going up at once; beyond that old particles are reused. */
const MAX_PUFFS = 2400;
const MAX_CHUNKS = 360;
const MAX_SHARDS = 360;
const STILL = new THREE.Vector3();

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
  private readonly waves = new Shockwaves();
  private readonly lights = new FlashLights();
  private readonly position = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();

  constructor() {
    this.group.add(this.chunks.mesh, this.shards.mesh, this.puffs.mesh, this.waves.group, this.lights.group);
  }

  /** Blast rings in space turn to face this camera. */
  set camera(camera: THREE.Camera) {
    this.waves.camera = camera;
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
        this.waves.addInSpace(point, { radius: scale * 3.5 + 1.5, seconds: 0.6, color: [2.6, 1.9, 1.1], opacity: 0.7 });
        this.lights.flash(point, 0xffc890, 40 + scale * 60, 30 + scale * 14, 0.5);
        break;
      case 'blast':
        this.spawnBlast(point, scale, inherited);
        break;
      case 'ice':
        this.spawnIceShatter(point, scale, inherited);
        this.waves.addInSpace(point, { radius: scale * 3.5 + 1.5, seconds: 0.7, color: [1.2, 2.0, 2.9], opacity: 0.7 });
        this.lights.flash(point, 0xa8d8ff, 40 + scale * 60, 30 + scale * 14, 0.5);
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

  /**
   * A rock reaching the ground, staged so it reads from orbit: a blinding
   * flash, a bright shock front racing over the surface with a slower
   * pressure wave behind it, a column of fire and dust thrown up into
   * space, and a skirt of dust spreading along the ground.
   */
  spawnSurfaceImpact(point: THREE.Vector3, scale: number): void {
    const up = this.direction.copy(point).normalize().clone();
    const flashPoint = point.clone().multiplyScalar(1.012);
    // Even a small rock is an event; a giant covers a continent.
    const reach = 1.2 + scale * 1.5;
    this.spawnGlow(flashPoint, STILL, reach * 2.5, reach * 6, 0.45, CORE_FLASH, 1.5);
    this.spawnGlow(flashPoint, STILL, reach * 3, reach * 8, 2.4, IMPACT_FLASH, 1);
    this.spawnGlow(flashPoint, STILL, reach * 5, reach * 9, 5, AFTERGLOW, 1.6);
    this.waves.addOnSurface(point, { radius: reach * 6, seconds: 2.6, color: [4.5, 2.6, 1.2] });
    this.waves.addOnSurface(point, { radius: reach * 13, seconds: 7, color: [1.1, 1.3, 1.7], opacity: 0.55 });
    this.lights.flash(point.clone().multiplyScalar(1.06), 0xffb070, 300 + scale * 500, 60 + scale * 30, 1.6);

    // The column: fire climbing out of the atmosphere, cooling into smoke.
    for (let index = 0; index < countFor(14, 8, scale, 48); index += 1) {
      this.aim(flashPoint, STILL, reach * 0.3, reach * between(0.2, 0.7), up);
      this.velocity.addScaledVector(up, reach * between(0.6, 2.2));
      this.puffs.spawn({
        position: this.position,
        velocity: this.velocity,
        drag: 0.7,
        lifetime: between(2.6, 5.5),
        startSize: reach * between(0.5, 0.8),
        endSize: reach * between(1.6, 2.6),
        ramp: FIREBALL,
        cloudiness: 1,
      });
    }
    // The skirt: dust thrown outwards low over the ground.
    for (let index = 0; index < countFor(12, 6, scale, 40); index += 1) {
      this.aim(flashPoint, STILL, reach * 0.5, reach * between(0.8, 2.0), up);
      this.velocity.addScaledVector(up, -0.6 * this.velocity.dot(up));
      this.puffs.spawn({
        position: this.position,
        velocity: this.velocity,
        drag: 0.8,
        lifetime: between(4, 8),
        startSize: reach * between(0.6, 1.0),
        endSize: reach * between(2.2, 3.4),
        ramp: DUST,
        cloudiness: 1,
        brightness: between(0.9, 1.4),
      });
    }
    this.spawnSparks(flashPoint, STILL, countFor(40, 16, scale, 110), reach * 3.5, reach * 0.7, up);
    this.spawnEmbers(flashPoint, STILL, countFor(16, 8, scale, 50), reach * 4, reach * 0.6, up);
    this.spawnDebris(this.chunks, flashPoint, STILL, countFor(10, 6, scale, 36), reach * 0.8, 1, up);
  }

  update(deltaSeconds: number): void {
    this.puffs.update(deltaSeconds);
    this.chunks.update(deltaSeconds);
    this.shards.update(deltaSeconds);
    this.waves.update(deltaSeconds);
    this.lights.update(deltaSeconds);
  }

  clear(): void {
    this.puffs.clear();
    this.chunks.clear();
    this.shards.clear();
    this.waves.clear();
    this.lights.clear();
  }

  /** Frees GPU resources; the instance must not be used afterwards. */
  dispose(): void {
    this.clear();
    this.puffs.dispose();
    this.chunks.dispose();
    this.shards.dispose();
    this.waves.dispose();
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
    this.spawnEmbers(point, inherited, countFor(10, 8, scale, 44), scale * 5 + 4, scale);
    this.spawnDust(point, inherited, countFor(6, 4, scale, 26), scale);
    this.spawnDebris(this.chunks, point, inherited, countFor(9, 9, scale, 56), scale, 1);
  }

  /**
   * A warhead going off: everything a fireball has, under a white flash
   * that for an instant outshines it, two blast rings and embers thrown
   * several times further. Unmistakably bigger than a laser kill.
   */
  private spawnBlast(point: THREE.Vector3, scale: number, inherited: THREE.Vector3): void {
    const size = scale * 1.5 + 0.6;
    this.spawnGlow(point, inherited, size * 3, size * 8, 0.22, CORE_FLASH, 2.2);
    this.spawnGlow(point, inherited, size * 2, size * 5, 0.5, CORE_FLASH, 1);
    this.spawnFireball(point, size, inherited);
    this.spawnSparks(point, inherited, countFor(40, 30, size, 160), size * 7 + 5, size);
    this.spawnEmbers(point, inherited, countFor(26, 16, size, 80), size * 9 + 8, size);
    this.waves.addInSpace(point, { radius: size * 5 + 3, seconds: 0.8, color: [3.4, 2.8, 2.0], opacity: 0.9 });
    this.waves.addInSpace(point, { radius: size * 9 + 5, seconds: 1.6, color: [1.4, 0.9, 0.5], opacity: 0.45 });
    this.lights.flash(point, 0xffe2b8, 140 + size * 150, 60 + size * 22, 0.7);
  }

  /** Slow-fading sparks that fly far: the streaks of light that hang in the sky after a blast. */
  private spawnEmbers(point: THREE.Vector3, inherited: THREE.Vector3, count: number, speed: number, scale: number, up?: THREE.Vector3): void {
    for (let index = 0; index < count; index += 1) {
      this.aim(point, inherited, scale * 0.3, speed * between(0.35, 1), up);
      this.puffs.spawn({
        position: this.position,
        velocity: this.velocity,
        drag: 0.45,
        lifetime: between(1.6, 3.4),
        startSize: between(0.09, 0.16) + scale * 0.06,
        endSize: 0.04,
        ramp: EMBER,
        cloudiness: 0,
        brightness: between(0.6, 1.1),
        twinkle: between(0, 2),
      });
    }
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
}
