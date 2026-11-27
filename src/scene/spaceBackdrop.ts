import * as THREE from 'three';
import { createSeededRandom, randomUnitVector, type RandomSource } from '../logic/random';
import { getGlowTexture } from './glowTexture';

const STAR_DISTANCE = 1800;
const SUN_DISTANCE = 1500;

/** Star colours from cool red to hot blue, weighted towards white. */
const STAR_TINTS = [
  new THREE.Color(1.0, 0.78, 0.62),
  new THREE.Color(1.0, 0.92, 0.82),
  new THREE.Color(1.0, 1.0, 1.0),
  new THREE.Color(1.0, 1.0, 1.0),
  new THREE.Color(0.8, 0.88, 1.0),
  new THREE.Color(0.65, 0.78, 1.0),
];

export function createStarfield(seed = 1977): THREE.Group {
  const rng = createSeededRandom(seed);
  const group = new THREE.Group();
  group.add(createStarLayer(rng, 5000, 1.5, 0.55, () => randomUnitVector(rng)));
  group.add(createStarLayer(rng, 1000, 2.4, 0.85, () => randomUnitVector(rng)));
  group.add(createStarLayer(rng, 140, 3.8, 1.4, () => randomUnitVector(rng)));
  // The Milky Way: many faint stars concentrated around a tilted great circle.
  const bandTilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.9, 0.3, 0.4));
  group.add(
    createStarLayer(rng, 14000, 1.2, 0.32, () => {
      const angle = rng() * Math.PI * 2;
      const spread = gaussian(rng) * 0.12;
      const direction = new THREE.Vector3(Math.cos(angle), spread, Math.sin(angle)).normalize();
      direction.applyQuaternion(bandTilt);
      return [direction.x, direction.y, direction.z];
    }),
  );
  return group;
}

function createStarLayer(
  rng: RandomSource,
  count: number,
  pixelSize: number,
  brightness: number,
  direction: () => [number, number, number],
): THREE.Points {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const [x, y, z] = direction();
    positions.set([x * STAR_DISTANCE, y * STAR_DISTANCE, z * STAR_DISTANCE], index * 3);
    const tint = STAR_TINTS[Math.floor(rng() * STAR_TINTS.length)];
    const level = brightness * (0.45 + rng() * 0.55);
    colors.set([tint.r * level, tint.g * level, tint.b * level], index * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: pixelSize,
    sizeAttenuation: false,
    vertexColors: true,
    map: getGlowTexture(),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return points;
}

/** Visible sun disc with corona, plus the directional light it casts. */
export function createSun(direction: THREE.Vector3): { group: THREE.Group; light: THREE.DirectionalLight } {
  const group = new THREE.Group();
  const position = direction.clone().multiplyScalar(SUN_DISTANCE);

  const core = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: getGlowTexture(),
      color: new THREE.Color(12, 10.5, 8.5),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  core.scale.setScalar(90);
  core.position.copy(position);
  group.add(core);

  const corona = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: getGlowTexture(),
      color: new THREE.Color(1.2, 0.9, 0.6),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.55,
    }),
  );
  corona.scale.setScalar(520);
  corona.position.copy(position);
  group.add(corona);

  const light = new THREE.DirectionalLight(0xfff4e6, 3.2);
  light.position.copy(direction).multiplyScalar(100);
  group.add(light);
  return { group, light };
}

function gaussian(rng: RandomSource): number {
  const u = Math.max(rng(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(Math.PI * 2 * rng());
}
