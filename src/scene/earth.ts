import { PLANET_RADIUS } from '../logic/units';
import * as THREE from 'three';
import {
  ATMOSPHERE_FRAGMENT,
  AURORA_FRAGMENT,
  ATMOSPHERE_VERTEX,
  CLOUDS_FRAGMENT,
  CLOUDS_VERTEX,
  MAX_IMPACTS,
  SURFACE_FRAGMENT,
  SURFACE_VERTEX,
} from './earthShaders';

export const EARTH_RADIUS = PLANET_RADIUS;
const AXIAL_TILT = THREE.MathUtils.degToRad(23.44);
/** One rotation every eight minutes: slow, but visible during a wave. */
const SPIN_RATE = (Math.PI * 2) / 480;
const CLOUD_DRIFT_RATE = SPIN_RATE * 0.12;
/** Crater glow fades over roughly this many seconds. */
const IMPACT_COOL_SECONDS = 25;

export interface EarthTextures {
  day: THREE.Texture;
  night: THREE.Texture;
  detail: THREE.Texture;
}

export async function loadEarthTextures(renderer: THREE.WebGLRenderer): Promise<EarthTextures> {
  const loader = new THREE.TextureLoader();
  const base = `${import.meta.env.BASE_URL}textures/`;
  const [day, night, detail] = await Promise.all([
    loader.loadAsync(`${base}earth_day_4096.jpg`),
    loader.loadAsync(`${base}earth_night_4096.jpg`),
    loader.loadAsync(`${base}earth_bump_roughness_clouds_4096.jpg`),
  ]);
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  day.colorSpace = THREE.SRGBColorSpace;
  night.colorSpace = THREE.SRGBColorSpace;
  for (const texture of [day, night, detail]) {
    texture.anisotropy = anisotropy;
  }
  return { day, night, detail };
}

/**
 * The planet: tilted axis, spinning surface and clouds, and an atmosphere
 * shell. The world origin is Earth's centre; the atmosphere shader relies on it.
 */
export class Earth {
  readonly group = new THREE.Group();
  private readonly spin = new THREE.Group();
  private readonly clouds: THREE.Mesh;
  private readonly surfaceUniforms: Record<string, THREE.IUniform>;
  private readonly impacts: THREE.Vector4[] = [];
  private readonly impactHeat: number[] = [];
  private nextImpactSlot = 0;
  private readonly aurora: THREE.Mesh;
  private readonly time = { value: 0 };
  private readonly auroraStrength = { value: 1 };
  private auroraTarget = 1;

  constructor(textures: EarthTextures, sunDirection: THREE.Vector3) {
    this.group.rotation.z = AXIAL_TILT;
    this.group.add(this.spin);

    for (let index = 0; index < MAX_IMPACTS; index += 1) {
      this.impacts.push(new THREE.Vector4(0, 1, 0, 0));
      this.impactHeat.push(0);
    }

    this.surfaceUniforms = {
      dayMap: { value: textures.day },
      nightMap: { value: textures.night },
      detailMap: { value: textures.detail },
      sunDirection: { value: sunDirection },
      atmosphereDayColor: { value: new THREE.Color(0.3, 0.6, 1.0) },
      atmosphereTwilightColor: { value: new THREE.Color(0.9, 0.42, 0.18) },
      bumpScale: { value: 0.06 * (EARTH_RADIUS / 10) },
      impacts: { value: this.impacts },
      impactHeat: { value: this.impactHeat },
      impactCount: { value: 0 },
      cloudShift: { value: 0 },
    };
    const surface = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_RADIUS, 192, 96),
      new THREE.ShaderMaterial({
        uniforms: this.surfaceUniforms,
        vertexShader: SURFACE_VERTEX,
        fragmentShader: SURFACE_FRAGMENT,
      }),
    );
    this.spin.add(surface);

    this.clouds = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_RADIUS * 1.008, 160, 80),
      new THREE.ShaderMaterial({
        uniforms: { detailMap: { value: textures.detail }, sunDirection: { value: sunDirection }, time: this.time },
        vertexShader: CLOUDS_VERTEX,
        fragmentShader: CLOUDS_FRAGMENT,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.spin.add(this.clouds);

    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_RADIUS * 1.06, 128, 64),
      new THREE.ShaderMaterial({
        uniforms: {
          sunDirection: { value: sunDirection },
          planetRadius: { value: EARTH_RADIUS },
          atmosphereRadius: { value: EARTH_RADIUS * 1.06 },
          dayColor: { value: new THREE.Color(0.32, 0.62, 1.0) },
          twilightColor: { value: new THREE.Color(1.0, 0.45, 0.2) },
          intensity: { value: 1.25 },
        },
        vertexShader: ATMOSPHERE_VERTEX,
        fragmentShader: ATMOSPHERE_FRAGMENT,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.group.add(atmosphere);

    this.aurora = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_RADIUS * 1.025, 128, 64),
      new THREE.ShaderMaterial({
        uniforms: { sunDirection: { value: sunDirection }, time: this.time, strength: this.auroraStrength },
        vertexShader: ATMOSPHERE_VERTEX,
        fragmentShader: AURORA_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.spin.add(this.aurora);
  }

  /** 1 normally; a solar storm raises it towards 2 and the auroras flare. */
  setAuroraStrength(target: number): void {
    this.auroraTarget = target;
  }

  update(deltaSeconds: number): void {
    this.spin.rotation.y += SPIN_RATE * deltaSeconds;
    this.clouds.rotation.y += CLOUD_DRIFT_RATE * deltaSeconds;
    this.surfaceUniforms.cloudShift.value = this.clouds.rotation.y / (Math.PI * 2);
    this.time.value += deltaSeconds;
    this.auroraStrength.value += (this.auroraTarget - this.auroraStrength.value) * Math.min(1, deltaSeconds * 0.5);
    const cooling = deltaSeconds / IMPACT_COOL_SECONDS;
    for (let index = 0; index < this.impactHeat.length; index += 1) {
      this.impactHeat[index] = Math.max(0, this.impactHeat[index] - cooling);
    }
  }

  /** Records a crater at a world-space point so it turns with the planet. */
  addImpact(worldPoint: THREE.Vector3, angularRadius: number): void {
    const local = this.worldToLocalDirection(worldPoint);
    const slot = this.nextImpactSlot;
    this.impacts[slot].set(local.x, local.y, local.z, angularRadius);
    this.impactHeat[slot] = 1;
    this.nextImpactSlot = (slot + 1) % MAX_IMPACTS;
    const count = this.surfaceUniforms.impactCount.value as number;
    this.surfaceUniforms.impactCount.value = Math.min(MAX_IMPACTS, count + 1);
  }

  worldToLocalDirection(worldPoint: THREE.Vector3): THREE.Vector3 {
    return this.spin.worldToLocal(worldPoint.clone()).normalize();
  }

  /** World-space unit direction of a point fixed on the rotating surface. */
  localToWorldDirection(localDirection: THREE.Vector3): THREE.Vector3 {
    this.spin.updateWorldMatrix(true, false);
    return localDirection.clone().transformDirection(this.spin.matrixWorld);
  }

  /** Where a surface point will be, in world space, after `seconds` of rotation. */
  localToWorldDirectionAt(localDirection: THREE.Vector3, seconds: number): THREE.Vector3 {
    return this.localToWorldDirection(localDirection).applyAxisAngle(this.northAxis(), SPIN_RATE * seconds);
  }

  /** The surface point that will be under a world-space point after `seconds`. */
  worldToLocalDirectionAt(worldPoint: THREE.Vector3, seconds: number): THREE.Vector3 {
    const rewound = worldPoint.clone().applyAxisAngle(this.northAxis(), -SPIN_RATE * seconds);
    return this.worldToLocalDirection(rewound);
  }

  /** Adds an object that stays fixed to the ground as the planet turns. */
  attachToSurface(object: THREE.Object3D): void {
    this.spin.add(object);
  }

  /** World-space unit vector to the middle of the night side. */
  surfaceNight(): THREE.Vector3 {
    return (this.surfaceUniforms.sunDirection.value as THREE.Vector3).clone().negate().normalize();
  }

  /** World-space direction of the spin axis (geographic north). */
  northAxis(): THREE.Vector3 {
    return new THREE.Vector3(0, 1, 0).applyQuaternion(this.group.quaternion);
  }

  /** The day-side surface map, for the reflection stand-in. */
  get dayMap(): THREE.Texture {
    return this.surfaceUniforms.dayMap.value as THREE.Texture;
  }

  /** The planet's current world rotation, including tilt and spin. */
  worldOrientation(target = new THREE.Quaternion()): THREE.Quaternion {
    return this.spin.getWorldQuaternion(target);
  }

  /** Swaps the surface maps, for example to show a colony world in another system. */
  setTextures(textures: EarthTextures): void {
    this.surfaceUniforms.dayMap.value = textures.day;
    this.surfaceUniforms.nightMap.value = textures.night;
    this.surfaceUniforms.detailMap.value = textures.detail;
    (this.clouds.material as THREE.ShaderMaterial).uniforms.detailMap.value = textures.detail;
  }

  /** Clears craters and sets the planet's rotation (radians). */
  reset(spinAngle = 0): void {
    this.spin.rotation.y = spinAngle;
    this.clouds.rotation.y = 0;
    this.nextImpactSlot = 0;
    this.surfaceUniforms.impactCount.value = 0;
    this.impactHeat.fill(0);
  }
}

/**
 * Converts latitude/longitude in degrees to a direction in the planet's local
 * frame, matching how THREE.SphereGeometry lays out an equirectangular texture.
 */
export function latLonToLocalDirection(latitude: number, longitude: number): THREE.Vector3 {
  const u = (longitude + 180) / 360;
  const v = (90 - latitude) / 180;
  const phi = u * Math.PI * 2;
  const theta = v * Math.PI;
  return new THREE.Vector3(
    -Math.cos(phi) * Math.sin(theta),
    Math.cos(theta),
    Math.sin(phi) * Math.sin(theta),
  );
}

export function localDirectionToLatLon(direction: THREE.Vector3): { latitude: number; longitude: number } {
  const latitude = 90 - THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(direction.y, -1, 1)));
  let u = Math.atan2(direction.z, -direction.x) / (Math.PI * 2);
  if (u < 0) {
    u += 1;
  }
  return { latitude, longitude: u * 360 - 180 };
}
