import * as THREE from 'three';
import type { Asteroid } from '../asteroids/asteroidField';
import { LASER_RANGE } from '../logic/ballistics';
import { segmentHitsSphere } from './collision';

export interface WeaponHit {
  asteroid: Asteroid;
  /** Base damage before range and the asteroid's material are taken into account. */
  baseDamage: number;
  point: THREE.Vector3;
  /** Distance travelled from the gun, for laser falloff. */
  range: number;
  /** Unit direction the shot was travelling, for the push it gives. */
  direction: THREE.Vector3;
}

export const BOLT_SPEED = 130;
/** Bolts dissipate at the laser's maximum range. */
const BOLT_LIFETIME = LASER_RANGE.maximum / BOLT_SPEED;
const FIRE_INTERVAL = 1 / 9;
const BASE_DAMAGE = 10;
const HEAT_PER_SHOT = 6.5;
const COOLING_PER_SECOND = 32;
/** After overheating, firing resumes only once heat falls below this. */
const OVERHEAT_RECOVERY = 35;
/** Bolts from both wing guns converge this far ahead of the nose. */
const CONVERGENCE_DISTANCE = 24;
const POOL_SIZE = 64;

interface Bolt {
  mesh: THREE.Mesh;
  origin: THREE.Vector3;
  velocity: THREE.Vector3;
  age: number;
  active: boolean;
}

/**
 * Twin rapid-fire laser. Unlimited ammunition, limited by heat: holding the
 * trigger too long overheats it, which forces short controlled bursts.
 */
export class LaserCannon {
  readonly group = new THREE.Group();
  heat = 0;
  /** Set from the loadout; upgrades raise these. */
  damageMultiplier = 1;
  coolingMultiplier = 1;
  overheated = false;
  private readonly bolts: Bolt[] = [];
  private cooldown = 0;
  private nextGun = 0;
  private readonly previous = new THREE.Vector3();
  private readonly scratch = new THREE.Vector3();

  constructor() {
    const geometry = new THREE.CylinderGeometry(0.045, 0.045, 3, 6, 1, true);
    geometry.rotateX(Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(7, 1.1, 0.7),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    for (let index = 0; index < POOL_SIZE; index += 1) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      this.group.add(mesh);
      this.bolts.push({ mesh, origin: new THREE.Vector3(), velocity: new THREE.Vector3(), age: 0, active: false });
    }
  }

  /**
   * Fires if the trigger is held and the gun is ready. Returns true when a
   * bolt left the gun, so the caller can play a sound.
   */
  tryFire(
    deltaSeconds: number,
    triggerHeld: boolean,
    ship: THREE.Object3D,
    shipVelocity: THREE.Vector3,
    gunPorts: readonly THREE.Vector3[],
  ): boolean {
    this.cooldown = Math.max(0, this.cooldown - deltaSeconds);
    this.heat = Math.max(0, this.heat - COOLING_PER_SECOND * this.coolingMultiplier * deltaSeconds);
    if (this.overheated && this.heat < OVERHEAT_RECOVERY) {
      this.overheated = false;
    }
    if (!triggerHeld || this.overheated || this.cooldown > 0) {
      return false;
    }
    const bolt = this.bolts.find((candidate) => !candidate.active);
    if (!bolt) {
      return false;
    }

    const port = gunPorts[this.nextGun % gunPorts.length];
    this.nextGun += 1;
    const origin = this.scratch.copy(port).applyMatrix4(ship.matrixWorld);
    const target = new THREE.Vector3(0, 0, -CONVERGENCE_DISTANCE).applyMatrix4(ship.matrixWorld);
    const direction = target.sub(origin).normalize();

    bolt.mesh.position.copy(origin);
    bolt.origin.copy(origin);
    bolt.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), direction);
    bolt.velocity.copy(direction).multiplyScalar(BOLT_SPEED).add(shipVelocity);
    bolt.age = 0;
    bolt.active = true;
    bolt.mesh.visible = true;

    this.cooldown = FIRE_INTERVAL;
    this.heat += HEAT_PER_SHOT;
    if (this.heat >= 100) {
      this.heat = 100;
      this.overheated = true;
    }
    return true;
  }

  /** Moves bolts and returns what they hit this frame. */
  update(deltaSeconds: number, asteroids: readonly Asteroid[], planetRadius: number): WeaponHit[] {
    const hits: WeaponHit[] = [];
    for (const bolt of this.bolts) {
      if (!bolt.active) {
        continue;
      }
      bolt.age += deltaSeconds;
      this.previous.copy(bolt.mesh.position);
      bolt.mesh.position.addScaledVector(bolt.velocity, deltaSeconds);
      if (bolt.age > BOLT_LIFETIME || bolt.mesh.position.length() < planetRadius) {
        this.deactivate(bolt);
        continue;
      }
      // Past optimal range the bolt visibly thins out as it loses energy.
      const travelled = bolt.age * BOLT_SPEED;
      const strength = travelled <= LASER_RANGE.optimal ? 1 : 1 - (travelled - LASER_RANGE.optimal) / (LASER_RANGE.maximum - LASER_RANGE.optimal);
      bolt.mesh.scale.set(0.4 + strength * 0.6, 0.4 + strength * 0.6, 0.5 + strength * 0.5);
      for (const asteroid of asteroids) {
        const hitPoint = segmentHitsSphere(this.previous, bolt.mesh.position, asteroid.mesh.position, asteroid.radius);
        if (hitPoint) {
          hits.push({ asteroid, baseDamage: BASE_DAMAGE * this.damageMultiplier, point: hitPoint, range: hitPoint.distanceTo(bolt.origin), direction: bolt.velocity.clone().normalize() });
          this.deactivate(bolt);
          break;
        }
      }
    }
    return hits;
  }

  reset(): void {
    for (const bolt of this.bolts) {
      this.deactivate(bolt);
    }
    this.heat = 0;
    this.overheated = false;
    this.cooldown = 0;
  }

  private deactivate(bolt: Bolt): void {
    bolt.active = false;
    bolt.mesh.visible = false;
  }
}
