import * as THREE from 'three';
import { getGlowTexture } from '../scene/glowTexture';

/** Seconds a launch takes from the pad to orbit insertion. */
const LAUNCH_SECONDS = 45;
const TRAIL_POOL = 70;
const METEOR_POOL = 36;

interface Launch {
  /** Pad direction in the planet's own frame, and the way it turns towards orbit. */
  site: THREE.Vector3;
  east: THREE.Vector3;
  age: number;
  rocket: THREE.Group;
  flame: THREE.Sprite;
  trailTimer: number;
}

interface Meteor {
  line: THREE.Line;
  start: THREE.Vector3;
  velocity: THREE.Vector3;
  age: number;
  life: number;
}

/**
 * The orbit is busy without the pilot: rockets climb from Earth's launch
 * sites leaving glowing trails, meteors streak and burn up over the night
 * side during a shower, and spacewalkers work outside Halo with their
 * helmet lamps on. All of it is scenery, cheap to draw.
 */
export class AmbientTraffic {
  /** Lives in the planet's turning frame, so launch trails turn with the ground. */
  readonly surfaceGroup = new THREE.Group();
  /** Lives in world space. */
  readonly group = new THREE.Group();
  private readonly launches: Launch[] = [];
  private readonly trail: { sprite: THREE.Sprite; age: number }[] = [];
  private nextTrail = 0;
  private readonly meteors: Meteor[] = [];
  private meteorTimer = 0;
  private walkers: THREE.Group[] = [];
  private time = 0;

  constructor(private readonly planetRadius: number) {
    const glow = getGlowTexture();
    for (let index = 0; index < TRAIL_POOL; index += 1) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xd9d4cc, transparent: true, depthWrite: false, opacity: 0 }));
      sprite.visible = false;
      this.surfaceGroup.add(sprite);
      this.trail.push({ sprite, age: 0 });
    }
    for (let index = 0; index < METEOR_POOL; index += 1) {
      const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xcfffe6, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      line.visible = false;
      line.frustumCulled = false;
      this.group.add(line);
      this.meteors.push({ line, start: new THREE.Vector3(), velocity: new THREE.Vector3(), age: 0, life: 1 });
    }
  }

  /** A launch from a pad at `site` (unit vector in the planet's frame). */
  launch(site: THREE.Vector3): void {
    const north = new THREE.Vector3(0, 1, 0);
    const east = north.clone().cross(site).normalize();
    if (east.lengthSq() < 1e-6) {
      east.set(1, 0, 0);
    }
    const rocket = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.6, 10), new THREE.MeshStandardMaterial({ color: 0xe8e8e2, metalness: 0.3, roughness: 0.5 }));
    const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: getGlowTexture(), color: 0xffb066, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    flame.position.y = -0.45;
    flame.scale.setScalar(0.9);
    rocket.add(body, flame);
    this.surfaceGroup.add(rocket);
    this.launches.push({ site: site.clone().normalize(), east, age: 0, rocket, flame, trailTimer: 0 });
  }

  /** Spacewalkers around a station's port (`anchor`): suits drifting slowly along the hull. */
  addSpacewalkers(station: THREE.Object3D, count = 2): void {
    const suit = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, metalness: 0.1, roughness: 0.7 });
    const visor = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffc36b, emissiveIntensity: 0.8, metalness: 0.9, roughness: 0.1 });
    for (let index = 0; index < count; index += 1) {
      const walker = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.22, 4, 8), suit);
      const pack = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.2, 0.1), suit);
      pack.position.set(0, 0.04, -0.12);
      const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), visor);
      helmet.position.y = 0.27;
      const lamp = new THREE.Sprite(new THREE.SpriteMaterial({ map: getGlowTexture(), color: 0xfff1cc, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      lamp.position.set(0, 0.3, 0.12);
      lamp.scale.setScalar(0.35);
      walker.add(body, pack, helmet, lamp);
      walker.userData.phase = index * 2.4;
      walker.userData.radius = 0.9 + index * 0.55;
      // Walkers are added to the station model, which is about forty times smaller than world units.
      walker.scale.setScalar(1 / Math.max(station.getWorldScale(new THREE.Vector3()).x, 1e-3));
      station.add(walker);
      this.walkers.push(walker);
    }
  }

  /** `night` is a unit vector pointing to the middle of the night side, in world space. */
  update(deltaSeconds: number, showerActive: boolean, night: THREE.Vector3): void {
    this.time += deltaSeconds;
    this.updateLaunches(deltaSeconds);
    this.updateTrail(deltaSeconds);
    if (showerActive) {
      this.meteorTimer -= deltaSeconds;
      while (this.meteorTimer <= 0) {
        this.meteorTimer += 0.08 + Math.random() * 0.18;
        this.spawnMeteor(night);
      }
    }
    this.updateMeteors(deltaSeconds);
    for (const walker of this.walkers) {
      const phase = this.time * 0.12 + (walker.userData.phase as number);
      const radius = walker.userData.radius as number;
      const scale = walker.scale.x;
      walker.position.set(Math.cos(phase) * radius * scale, Math.sin(phase * 0.7) * 0.35 * scale, Math.sin(phase) * radius * scale);
      walker.rotation.set(Math.sin(phase * 1.3) * 0.5, phase, Math.cos(phase) * 0.4);
    }
  }

  clear(): void {
    for (const launch of this.launches) {
      this.surfaceGroup.remove(launch.rocket);
    }
    this.launches.length = 0;
    for (const piece of this.trail) {
      piece.sprite.visible = false;
    }
    for (const meteor of this.meteors) {
      meteor.line.visible = false;
    }
  }

  private updateLaunches(deltaSeconds: number): void {
    for (const launch of [...this.launches]) {
      launch.age += deltaSeconds;
      const t = launch.age / LAUNCH_SECONDS;
      if (t >= 1) {
        this.surfaceGroup.remove(launch.rocket);
        this.launches.splice(this.launches.indexOf(launch), 1);
        continue;
      }
      const position = this.pathPoint(launch, t);
      const ahead = this.pathPoint(launch, Math.min(1, t + 0.01));
      launch.rocket.position.copy(position);
      launch.rocket.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), ahead.sub(position).normalize());
      // The flame grows as the air thins, then the engine cuts off at the end.
      launch.flame.scale.setScalar(0.8 + t * 2.2);
      launch.flame.material.opacity = t > 0.92 ? (1 - t) / 0.08 : 1;
      launch.trailTimer -= deltaSeconds;
      if (launch.trailTimer <= 0 && t < 0.9) {
        launch.trailTimer = 0.35;
        const piece = this.trail[this.nextTrail];
        this.nextTrail = (this.nextTrail + 1) % this.trail.length;
        piece.age = 0;
        piece.sprite.position.copy(position);
        piece.sprite.visible = true;
      }
    }
  }

  /** Straight up from the pad, then pitching over towards the east into orbit. */
  private pathPoint(launch: Launch, t: number): THREE.Vector3 {
    const altitude = 11 * Math.pow(t, 1.4);
    const downrange = 0.32 * t * t;
    const direction = launch.site.clone().multiplyScalar(Math.cos(downrange)).addScaledVector(launch.east, Math.sin(downrange));
    return direction.multiplyScalar(this.planetRadius + 0.1 + altitude);
  }

  private updateTrail(deltaSeconds: number): void {
    for (const piece of this.trail) {
      if (!piece.sprite.visible) {
        continue;
      }
      piece.age += deltaSeconds;
      const t = piece.age / 9;
      if (t >= 1) {
        piece.sprite.visible = false;
        continue;
      }
      // Exhaust spreads and fades in the upper air.
      piece.sprite.scale.setScalar(0.4 + t * 2.4);
      piece.sprite.material.opacity = 0.32 * (1 - t);
    }
  }

  private spawnMeteor(night: THREE.Vector3): void {
    const meteor = this.meteors.find((candidate) => !candidate.line.visible);
    if (!meteor) {
      return;
    }
    // Enter high over the night side, slanting down through the atmosphere.
    const spread = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(1.3);
    const direction = night.clone().add(spread).normalize();
    meteor.start.copy(direction).multiplyScalar(this.planetRadius + 3.2 + Math.random() * 1.5);
    const tangent = new THREE.Vector3(0.3, 1, 0.2).cross(direction).normalize();
    meteor.velocity.copy(tangent).multiplyScalar(14 + Math.random() * 10).addScaledVector(direction, -4);
    meteor.age = 0;
    meteor.life = 0.5 + Math.random() * 0.7;
    meteor.line.visible = true;
  }

  private updateMeteors(deltaSeconds: number): void {
    for (const meteor of this.meteors) {
      if (!meteor.line.visible) {
        continue;
      }
      meteor.age += deltaSeconds;
      const t = meteor.age / meteor.life;
      if (t >= 1) {
        meteor.line.visible = false;
        continue;
      }
      const head = meteor.start.clone().addScaledVector(meteor.velocity, meteor.age);
      const tail = head.clone().addScaledVector(meteor.velocity, -0.12 - t * 0.1);
      const positions = meteor.line.geometry.attributes.position as THREE.BufferAttribute;
      positions.setXYZ(0, tail.x, tail.y, tail.z);
      positions.setXYZ(1, head.x, head.y, head.z);
      positions.needsUpdate = true;
      (meteor.line.material as THREE.LineBasicMaterial).opacity = Math.sin(Math.PI * t);
    }
  }
}
