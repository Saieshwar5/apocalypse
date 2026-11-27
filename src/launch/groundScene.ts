import * as THREE from 'three';
import { requireNode, type ModelLibrary } from '../scene/modelLibrary';

/** Sun low over the sea to the east: a sunrise launch. */
export const PAD_SUN_DIRECTION = new THREE.Vector3(0.82, 0.16, -0.55).normalize();

const SKY_VERTEX = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = normalize(position);
    vec4 world = modelMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewMatrix * world;
    gl_Position.z = gl_Position.w; // keep the dome behind everything
  }
`;

const SKY_FRAGMENT = /* glsl */ `
  uniform vec3 sunDirection;
  uniform float altitude; // 0 on the ground, 1 at the edge of space
  varying vec3 vDirection;
  void main() {
    vec3 direction = normalize(vDirection);
    float up = max(direction.y, 0.0);
    vec3 zenith = mix(vec3(0.1, 0.22, 0.52), vec3(0.0, 0.004, 0.02), altitude);
    vec3 horizon = mix(vec3(1.0, 0.56, 0.32), vec3(0.35, 0.28, 0.45), altitude * 0.7);
    vec3 color = mix(horizon, zenith, pow(up, 0.45));
    float towardSun = max(dot(direction, sunDirection), 0.0);
    color += vec3(1.0, 0.6, 0.3) * pow(towardSun, 6.0) * 0.6 * (1.0 - altitude * 0.6);
    color += vec3(8.0, 6.0, 4.0) * pow(towardSun, 900.0);
    // Below the horizon: dark haze, so the ground edge blends away.
    color = mix(color, vec3(0.35, 0.25, 0.22) * (1.0 - altitude), smoothstep(0.0, -0.08, direction.y));
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface LaunchStack {
  /** Booster plus the interceptor on top; moved as one until separation. */
  rocket: THREE.Group;
  booster: THREE.Object3D;
  ship: THREE.Object3D;
  strapOns: THREE.Object3D[];
  coreFlames: THREE.Object3D[];
  strapFlames: THREE.Object3D[];
}

/**
 * The launch site at real scale (metres): dawn sky, coastal ground and sea,
 * the Blender launch pad and the rocket with the interceptor on top.
 */
export class GroundScene {
  readonly scene = new THREE.Scene();
  readonly stack: LaunchStack;
  readonly swingArms: THREE.Object3D[];
  readonly rocketBase: THREE.Vector3;
  private readonly skyUniforms: Record<string, THREE.IUniform>;

  constructor(models: ModelLibrary, renderer: THREE.WebGLRenderer) {
    this.skyUniforms = { sunDirection: { value: PAD_SUN_DIRECTION }, altitude: { value: 0 } };
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(4000, 48, 24),
      new THREE.ShaderMaterial({
        uniforms: this.skyUniforms,
        vertexShader: SKY_VERTEX,
        fragmentShader: SKY_FRAGMENT,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    );
    sky.frustumCulled = false;
    this.scene.add(sky);
    this.scene.fog = new THREE.FogExp2(0xc7987a, 0.0011);
    this.scene.environment = this.bakeEnvironment(renderer, sky);
    this.scene.environmentIntensity = 0.7;

    this.addLights();
    this.addTerrain();

    const pad = models.launchPad.clone(true);
    this.scene.add(pad);
    pad.updateMatrixWorld(true);
    this.rocketBase = requireNode(pad, 'rocket_base').getWorldPosition(new THREE.Vector3());
    this.swingArms = [0, 1, 2].map((index) => requireNode(pad, `SwingArm_${index}`));
    this.stack = this.buildStack(models);
    this.scene.add(this.stack.rocket);
    this.enableShadows(pad);
    this.enableShadows(this.stack.rocket);
  }

  /** Darkens the sky and thins the haze as the rocket climbs (0..1). */
  setAltitude(fraction: number): void {
    const value = THREE.MathUtils.clamp(fraction, 0, 1);
    this.skyUniforms.altitude.value = value;
    (this.scene.fog as THREE.FogExp2).density = 0.0011 * (1 - value * 0.9);
  }

  private bakeEnvironment(renderer: THREE.WebGLRenderer, sky: THREE.Mesh): THREE.Texture {
    const envScene = new THREE.Scene();
    envScene.add(sky.clone());
    const generator = new THREE.PMREMGenerator(renderer);
    const texture = generator.fromScene(envScene, 0, 1, 5000).texture;
    generator.dispose();
    return texture;
  }

  private addLights(): void {
    const sun = new THREE.DirectionalLight(0xffc89a, 3.2);
    sun.position.copy(PAD_SUN_DIRECTION).multiplyScalar(160);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const area = sun.shadow.camera;
    area.left = -70;
    area.right = 70;
    area.top = 90;
    area.bottom = -40;
    area.near = 10;
    area.far = 400;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.05;
    this.scene.add(sun, sun.target);
    this.scene.add(new THREE.HemisphereLight(0x8fb2e6, 0x5a4636, 0.9));
  }

  private addTerrain(): void {
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(4000, 64),
      new THREE.MeshStandardMaterial({ map: createGroundTexture(), color: 0xb7a07a, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // The Bay of Bengal lies east of the pad.
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 8000),
      new THREE.MeshStandardMaterial({ color: 0x0d2a3a, roughness: 0.12, metalness: 0.3 }),
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(2300, 0.05, 0);
    this.scene.add(sea);
  }

  private buildStack(models: ModelLibrary): LaunchStack {
    const rocket = new THREE.Group();
    rocket.position.copy(this.rocketBase);
    const booster = models.booster.clone(true);
    rocket.add(booster);
    booster.updateMatrixWorld(true);
    const mount = requireNode(booster, 'payload_mount').position.clone();

    const ship = models.interceptor.clone(true);
    // Nose up: the ship's forward (-Z) turns to +Y; its tail is 5.9 m behind centre.
    ship.rotation.x = Math.PI / 2;
    ship.position.copy(mount).add(new THREE.Vector3(0, 5.9, 0));
    rocket.add(ship);

    const flames = (pattern: RegExp) => {
      const found: THREE.Object3D[] = [];
      booster.traverse((node) => {
        if (pattern.test(node.name)) {
          found.push(node);
        }
      });
      return found;
    };
    return {
      rocket,
      booster,
      ship,
      strapOns: [requireNode(booster, 'StrapOn_0'), requireNode(booster, 'StrapOn_1')],
      coreFlames: flames(/^core_flame_/),
      strapFlames: flames(/^strap_flame_/),
    };
  }

  private enableShadows(root: THREE.Object3D): void {
    root.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.castShadow = true;
        node.receiveShadow = true;
      }
    });
  }
}

/** Sandy coastal scrub, generated so no texture download is needed. */
function createGroundTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('2D canvas is not available for the ground texture');
  }
  context.fillStyle = '#9a8a6a';
  context.fillRect(0, 0, size, size);
  for (let index = 0; index < 9000; index += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const radius = 0.5 + Math.random() * 3.5;
    const green = Math.random() < 0.35;
    context.fillStyle = green
      ? `rgba(${70 + Math.random() * 30}, ${90 + Math.random() * 40}, 50, 0.35)`
      : `rgba(${150 + Math.random() * 50}, ${130 + Math.random() * 40}, ${100 + Math.random() * 30}, 0.3)`;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(120, 120);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}
