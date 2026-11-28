import * as THREE from 'three';
import { craterAngularRadius } from '../logic/planetDamage';
import { createConeGradientTexture, getGlowTexture } from '../scene/glowTexture';
import type { Asteroid } from './asteroidField';
import { THREAT_COLORS, threatTone } from './threatTone';

const MAX_TRACKED = 96;
/** The speed trail shows where the asteroid was this many seconds ago. */
const TRAIL_SECONDS = 6;
/** Paths that miss Earth are drawn this far ahead. */
const MISS_PATH_SECONDS = 12;
const VERTICES_PER_ASTEROID = 4;

interface FireTail {
  cone: THREE.Mesh;
  glow: THREE.Sprite;
}

/**
 * World-space cues that make speed, direction and danger readable from far
 * away: a fading speed trail behind every asteroid, a path line to its
 * impact point, a pulsing marker where it will land, a glint so distant
 * rocks stay visible, and fire once it enters the atmosphere.
 */
export class ThreatVisuals {
  readonly group = new THREE.Group();
  private readonly lines: THREE.LineSegments;
  private readonly linePositions: Float32Array;
  private readonly lineColors: Float32Array;
  private readonly glints: THREE.Points;
  private readonly glintPositions: Float32Array;
  private readonly glintColors: Float32Array;
  private readonly markers = new Map<number, THREE.Mesh>();
  private readonly tails = new Map<number, FireTail>();
  private readonly markerGeometry = new THREE.RingGeometry(0.7, 1, 48);
  private readonly tailGeometry: THREE.ConeGeometry;
  private readonly tailTexture = createConeGradientTexture([
    [0, 'rgba(255,255,235,1)'],
    [0.15, 'rgba(255,190,90,0.9)'],
    [0.5, 'rgba(255,80,20,0.45)'],
    [1, 'rgba(60,10,0,0)'],
  ]);
  private elapsed = 0;
  private readonly color = new THREE.Color();
  private readonly scratch = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(private readonly planetRadius: number) {
    this.linePositions = new Float32Array(MAX_TRACKED * VERTICES_PER_ASTEROID * 3);
    this.lineColors = new Float32Array(MAX_TRACKED * VERTICES_PER_ASTEROID * 3);
    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute('position', new THREE.BufferAttribute(this.linePositions, 3).setUsage(THREE.DynamicDrawUsage));
    lineGeometry.setAttribute('color', new THREE.BufferAttribute(this.lineColors, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(
      lineGeometry,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.lines.frustumCulled = false;
    this.group.add(this.lines);

    this.glintPositions = new Float32Array(MAX_TRACKED * 3);
    this.glintColors = new Float32Array(MAX_TRACKED * 3);
    const glintGeometry = new THREE.BufferGeometry();
    glintGeometry.setAttribute('position', new THREE.BufferAttribute(this.glintPositions, 3).setUsage(THREE.DynamicDrawUsage));
    glintGeometry.setAttribute('color', new THREE.BufferAttribute(this.glintColors, 3).setUsage(THREE.DynamicDrawUsage));
    this.glints = new THREE.Points(
      glintGeometry,
      new THREE.PointsMaterial({
        size: 7,
        sizeAttenuation: false,
        vertexColors: true,
        map: getGlowTexture(),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.glints.frustumCulled = false;
    this.group.add(this.glints);

    // Base at the origin, tip at +Y; turned so the tip trails behind the rock.
    this.tailGeometry = new THREE.ConeGeometry(1, 1, 20, 1, true);
    this.tailGeometry.translate(0, 0.5, 0);
  }

  /** `ranked` is every asteroid, most urgent first. */
  update(deltaSeconds: number, ranked: readonly Asteroid[]): void {
    this.elapsed += deltaSeconds;
    const count = Math.min(ranked.length, MAX_TRACKED);
    const seen = new Set<number>();
    for (let index = 0; index < count; index += 1) {
      const asteroid = ranked[index];
      seen.add(asteroid.id);
      const tone = threatTone(asteroid, index);
      this.color.set(THREAT_COLORS[tone]);
      this.writeLines(index, asteroid);
      this.writeGlint(index, asteroid);
      this.updateMarker(asteroid, tone === 'miss');
      this.updateFireTail(asteroid);
    }
    this.lines.geometry.setDrawRange(0, count * VERTICES_PER_ASTEROID);
    this.glints.geometry.setDrawRange(0, count);
    for (const attribute of [
      this.lines.geometry.getAttribute('position'),
      this.lines.geometry.getAttribute('color'),
      this.glints.geometry.getAttribute('position'),
      this.glints.geometry.getAttribute('color'),
    ]) {
      attribute.needsUpdate = true;
    }
    this.removeStale(seen);
  }

  clear(): void {
    this.removeStale(new Set());
    this.lines.geometry.setDrawRange(0, 0);
    this.glints.geometry.setDrawRange(0, 0);
  }

  private writeLines(index: number, asteroid: Asteroid): void {
    const position = asteroid.mesh.position;
    const velocity = asteroid.velocity;
    const base = index * VERTICES_PER_ASTEROID;
    const trailEnd = this.scratch.copy(position).addScaledVector(velocity, -TRAIL_SECONDS);
    // Speed trail: dust-coloured at the rock, fading to nothing behind it.
    this.setVertex(base, position, 0.32, 0.36, 0.42);
    this.setVertex(base + 1, trailEnd, 0, 0, 0);

    const seconds = asteroid.timeToImpact ?? MISS_PATH_SECONDS;
    const pathEnd = this.scratch.copy(position).addScaledVector(velocity, seconds);
    const strength = asteroid.timeToImpact === null ? 0.18 : 0.55;
    this.setVertex(base + 2, position, this.color.r * strength, this.color.g * strength, this.color.b * strength);
    this.setVertex(base + 3, pathEnd, this.color.r * strength * 0.35, this.color.g * strength * 0.35, this.color.b * strength * 0.35);
  }

  private setVertex(index: number, position: THREE.Vector3, r: number, g: number, b: number): void {
    this.linePositions.set([position.x, position.y, position.z], index * 3);
    this.lineColors.set([r, g, b], index * 3);
  }

  private writeGlint(index: number, asteroid: Asteroid): void {
    const position = asteroid.mesh.position;
    this.glintPositions.set([position.x, position.y, position.z], index * 3);
    const brightness = 0.9 + asteroid.radius * 0.15;
    this.glintColors.set([this.color.r * brightness, this.color.g * brightness, this.color.b * brightness], index * 3);
  }

  private updateMarker(asteroid: Asteroid, misses: boolean): void {
    let marker = this.markers.get(asteroid.id);
    if (misses || asteroid.timeToImpact === null) {
      if (marker) {
        this.removeMarker(asteroid.id, marker);
      }
      return;
    }
    if (!marker) {
      marker = new THREE.Mesh(
        this.markerGeometry,
        new THREE.MeshBasicMaterial({
          transparent: true,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      this.markers.set(asteroid.id, marker);
      this.group.add(marker);
    }
    const impact = this.scratch.copy(asteroid.mesh.position).addScaledVector(asteroid.velocity, asteroid.timeToImpact);
    impact.setLength(this.planetRadius * 1.003);
    marker.position.copy(impact);
    marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), impact.clone().normalize());
    // Rings pulse faster as impact approaches.
    const urgency = THREE.MathUtils.clamp(1 - asteroid.timeToImpact / 60, 0, 1);
    const pulse = 0.75 + 0.25 * Math.sin(this.elapsed * (3 + urgency * 9));
    marker.scale.setScalar(this.planetRadius * craterAngularRadius(asteroid.size) * 1.6 * pulse);
    const material = marker.material as THREE.MeshBasicMaterial;
    material.color.copy(this.color).multiplyScalar(1.2 + urgency * 1.5);
    material.opacity = 0.35 + urgency * 0.6;
  }

  private updateFireTail(asteroid: Asteroid): void {
    let tail = this.tails.get(asteroid.id);
    if (asteroid.entryHeat <= 0.01) {
      if (tail) {
        this.removeTail(asteroid.id, tail);
      }
      return;
    }
    if (!tail) {
      tail = {
        cone: new THREE.Mesh(
          this.tailGeometry,
          new THREE.MeshBasicMaterial({
            map: this.tailTexture,
            color: new THREE.Color(1.3, 0.62, 0.24),
            transparent: true,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }),
        ),
        glow: new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: getGlowTexture(),
            color: new THREE.Color(1.6, 0.7, 0.22),
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }),
        ),
      };
      this.tails.set(asteroid.id, tail);
      this.group.add(tail.cone, tail.glow);
    }
    const heat = asteroid.entryHeat;
    const radius = asteroid.radius;
    const direction = this.scratch.copy(asteroid.velocity).normalize();
    tail.cone.quaternion.setFromUnitVectors(this.up, direction.clone().negate());
    tail.cone.position.copy(asteroid.mesh.position).addScaledVector(direction, radius * 0.35);
    const flicker = 0.9 + Math.sin(this.elapsed * 37 + asteroid.id) * 0.06 + Math.sin(this.elapsed * 23) * 0.04;
    // A long streak of fire: the fall through the air is seen from far across the orbit.
    tail.cone.scale.set(radius * (0.85 + heat * 0.3), radius * (1.6 + heat * 7) * flicker, radius * (0.85 + heat * 0.3));
    (tail.cone.material as THREE.MeshBasicMaterial).opacity = heat * 0.75;
    tail.glow.position.copy(asteroid.mesh.position).addScaledVector(direction, radius * 0.6);
    tail.glow.scale.setScalar(radius * (1.8 + heat * 2.4));
    tail.glow.material.opacity = heat * 0.8;
  }

  private removeStale(seen: ReadonlySet<number>): void {
    for (const [id, marker] of this.markers) {
      if (!seen.has(id)) {
        this.removeMarker(id, marker);
      }
    }
    for (const [id, tail] of this.tails) {
      if (!seen.has(id)) {
        this.removeTail(id, tail);
      }
    }
  }

  private removeMarker(id: number, marker: THREE.Mesh): void {
    this.group.remove(marker);
    (marker.material as THREE.Material).dispose();
    this.markers.delete(id);
  }

  private removeTail(id: number, tail: FireTail): void {
    this.group.remove(tail.cone, tail.glow);
    (tail.cone.material as THREE.Material).dispose();
    tail.glow.material.dispose();
    this.tails.delete(id);
  }
}
