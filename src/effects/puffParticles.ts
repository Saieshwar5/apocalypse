import * as THREE from 'three';
import { tileableFractalNoise } from '../asteroids/tileableNoise';
import { createSeededRandom } from '../logic/random';

/**
 * Colour over a particle's life as flat stops of [time 0..1, r, g, b, alpha].
 * Colours are premultiplied: with alpha 0 a particle only adds light (fire,
 * sparks); with alpha above 0 it also hides what is behind it (smoke, dust).
 * One ramp can therefore cool from glowing gas into dark smoke.
 */
export type ColorRamp = readonly number[];

export interface PuffOptions {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  /** Exponential slowdown per second. */
  drag: number;
  lifetime: number;
  startSize: number;
  endSize: number;
  ramp: ColorRamp;
  /** 0 = soft round glow, 1 = ragged billowing cloud. */
  cloudiness: number;
  /** Multiplies the ramp's colour (not its alpha). */
  brightness?: number;
  /** Flickers per second, for glitter. */
  twinkle?: number;
}

interface Puff {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  drag: number;
  age: number;
  lifetime: number;
  startSize: number;
  endSize: number;
  ramp: ColorRamp;
  cloudiness: number;
  brightness: number;
  twinkle: number;
  rotation: number;
  spin: number;
  seed: number;
}

const STOP = 5;
const scratchColor: [number, number, number, number] = [0, 0, 0, 0];

/**
 * Every soft particle of every explosion, drawn as camera-facing quads in
 * one instanced draw call. The pool has a fixed size; when it is full the
 * particle nearest the end of its life is replaced.
 */
export class PuffParticles {
  readonly mesh: THREE.Mesh;
  private readonly puffs: Puff[];
  private count = 0;
  private readonly geometry = new THREE.InstancedBufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly noise = createNoiseTexture();
  private readonly centres: THREE.InstancedBufferAttribute;
  private readonly shapes: THREE.InstancedBufferAttribute;
  private readonly colors: THREE.InstancedBufferAttribute;

  constructor(capacity: number) {
    this.puffs = Array.from({ length: capacity }, () => ({
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      drag: 0,
      age: 0,
      lifetime: 1,
      startSize: 1,
      endSize: 1,
      ramp: [],
      cloudiness: 0,
      brightness: 1,
      twinkle: 0,
      rotation: 0,
      spin: 0,
      seed: 0,
    }));
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geometry.index = quad.index;
    this.geometry.setAttribute('position', quad.getAttribute('position'));
    this.centres = this.addAttribute('aCentre', capacity, 3);
    this.shapes = this.addAttribute('aShape', capacity, 4);
    this.colors = this.addAttribute('aColor', capacity, 4);
    this.geometry.instanceCount = 0;
    this.material = new THREE.ShaderMaterial({
      uniforms: { uNoise: { value: this.noise } },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      premultipliedAlpha: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    // Instances are spread over the whole play area.
    this.mesh.frustumCulled = false;
  }

  spawn(options: PuffOptions): void {
    const puff = this.puffs[this.claimSlot()];
    puff.position.copy(options.position);
    puff.velocity.copy(options.velocity);
    puff.drag = options.drag;
    puff.age = 0;
    puff.lifetime = options.lifetime;
    puff.startSize = options.startSize;
    puff.endSize = options.endSize;
    puff.ramp = options.ramp;
    puff.cloudiness = options.cloudiness;
    puff.brightness = options.brightness ?? 1;
    puff.twinkle = options.twinkle ?? 0;
    puff.rotation = Math.random() * Math.PI * 2;
    // Only clouds visibly turn; spinning them sells the roiling.
    puff.spin = (Math.random() - 0.5) * 1.6 * options.cloudiness;
    puff.seed = Math.random() * 16;
  }

  update(deltaSeconds: number): void {
    const centres = this.centres.array as Float32Array;
    const shapes = this.shapes.array as Float32Array;
    const colors = this.colors.array as Float32Array;
    let index = 0;
    while (index < this.count) {
      const puff = this.puffs[index];
      puff.age += deltaSeconds;
      if (puff.age >= puff.lifetime) {
        this.release(index);
        continue;
      }
      puff.velocity.multiplyScalar(Math.exp(-puff.drag * deltaSeconds));
      puff.position.addScaledVector(puff.velocity, deltaSeconds);
      puff.rotation += puff.spin * deltaSeconds;
      const t = puff.age / puff.lifetime;
      // Fast growth that settles, like a pressure wave running out of push.
      const growth = 1 - (1 - t) * (1 - t);
      sampleRamp(puff.ramp, t, scratchColor);
      let brightness = puff.brightness;
      if (puff.twinkle > 0) {
        const wave = Math.sin(puff.seed * 7 + puff.age * puff.twinkle * Math.PI * 2);
        brightness *= 0.12 + 0.88 * Math.max(0, wave) ** 3;
      }
      puff.position.toArray(centres, index * 3);
      shapes[index * 4] = puff.startSize + (puff.endSize - puff.startSize) * growth;
      shapes[index * 4 + 1] = puff.rotation;
      shapes[index * 4 + 2] = puff.cloudiness;
      shapes[index * 4 + 3] = puff.seed;
      colors[index * 4] = scratchColor[0] * brightness;
      colors[index * 4 + 1] = scratchColor[1] * brightness;
      colors[index * 4 + 2] = scratchColor[2] * brightness;
      colors[index * 4 + 3] = scratchColor[3];
      index += 1;
    }
    this.geometry.instanceCount = this.count;
    this.centres.needsUpdate = true;
    this.shapes.needsUpdate = true;
    this.colors.needsUpdate = true;
  }

  clear(): void {
    this.count = 0;
    this.geometry.instanceCount = 0;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.noise.dispose();
  }

  private addAttribute(name: string, capacity: number, itemSize: number): THREE.InstancedBufferAttribute {
    const attribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity * itemSize), itemSize);
    attribute.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute(name, attribute);
    return attribute;
  }

  private claimSlot(): number {
    if (this.count < this.puffs.length) {
      this.count += 1;
      return this.count - 1;
    }
    let oldest = 0;
    let oldestProgress = -1;
    for (let index = 0; index < this.count; index += 1) {
      const progress = this.puffs[index].age / this.puffs[index].lifetime;
      if (progress > oldestProgress) {
        oldestProgress = progress;
        oldest = index;
      }
    }
    return oldest;
  }

  /** Swaps the dead particle with the last live one so the live range stays packed. */
  private release(index: number): void {
    this.count -= 1;
    const dead = this.puffs[index];
    this.puffs[index] = this.puffs[this.count];
    this.puffs[this.count] = dead;
  }
}

function sampleRamp(ramp: ColorRamp, t: number, target: [number, number, number, number]): void {
  let next = STOP;
  while (next < ramp.length - STOP && ramp[next] < t) {
    next += STOP;
  }
  const previous = next - STOP;
  const span = Math.max(ramp[next] - ramp[previous], 1e-6);
  const mix = Math.min(1, Math.max(0, (t - ramp[previous]) / span));
  for (let channel = 0; channel < 4; channel += 1) {
    const from = ramp[previous + 1 + channel];
    target[channel] = from + (ramp[next + 1 + channel] - from) * mix;
  }
}

function createNoiseTexture(): THREE.DataTexture {
  const size = 128;
  const field = tileableFractalNoise(size, 4, 5, createSeededRandom(77));
  const pixels = new Uint8Array(size * size * 4);
  for (let index = 0; index < field.data.length; index += 1) {
    pixels.fill(Math.round(field.data[index] * 255), index * 4, index * 4 + 4);
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

const VERTEX_SHADER = /* glsl */ `
attribute vec3 aCentre;
// x = size, y = rotation, z = cloudiness, w = random seed
attribute vec4 aShape;
attribute vec4 aColor;
varying vec2 vCorner;
varying vec2 vNoiseUv;
varying vec4 vColor;
varying float vCloudiness;

void main() {
  vec4 viewPosition = modelViewMatrix * vec4(aCentre, 1.0);
  float c = cos(aShape.y);
  float s = sin(aShape.y);
  viewPosition.xy += mat2(c, s, -s, c) * position.xy * aShape.x;
  gl_Position = projectionMatrix * viewPosition;
  vCorner = position.xy * 2.0;
  // Each particle looks through its own window of the noise.
  vNoiseUv = position.xy * 0.42 + vec2(aShape.w, aShape.w * 1.618);
  vColor = aColor;
  vCloudiness = aShape.z;
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D uNoise;
varying vec2 vCorner;
varying vec2 vNoiseUv;
varying vec4 vColor;
varying float vCloudiness;

void main() {
  float distanceFromCentre = length(vCorner);
  if (distanceFromCentre > 1.0) discard;
  float core = 1.0 - distanceFromCentre;
  float glow = core * core;
  float noise = texture2D(uNoise, vNoiseUv).r;
  // The noise eats into the edge, so clouds get lobes instead of a disc.
  float cloud = smoothstep(0.0, 0.45, core - (0.72 - noise) * 0.75) * (0.55 + noise * 0.7);
  float shape = mix(glow, cloud, vCloudiness);
  gl_FragColor = vec4(vColor.rgb * shape, vColor.a * shape);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
