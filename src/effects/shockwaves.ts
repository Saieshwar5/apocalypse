import * as THREE from 'three';

interface Wave {
  mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  age: number;
  lifetime: number;
  maxRadius: number;
  peakOpacity: number;
  /** Rings in space turn to face the camera; rings on the ground follow the planet's curve. */
  surface: { up: THREE.Vector3; planetRadius: number } | null;
}

const MAX_WAVES = 24;

/**
 * A thin ring that is bright at its leading edge and fades away behind it.
 * The rings are drawn as added light, so a black vertex is simply clear.
 */
function softRing(): THREE.RingGeometry {
  const geometry = new THREE.RingGeometry(0.88, 1, 96, 3);
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  for (let index = 0; index < position.count; index += 1) {
    const radius = Math.hypot(position.getX(index), position.getY(index));
    // Radial rows at 0.88, 0.92, 0.96 and 1: dark, faint, bright, dark.
    const row = Math.round((radius - 0.88) / 0.04);
    const light = [0, 0.18, 1, 0][row] ?? 0;
    colors.set([light, light, light], index * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}
const FACING = new THREE.Vector3(0, 0, 1);

export interface WaveOptions {
  /** Final radius in world units. */
  radius: number;
  seconds: number;
  /** RGB above 1 blooms. */
  color: [number, number, number];
  opacity?: number;
}

/**
 * Expanding rings of light: the blast wave of an explosion in space (a ring
 * that always faces the camera) and the shock front of an impact spreading
 * over the planet (a ring that hugs the curved surface as it grows).
 */
export class Shockwaves {
  readonly group = new THREE.Group();
  /** Rings in space turn to face this camera. */
  camera: THREE.Camera | null = null;
  private readonly waves: Wave[] = [];
  private readonly geometry = softRing();

  /** A blast ring in open space, centred on `point`. */
  addInSpace(point: THREE.Vector3, options: WaveOptions): void {
    const wave = this.create(options, null);
    wave.mesh.position.copy(point);
  }

  /** A shock front on the ground around `point`, which lies on the planet's surface. */
  addOnSurface(point: THREE.Vector3, options: WaveOptions): void {
    const planetRadius = point.length();
    const up = point.clone().normalize();
    // Past about a third of the way round, the ring would hide behind the horizon anyway.
    const wave = this.create({ ...options, radius: Math.min(options.radius, planetRadius * 0.62) }, { up, planetRadius });
    wave.mesh.quaternion.setFromUnitVectors(FACING, up);
    wave.mesh.position.copy(point).multiplyScalar(1.004);
  }

  update(deltaSeconds: number): void {
    for (let index = this.waves.length - 1; index >= 0; index -= 1) {
      const wave = this.waves[index];
      wave.age += deltaSeconds;
      const t = wave.age / wave.lifetime;
      if (t >= 1) {
        this.remove(index);
        continue;
      }
      // Fast at first, slowing as it spreads, like a real blast front.
      const radius = wave.maxRadius * Math.sqrt(t);
      wave.mesh.scale.setScalar(Math.max(0.001, radius));
      wave.mesh.material.opacity = wave.peakOpacity * (1 - t) * (1 - t);
      if (wave.surface) {
        // A circle of this radius on the sphere sits lower than the impact point.
        const height = Math.sqrt(Math.max(0, wave.surface.planetRadius ** 2 - radius ** 2));
        wave.mesh.position.copy(wave.surface.up).multiplyScalar(height * 1.006);
      } else if (this.camera) {
        wave.mesh.quaternion.copy(this.camera.quaternion);
      }
    }
  }

  clear(): void {
    for (let index = this.waves.length - 1; index >= 0; index -= 1) {
      this.remove(index);
    }
  }

  dispose(): void {
    this.clear();
    this.geometry.dispose();
  }

  private create(options: WaveOptions, surface: Wave['surface']): Wave {
    if (this.waves.length >= MAX_WAVES) {
      this.remove(0);
    }
    const mesh = new THREE.Mesh(
      this.geometry,
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(...options.color),
        vertexColors: true,
        transparent: true,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    mesh.scale.setScalar(0.001);
    this.group.add(mesh);
    const wave: Wave = { mesh, age: 0, lifetime: options.seconds, maxRadius: options.radius, peakOpacity: options.opacity ?? 1, surface };
    this.waves.push(wave);
    return wave;
  }

  private remove(index: number): void {
    const [wave] = this.waves.splice(index, 1);
    this.group.remove(wave.mesh);
    wave.mesh.material.dispose();
  }
}
