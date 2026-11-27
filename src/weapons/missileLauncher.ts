import * as THREE from 'three';
import type { Asteroid } from '../asteroids/asteroidField';
import { getGlowTexture } from '../scene/glowTexture';
import { segmentHitsSphere } from './collision';
import type { WeaponHit } from './laserCannon';

export const MISSILE_CAPACITY = 8;
const BASE_DAMAGE = 140;
const LAUNCH_SPEED = 12;
const MAX_SPEED = 75;
const ACCELERATION = 55;
const TURN_RATE = 2.8;
const LIFETIME = 7;
export const LOCK_RANGE = 170;
const LOCK_CONE = THREE.MathUtils.degToRad(14);
const FIRE_INTERVAL = 0.45;

interface Missile {
  group: THREE.Group;
  velocity: THREE.Vector3;
  target: Asteroid | null;
  age: number;
}

/**
 * Limited heavy missiles that home on the locked asteroid. They are the only
 * effective weapon against iron and they destroy large rocks without
 * splitting them. Reloading will come from the space base in a later version.
 */
export class MissileLauncher {
  readonly group = new THREE.Group();
  ammunition = MISSILE_CAPACITY;
  lockedTarget: Asteroid | null = null;
  private readonly missiles: Missile[] = [];
  private cooldown = 0;
  private readonly bodyGeometry = new THREE.CylinderGeometry(0.035, 0.045, 0.45, 8);
  private readonly bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xd8d8d8, metalness: 0.5, roughness: 0.4 });
  private readonly flameMaterial = new THREE.SpriteMaterial({
    map: getGlowTexture(),
    color: new THREE.Color(6, 3, 1.2),
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  private readonly previous = new THREE.Vector3();
  private readonly scratch = new THREE.Vector3();

  constructor() {
    this.bodyGeometry.rotateX(Math.PI / 2);
  }

  /** Picks the asteroid closest to the aiming line, within range and cone. */
  updateLock(ship: THREE.Object3D, asteroids: readonly Asteroid[]): Asteroid | null {
    const forward = this.scratch.set(0, 0, -1).applyQuaternion(ship.quaternion);
    let best: Asteroid | null = null;
    let bestAngle = LOCK_CONE;
    for (const asteroid of asteroids) {
      const offset = asteroid.mesh.position.clone().sub(ship.position);
      const distance = offset.length();
      if (distance > LOCK_RANGE + asteroid.radius) {
        continue;
      }
      // Larger rocks are easier to lock: widen the cone by their apparent size.
      const angle = forward.angleTo(offset) - Math.atan2(asteroid.radius, distance);
      if (angle < bestAngle) {
        bestAngle = angle;
        best = asteroid;
      }
    }
    this.lockedTarget = best;
    return best;
  }

  /** Returns true when a missile was launched. */
  tryFire(ship: THREE.Object3D, shipVelocity: THREE.Vector3): boolean {
    if (this.ammunition <= 0 || this.cooldown > 0) {
      return false;
    }
    const group = new THREE.Group();
    group.add(new THREE.Mesh(this.bodyGeometry, this.bodyMaterial));
    const flame = new THREE.Sprite(this.flameMaterial);
    flame.scale.setScalar(0.5);
    flame.position.z = 0.3;
    group.add(flame);

    group.position.copy(new THREE.Vector3(0, -0.18, -0.1).applyMatrix4(ship.matrixWorld));
    group.quaternion.copy(ship.quaternion);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(ship.quaternion);
    this.group.add(group);
    this.missiles.push({
      group,
      velocity: forward.multiplyScalar(LAUNCH_SPEED).add(shipVelocity),
      target: this.lockedTarget,
      age: 0,
    });
    this.ammunition -= 1;
    this.cooldown = FIRE_INTERVAL;
    return true;
  }

  update(deltaSeconds: number, asteroids: readonly Asteroid[], planetRadius: number): WeaponHit[] {
    this.cooldown = Math.max(0, this.cooldown - deltaSeconds);
    const hits: WeaponHit[] = [];
    for (const missile of [...this.missiles]) {
      missile.age += deltaSeconds;
      if (missile.target && !missile.target.alive) {
        missile.target = null;
      }
      this.steer(missile, deltaSeconds);
      this.previous.copy(missile.group.position);
      missile.group.position.addScaledVector(missile.velocity, deltaSeconds);

      const hit = this.findHit(missile, asteroids);
      if (hit) {
        hits.push(hit);
        this.remove(missile);
      } else if (missile.age > LIFETIME || missile.group.position.length() < planetRadius) {
        this.remove(missile);
      }
    }
    return hits;
  }

  /** Adds missiles up to capacity; returns how many were actually loaded. */
  resupply(count: number): number {
    const loaded = Math.min(count, MISSILE_CAPACITY - this.ammunition);
    this.ammunition += loaded;
    return loaded;
  }

  reset(): void {
    for (const missile of [...this.missiles]) {
      this.remove(missile);
    }
    this.ammunition = MISSILE_CAPACITY;
    this.lockedTarget = null;
    this.cooldown = 0;
  }

  private steer(missile: Missile, deltaSeconds: number): void {
    const heading = missile.velocity.clone().normalize();
    if (missile.target) {
      const toTarget = this.scratch.copy(missile.target.mesh.position).sub(missile.group.position);
      // Lead the target by the time the missile needs to get there.
      const leadTime = toTarget.length() / Math.max(missile.velocity.length(), LAUNCH_SPEED);
      toTarget.addScaledVector(missile.target.velocity, leadTime).normalize();
      const angle = heading.angleTo(toTarget);
      if (angle > 1e-4) {
        const step = Math.min(1, (TURN_RATE * deltaSeconds) / angle);
        heading.lerp(toTarget, step).normalize();
      }
    }
    const speed = Math.min(MAX_SPEED, missile.velocity.length() + ACCELERATION * deltaSeconds);
    missile.velocity.copy(heading).multiplyScalar(speed);
    missile.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), heading);
  }

  private findHit(missile: Missile, asteroids: readonly Asteroid[]): WeaponHit | null {
    for (const asteroid of asteroids) {
      // A small proximity fuse makes near misses count.
      const point = segmentHitsSphere(this.previous, missile.group.position, asteroid.mesh.position, asteroid.radius + 0.35);
      if (point) {
        return { asteroid, baseDamage: BASE_DAMAGE, point, range: 0 };
      }
    }
    return null;
  }

  private remove(missile: Missile): void {
    this.group.remove(missile.group);
    const index = this.missiles.indexOf(missile);
    if (index !== -1) {
      this.missiles.splice(index, 1);
    }
  }
}
