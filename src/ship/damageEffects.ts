import * as THREE from 'three';
import { getGlowTexture } from '../scene/glowTexture';

/** Hull levels where the damage starts to show. */
const SPARKS_BELOW = 60;
const SMOKE_BELOW = 35;
const VENT_BELOW = 18;
const POOL = 90;

interface Particle {
  sprite: THREE.Sprite;
  velocity: THREE.Vector3;
  age: number;
  life: number;
  kind: 'spark' | 'smoke' | 'vent';
}

/**
 * A damaged ship looks damaged: below 60% hull it throws sparks from torn
 * panels, below 35% it trails smoke, and when critical it vents gas in
 * bursts. Particles live in world space so they stream behind the ship.
 */
export class DamageEffects {
  readonly group = new THREE.Group();
  private readonly particles: Particle[] = [];
  private next = 0;
  private sparkTimer = 0;
  private smokeTimer = 0;
  private ventTimer = 0;
  private readonly scratch = new THREE.Vector3();

  constructor(private readonly bounds: THREE.Box3) {
    const texture = getGlowTexture();
    for (let index = 0; index < POOL; index += 1) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      sprite.visible = false;
      this.group.add(sprite);
      this.particles.push({ sprite, velocity: new THREE.Vector3(), age: 0, life: 1, kind: 'spark' });
    }
  }

  /** `hull` in percent; `ship` is the hull's world object; `velocity` its motion. */
  update(deltaSeconds: number, hull: number, ship: THREE.Object3D, velocity: THREE.Vector3, active: boolean): void {
    if (active && hull < SPARKS_BELOW) {
      this.sparkTimer -= deltaSeconds;
      if (this.sparkTimer <= 0) {
        // Sparks come in short crackles, more often the worse the damage.
        this.sparkTimer = 0.15 + Math.random() * (hull / SPARKS_BELOW) * 1.4;
        const burst = 3 + Math.floor(Math.random() * 4);
        const point = this.hullPoint(ship);
        for (let index = 0; index < burst; index += 1) {
          const out = this.scratch.randomDirection().multiplyScalar(1.5 + Math.random() * 2.5);
          this.emit('spark', point, out.add(velocity), 0.25 + Math.random() * 0.3);
        }
      }
    }
    if (active && hull < SMOKE_BELOW) {
      this.smokeTimer -= deltaSeconds;
      if (this.smokeTimer <= 0) {
        this.smokeTimer = 0.05 + (hull / SMOKE_BELOW) * 0.12;
        const drift = this.scratch.randomDirection().multiplyScalar(0.3).add(velocity.clone().multiplyScalar(0.85));
        this.emit('smoke', this.hullPoint(ship), drift, 1.4 + Math.random());
      }
    }
    if (active && hull < VENT_BELOW) {
      this.ventTimer -= deltaSeconds;
      if (this.ventTimer <= 0) {
        this.ventTimer = 0.9 + Math.random() * 1.6;
        const point = this.hullPoint(ship);
        const jet = point.clone().sub(ship.position).normalize().multiplyScalar(5);
        for (let index = 0; index < 8; index += 1) {
          const spread = this.scratch.randomDirection().multiplyScalar(0.6);
          this.emit('vent', point, jet.clone().add(spread).add(velocity), 0.5 + index * 0.05);
        }
      }
    }
    for (const particle of this.particles) {
      if (!particle.sprite.visible) {
        continue;
      }
      particle.age += deltaSeconds;
      const t = particle.age / particle.life;
      if (t >= 1) {
        particle.sprite.visible = false;
        continue;
      }
      particle.sprite.position.addScaledVector(particle.velocity, deltaSeconds);
      const material = particle.sprite.material;
      if (particle.kind === 'spark') {
        material.opacity = 1 - t;
        particle.sprite.scale.setScalar(0.07 * (1 - t * 0.5));
      } else if (particle.kind === 'smoke') {
        material.opacity = 0.35 * (1 - t) * Math.min(1, t * 6);
        particle.sprite.scale.setScalar(0.18 + t * 0.7);
      } else {
        material.opacity = 0.5 * (1 - t);
        particle.sprite.scale.setScalar(0.12 + t * 0.5);
      }
    }
  }

  clear(): void {
    for (const particle of this.particles) {
      particle.sprite.visible = false;
    }
  }

  private emit(kind: Particle['kind'], position: THREE.Vector3, velocity: THREE.Vector3, life: number): void {
    const particle = this.particles[this.next];
    this.next = (this.next + 1) % this.particles.length;
    particle.kind = kind;
    particle.age = 0;
    particle.life = life;
    particle.velocity.copy(velocity);
    particle.sprite.position.copy(position);
    particle.sprite.visible = true;
    const material = particle.sprite.material;
    // Smoke is dark, so it is drawn normally rather than added as light.
    material.blending = kind === 'smoke' ? THREE.NormalBlending : THREE.AdditiveBlending;
    material.color.set(kind === 'spark' ? 0xffc46b : kind === 'smoke' ? 0x2a2a2e : 0xcfe8ff);
    material.needsUpdate = true;
  }

  /** A random point on the hull's surface box, in world space. */
  private hullPoint(ship: THREE.Object3D): THREE.Vector3 {
    const { min, max } = this.bounds;
    const local = new THREE.Vector3(
      THREE.MathUtils.lerp(min.x, max.x, 0.2 + Math.random() * 0.6),
      THREE.MathUtils.lerp(min.y, max.y, 0.4 + Math.random() * 0.6),
      THREE.MathUtils.lerp(min.z, max.z, 0.15 + Math.random() * 0.7),
    );
    return ship.localToWorld(local);
  }
}
