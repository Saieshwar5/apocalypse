import * as THREE from 'three';
import { createConeGradientTexture, getGlowTexture } from '../scene/glowTexture';

const MAX_SMOKE = 2200;

const SMOKE_VERTEX = /* glsl */ `
  attribute float size;
  attribute float alpha;
  attribute float heat;
  varying float vAlpha;
  varying float vHeat;
  uniform float scale;
  void main() {
    vAlpha = alpha;
    vHeat = heat;
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * scale / max(-viewPosition.z, 0.1);
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const SMOKE_FRAGMENT = /* glsl */ `
  uniform sampler2D puff;
  uniform vec3 lightColor;
  varying float vAlpha;
  varying float vHeat;
  void main() {
    vec4 texel = texture2D(puff, gl_PointCoord);
    vec3 smoke = mix(vec3(0.62, 0.6, 0.58), vec3(0.95, 0.93, 0.9), texel.r);
    // Puffs near the flame glow orange from below.
    vec3 color = mix(smoke * lightColor, vec3(4.0, 1.8, 0.5), vHeat);
    gl_FragColor = vec4(color, texel.a * vAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

interface Flame {
  socket: THREE.Object3D;
  outer: THREE.Mesh;
  core: THREE.Mesh;
  glow: THREE.Sprite;
  scale: number;
}

interface SmokeParticle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  age: number;
  lifetime: number;
  size: number;
  growth: number;
}

/**
 * Engine flames, a flickering light on the pad, billowing exhaust smoke and
 * the steam burst at ignition. Smoke is a single point cloud drawn with soft,
 * cloudy sprites so a few thousand puffs stay cheap.
 */
export class RocketEffects {
  readonly group = new THREE.Group();
  readonly light = new THREE.PointLight(0xff9a4a, 0, 260, 1.6);
  private readonly flames: Flame[] = [];
  private readonly particles: SmokeParticle[] = [];
  private readonly positions = new Float32Array(MAX_SMOKE * 3);
  private readonly sizes = new Float32Array(MAX_SMOKE);
  private readonly alphas = new Float32Array(MAX_SMOKE);
  private readonly heats = new Float32Array(MAX_SMOKE);
  private readonly smoke: THREE.Points;
  private readonly outerGeometry: THREE.ConeGeometry;
  private readonly coreGeometry: THREE.ConeGeometry;
  private readonly flameTexture = createConeGradientTexture([
    [0, 'rgba(255,255,240,1)'],
    [0.12, 'rgba(255,210,120,0.95)'],
    [0.45, 'rgba(255,110,30,0.55)'],
    [1, 'rgba(80,20,0,0)'],
  ]);
  private elapsed = 0;
  private readonly scratch = new THREE.Vector3();

  constructor() {
    // Base at the nozzle, tip pointing down (-Y) from the socket.
    this.outerGeometry = new THREE.ConeGeometry(1, 1, 24, 1, true);
    this.outerGeometry.translate(0, 0.5, 0);
    this.outerGeometry.rotateX(Math.PI);
    this.coreGeometry = this.outerGeometry.clone();

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('alpha', new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('heat', new THREE.BufferAttribute(this.heats, 1).setUsage(THREE.DynamicDrawUsage));
    this.smoke = new THREE.Points(
      geometry,
      new THREE.ShaderMaterial({
        uniforms: {
          puff: { value: createPuffTexture() },
          scale: { value: 500 },
          lightColor: { value: new THREE.Color(1.0, 0.86, 0.75) },
        },
        vertexShader: SMOKE_VERTEX,
        fragmentShader: SMOKE_FRAGMENT,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.smoke.frustumCulled = false;
    this.group.add(this.smoke, this.light);
  }

  /** Viewport height drives point size; call on resize. */
  setViewportHeight(pixels: number): void {
    (this.smoke.material as THREE.ShaderMaterial).uniforms.scale.value = pixels * 0.9;
  }

  attachFlame(socket: THREE.Object3D, scale: number): void {
    const material = (opacity: number, color: THREE.Color) =>
      new THREE.MeshBasicMaterial({
        map: this.flameTexture,
        color,
        transparent: true,
        opacity,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
    const outer = new THREE.Mesh(this.outerGeometry, material(0.8, new THREE.Color(2.2, 1.2, 0.5)));
    const core = new THREE.Mesh(this.coreGeometry, material(1, new THREE.Color(4, 3.4, 2.4)));
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: getGlowTexture(),
        color: new THREE.Color(5, 2.6, 1),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    socket.add(outer, core, glow);
    this.flames.push({ socket, outer, core, glow, scale });
    this.setFlame(this.flames[this.flames.length - 1], 0);
  }

  /** 0 = off, 1 = full thrust. `sockets` limits the change to some engines. */
  setThrust(level: number, sockets?: readonly THREE.Object3D[]): void {
    for (const flame of this.flames) {
      if (!sockets || sockets.includes(flame.socket)) {
        flame.socket.userData.thrust = level;
      }
    }
  }

  /** White steam rolling out along the ground from the base, at ignition. */
  steamBurst(base: THREE.Vector3, amount: number): void {
    for (let index = 0; index < amount; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 4 + Math.random() * 10;
      this.spawn(
        base.clone().add(new THREE.Vector3(Math.cos(angle) * 4, 0.5 + Math.random() * 2, Math.sin(angle) * 4)),
        new THREE.Vector3(Math.cos(angle) * speed, 1 + Math.random() * 4, Math.sin(angle) * speed),
        2.5 + Math.random() * 2,
        3 + Math.random() * 2.5,
        2,
      );
    }
  }

  update(deltaSeconds: number, groundY: number, emitSmoke: boolean): void {
    this.elapsed += deltaSeconds;
    let totalThrust = 0;
    for (const flame of this.flames) {
      const thrust = (flame.socket.userData.thrust as number | undefined) ?? 0;
      totalThrust += thrust;
      this.setFlame(flame, thrust);
      if (emitSmoke && thrust > 0.05 && flame.socket.visible) {
        this.emitExhaust(flame, thrust, deltaSeconds, groundY);
      }
    }
    const flicker = 0.85 + Math.random() * 0.3;
    this.light.intensity = totalThrust > 0 ? 9000 * Math.min(1, totalThrust / 4) * flicker : 0;
    this.updateSmoke(deltaSeconds, groundY);
  }

  clear(): void {
    this.particles.length = 0;
    this.smoke.geometry.setDrawRange(0, 0);
    this.setThrust(0);
  }

  private setFlame(flame: Flame, thrust: number): void {
    const flicker = 0.92 + Math.sin(this.elapsed * 53 + flame.scale) * 0.05 + Math.random() * 0.06;
    const visible = thrust > 0.01;
    flame.outer.visible = visible;
    flame.core.visible = visible;
    flame.glow.visible = visible;
    const s = flame.scale;
    flame.outer.scale.set(s * 0.9, s * (2 + thrust * 9) * flicker, s * 0.9);
    flame.core.scale.set(s * 0.5, s * (1 + thrust * 4) * flicker, s * 0.5);
    flame.glow.scale.setScalar(s * (2 + thrust * 6));
    (flame.outer.material as THREE.MeshBasicMaterial).opacity = 0.75 * thrust;
    (flame.core.material as THREE.MeshBasicMaterial).opacity = thrust;
    flame.glow.material.opacity = thrust;
  }

  private emitExhaust(flame: Flame, thrust: number, deltaSeconds: number, groundY: number): void {
    const origin = flame.socket.getWorldPosition(this.scratch);
    const height = origin.y - groundY;
    const rate = Math.round(thrust * flame.scale * 260 * deltaSeconds);
    for (let index = 0; index < rate; index += 1) {
      const start = origin.clone().add(new THREE.Vector3(0, -flame.scale * (3 + thrust * 6), 0));
      const velocity = new THREE.Vector3((Math.random() - 0.5) * 6, -18 - Math.random() * 14, (Math.random() - 0.5) * 6);
      if (height < 25) {
        // Near the pad the exhaust slams into the deck and spreads sideways.
        const angle = Math.random() * Math.PI * 2;
        const spread = 7 + Math.random() * 12;
        start.y = groundY + 1 + Math.random() * 3;
        velocity.set(Math.cos(angle) * spread, 2 + Math.random() * 5, Math.sin(angle) * spread);
      }
      this.spawn(start, velocity, flame.scale * 1.8, 5 + Math.random() * 4, 1.2 + Math.random());
    }
  }

  private spawn(position: THREE.Vector3, velocity: THREE.Vector3, size: number, lifetime: number, growth: number): void {
    if (this.particles.length >= MAX_SMOKE) {
      this.particles.shift();
    }
    this.particles.push({ position, velocity, age: 0, lifetime, size, growth });
  }

  private updateSmoke(deltaSeconds: number, groundY: number): void {
    const drag = Math.exp(-0.9 * deltaSeconds);
    let write = 0;
    for (let index = 0; index < this.particles.length; index += 1) {
      const particle = this.particles[index];
      particle.age += deltaSeconds;
      if (particle.age >= particle.lifetime) {
        continue;
      }
      particle.velocity.multiplyScalar(drag);
      particle.velocity.y += 1.2 * deltaSeconds; // warm smoke rises
      particle.velocity.x += 1.5 * deltaSeconds; // sea breeze
      particle.position.addScaledVector(particle.velocity, deltaSeconds);
      particle.position.y = Math.max(particle.position.y, groundY + 0.5);
      const t = particle.age / particle.lifetime;
      this.particles[write] = particle;
      this.positions.set([particle.position.x, particle.position.y, particle.position.z], write * 3);
      this.sizes[write] = particle.size * (1 + t * particle.growth * 3);
      this.alphas[write] = Math.min(1, t * 6) * (1 - t) * 0.55;
      this.heats[write] = Math.max(0, 1 - particle.age * 3) * 0.6;
      write += 1;
    }
    this.particles.length = write;
    const geometry = this.smoke.geometry;
    geometry.setDrawRange(0, write);
    for (const name of ['position', 'size', 'alpha', 'heat']) {
      geometry.getAttribute(name).needsUpdate = true;
    }
  }
}

/** Soft cloudy disc: R channel is light variation, alpha is the puff shape. */
function createPuffTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('2D canvas is not available for the smoke texture');
  }
  for (let index = 0; index < 26; index += 1) {
    const x = size / 2 + (Math.random() - 0.5) * size * 0.4;
    const y = size / 2 + (Math.random() - 0.5) * size * 0.4;
    const radius = size * (0.15 + Math.random() * 0.2);
    const shade = Math.round(150 + Math.random() * 105);
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(${shade},${shade},${shade},0.5)`);
    gradient.addColorStop(1, `rgba(${shade},${shade},${shade},0)`);
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  }
  return new THREE.CanvasTexture(canvas);
}
