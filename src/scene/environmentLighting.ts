import * as THREE from 'three';

/** Distance of the stand-in planet in the small reflection scene. */
const STAGE_DISTANCE = 100;
/** Refresh at most this often, in seconds, and only when the view has changed enough. */
const REFRESH_SECONDS = 0.8;
/** The planet's direction must turn this far (radians) before the reflection is rebuilt. */
const TURN_THRESHOLD = 0.035;
/** Rebuild anyway this often, so the planet's slow spin shows in reflections. */
const MAX_AGE_SECONDS = 6;

const PLANET_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  void main() {
    vUv = uv;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPosition = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const PLANET_FRAGMENT = /* glsl */ `
  uniform sampler2D dayMap;
  uniform vec3 sunDirection;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  void main() {
    vec3 normal = normalize(vNormal);
    float light = max(dot(normal, sunDirection), 0.0);
    vec3 day = texture2D(dayMap, vUv).rgb * light * 1.4;
    // A thin blue limb on the lit side: the atmosphere seen edge-on.
    vec3 view = normalize(vWorldPosition - cameraPosition);
    float rim = pow(1.0 - abs(dot(normal, view)), 4.0);
    vec3 atmosphere = vec3(0.25, 0.5, 1.0) * rim * smoothstep(-0.2, 0.4, dot(normal, sunDirection)) * 0.8;
    gl_FragColor = vec4(day + atmosphere, 1.0);
  }
`;

/**
 * Reflections for metal surfaces. Space gives a metal hull almost nothing to
 * reflect, so without this ships and stations look flat and black. A tiny
 * stand-in scene holds the sun, the planet (lit by the sun, with its real
 * surface, at the size and direction seen from the ship) and a faint sky; it
 * is turned into a blurred reflection map and rebuilt as the ship moves. Hulls
 * then catch blue Earthlight over the day side and go dark over the night side.
 */
export class EnvironmentLighting {
  private readonly stage = new THREE.Scene();
  private readonly planet: THREE.Mesh;
  private readonly generator: THREE.PMREMGenerator;
  private target: THREE.WebGLRenderTarget | null = null;
  private readonly lastDirection = new THREE.Vector3();
  private lastScale = 0;
  private timer = Infinity;
  private age = 0;
  enabled = true;

  constructor(
    renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    sunDirection: THREE.Vector3,
    dayMap: THREE.Texture,
  ) {
    this.generator = new THREE.PMREMGenerator(renderer);
    this.stage.background = new THREE.Color(0.006, 0.008, 0.016);
    const sun = new THREE.Mesh(new THREE.SphereGeometry(5, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(60, 54, 46) }));
    sun.position.copy(sunDirection).multiplyScalar(STAGE_DISTANCE * 1.8);
    // A soft halo around the sun so reflections show a glare, not a pinpoint.
    const halo = new THREE.Mesh(new THREE.SphereGeometry(18, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.8, 0.65) }));
    halo.position.copy(sun.position);
    this.stage.add(halo, sun);
    this.planet = new THREE.Mesh(
      new THREE.SphereGeometry(1, 64, 32),
      new THREE.ShaderMaterial({
        uniforms: { dayMap: { value: dayMap }, sunDirection: { value: sunDirection.clone().normalize() } },
        vertexShader: PLANET_VERTEX,
        fragmentShader: PLANET_FRAGMENT,
      }),
    );
    this.stage.add(this.planet);
  }

  /** The planet's surface map changed (another star system). */
  setDayMap(dayMap: THREE.Texture): void {
    (this.planet.material as THREE.ShaderMaterial).uniforms.dayMap.value = dayMap;
    this.timer = Infinity;
    this.age = MAX_AGE_SECONDS;
  }

  /**
   * Rebuilds the reflection when the view has changed. `viewer` is the ship's
   * position; `planetOrientation` is the planet's current world rotation.
   */
  update(deltaSeconds: number, viewer: THREE.Vector3, planetRadius: number, planetOrientation: THREE.Quaternion): void {
    this.timer += deltaSeconds;
    this.age += deltaSeconds;
    if (!this.enabled || this.timer < REFRESH_SECONDS) {
      return;
    }
    const distance = Math.max(viewer.length(), planetRadius * 1.01);
    const direction = viewer.clone().negate().divideScalar(distance);
    // The stand-in keeps the planet's apparent size: asin(r / D) = asin(R / d).
    const scale = (STAGE_DISTANCE * planetRadius) / distance;
    const turned = this.target === null || direction.angleTo(this.lastDirection) > TURN_THRESHOLD;
    const resized = Math.abs(scale - this.lastScale) > this.lastScale * 0.08;
    if (!turned && !resized && this.age < MAX_AGE_SECONDS) {
      return;
    }
    this.planet.position.copy(direction).multiplyScalar(STAGE_DISTANCE);
    this.planet.scale.setScalar(Math.min(scale, STAGE_DISTANCE * 0.97));
    this.planet.quaternion.copy(planetOrientation);
    const next = this.generator.fromScene(this.stage, 0.02, 0.5, 1000);
    this.scene.environment = next.texture;
    this.target?.dispose();
    this.target = next;
    this.lastDirection.copy(direction);
    this.lastScale = scale;
    this.timer = 0;
    this.age = 0;
  }

  dispose(): void {
    this.target?.dispose();
    this.generator.dispose();
  }
}
