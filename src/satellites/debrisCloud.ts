import * as THREE from 'three';
import { orbitState, type CircularOrbit } from '../logic/satellites';

export const FRAGMENTS_PER_CLOUD = 40;
/** Hazard radius, in world units, once the cloud has spread out. */
const FULL_RADIUS = 1.5;
/** The hazard is never smaller than the satellite that made it. */
const MIN_RADIUS = 0.6;
/** Time constant of the spread: fragments are 95% of the way out after three of these. */
const SPREAD_SECONDS = 0.9;
/** Debris strings out along the orbit more than across it. */
const ALONG_TRACK_STRETCH = 1.5;

/** Muted versions of the satellite materials: foil, bare metal, solar cell, radiator. */
const FRAGMENT_COLORS = [0x9a7226, 0x6c6f75, 0x22386e, 0x7d7c75, 0x6c6f75];

interface Fragment {
  /** Final offset from the cloud centre in the orbit frame (radial, along-track, cross-track). */
  offset: THREE.Vector3;
  scale: THREE.Vector3;
  axis: THREE.Vector3;
  angle: number;
  spinRate: number;
}

const matrix = new THREE.Matrix4();
const rotation = new THREE.Quaternion();
const place = new THREE.Vector3();
const radial = new THREE.Vector3();
const along = new THREE.Vector3();
const across = new THREE.Vector3();
const color = new THREE.Color();

/** One shard shape for every cloud: a thin plate, like torn panel or hull skin. */
export function createFragmentGeometry(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(1, 0.14, 0.7);
}

/**
 * Glossy and flat-shaded, so each face catches the sun for a moment as the
 * fragment tumbles: the glint comes from real lighting, not from emission,
 * and bloom then picks out only the brief highlights.
 */
export function createFragmentMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.35, roughness: 0.3, flatShading: true });
}

/**
 * What is left of a destroyed satellite: a sparse cloud of tumbling
 * fragments that stays on the satellite's orbit, so the wreck comes round
 * again and again as a hazard. Drawn as one instanced mesh.
 */
export class DebrisCloud {
  /** Centre of the cloud in world space. */
  readonly position = new THREE.Vector3();
  /** Current hazard radius; grows from the wreck's size as the cloud spreads. */
  radius = MIN_RADIUS;
  readonly mesh: THREE.InstancedMesh;
  private readonly fragments: Fragment[] = [];
  private age = 0;

  /** The geometry and material are shared by all clouds and owned by the fleet. */
  constructor(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    private readonly orbit: CircularOrbit,
    rng: () => number,
  ) {
    this.mesh = new THREE.InstancedMesh(geometry, material, FRAGMENTS_PER_CLOUD);
    this.mesh.name = 'satellite-debris';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Instance matrices are in world space, far from the mesh's own origin.
    this.mesh.frustumCulled = false;
    for (let index = 0; index < FRAGMENTS_PER_CLOUD; index += 1) {
      // Cube-root radius fills the volume evenly instead of crowding the centre.
      const distance = FULL_RADIUS * Math.cbrt(0.05 + 0.95 * rng());
      const offset = randomDirection(rng).multiplyScalar(distance);
      offset.y *= ALONG_TRACK_STRETCH;
      // A few large plates (panel sections), mostly small scraps.
      const size = 0.035 + 0.11 * Math.pow(rng(), 2.2);
      this.fragments.push({
        offset,
        scale: new THREE.Vector3(size * (0.6 + rng()), size * (0.3 + 2.5 * rng() * rng()), size * (0.6 + rng())),
        axis: randomDirection(rng),
        angle: rng() * Math.PI * 2,
        spinRate: (0.4 + 2.2 * rng()) * (rng() < 0.5 ? -1 : 1),
      });
      this.mesh.setColorAt(index, color.setHex(FRAGMENT_COLORS[Math.floor(rng() * FRAGMENT_COLORS.length)]));
    }
  }

  /** `fleetSeconds` is the fleet's clock, the same one the satellite's orbit used. */
  update(fleetSeconds: number, deltaSeconds: number): void {
    this.age += deltaSeconds;
    const state = orbitState(this.orbit, fleetSeconds);
    this.position.fromArray(state.position);
    radial.copy(this.position).normalize();
    along.fromArray(state.velocity).normalize();
    across.crossVectors(radial, along);
    // Fast at first, then settling: fragments fly apart and then just drift.
    const spread = 1 - Math.exp(-this.age / SPREAD_SECONDS);
    this.radius = MIN_RADIUS + (FULL_RADIUS - MIN_RADIUS) * spread;
    this.fragments.forEach((fragment, index) => {
      fragment.angle += fragment.spinRate * deltaSeconds;
      place
        .copy(this.position)
        .addScaledVector(radial, fragment.offset.x * spread)
        .addScaledVector(along, fragment.offset.y * spread)
        .addScaledVector(across, fragment.offset.z * spread);
      rotation.setFromAxisAngle(fragment.axis, fragment.angle);
      matrix.compose(place, rotation, fragment.scale);
      this.mesh.setMatrixAt(index, matrix);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Frees the per-cloud instance buffers. The shared geometry and material stay. */
  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.dispose();
  }
}

function randomDirection(rng: () => number): THREE.Vector3 {
  const z = rng() * 2 - 1;
  const angle = rng() * Math.PI * 2;
  const ring = Math.sqrt(1 - z * z);
  return new THREE.Vector3(ring * Math.cos(angle), ring * Math.sin(angle), z);
}
