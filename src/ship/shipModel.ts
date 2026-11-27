import * as THREE from 'three';
import { createConeGradientTexture, getGlowTexture } from '../scene/glowTexture';
import { requireNode } from '../scene/modelLibrary';

/**
 * Game-unit scale of the Blender model. The ship is about 12.4 m long in
 * Blender, so this makes it about 2 units long (Earth's radius is 10).
 */
export const SHIP_SCALE = 0.16;

const ENGINE_SOCKETS = ['engine_main_0', 'engine_main_1', 'engine_pod_0', 'engine_pod_1'];
const NOZZLE_RADIUS = { main: 0.065, pod: 0.06 };

export interface ShipModel {
  group: THREE.Group;
  /** Local positions bolts leave from (left, right): the mandible cannon muzzles. */
  gunPorts: [THREE.Vector3, THREE.Vector3];
  /** Local position of the pilot's eye, for the cockpit camera. */
  cockpit: THREE.Vector3;
  setThrottle(level: number, boosting: boolean): void;
  /** Leans the hull into a turn; purely visual, so aiming is unaffected. */
  setBank(yawRate: number, deltaSeconds: number): void;
  update(elapsedSeconds: number): void;
}

interface Engine {
  plume: THREE.Mesh;
  glow: THREE.Sprite;
  baseRadius: number;
}

/**
 * Wraps the Blender interceptor (art/blender/build_ship.py) for the game:
 * scales it, finds its sockets, adds engine plumes and blinking lights.
 * Forward is -Z and up is +Y, as before, so the controller is unchanged.
 */
/**
 * `tint` paints the hull for another pilot. The player's model must be made
 * first: it adjusts the shared materials, and a tinted copy takes its own
 * copies of them so the player's ship is not repainted.
 */
export function createShipModel(source: THREE.Object3D, scale = SHIP_SCALE, tint: THREE.Color | null = null): ShipModel {
  const group = new THREE.Group();
  group.name = 'interceptor';
  const model = source.clone(true);
  model.scale.setScalar(scale);
  if (tint) {
    paintCopy(model, tint);
  }
  group.add(model);
  group.updateMatrixWorld(true);

  const local = (name: string) => group.worldToLocal(requireNode(model, name).getWorldPosition(new THREE.Vector3()));
  const engineGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.55, 1.1) });
  const navLights: THREE.MeshStandardMaterial[] = [];
  // Materials are shared by many parts; adjust each one exactly once.
  const adjusted = new Set<THREE.Material>();
  model.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) {
      return;
    }
    const material = node.material as THREE.MeshStandardMaterial;
    const firstVisit = !adjusted.has(material);
    adjusted.add(material);
    if (firstVisit && !tint && (material.name === 'Hull' || material.name === 'ArmourPlate' || material.name === 'DarkMachinery')) {
      // Space has almost nothing to reflect, so very metallic dark paint reads
      // as black. Lighten it slightly and make it more diffuse in the game.
      material.color.multiplyScalar(1.9);
      material.metalness = Math.min(material.metalness, 0.55);
      material.roughness = Math.max(material.roughness, 0.45);
    }
    if (material.name === 'EngineGlow') {
      // Our own HDR colour so brightness follows the throttle.
      node.material = engineGlow;
    } else if (firstVisit && material.name.startsWith('Nav')) {
      navLights.push(material);
    }
  });

  const plumeTexture = createConeGradientTexture([
    [0, 'rgba(255,255,255,1)'],
    [0.2, 'rgba(150,200,255,0.6)'],
    [1, 'rgba(0,0,0,0)'],
  ]);
  const engines: Engine[] = ENGINE_SOCKETS.map((name) => {
    const baseRadius = name.includes('main') ? NOZZLE_RADIUS.main : NOZZLE_RADIUS.pod;
    const geometry = new THREE.ConeGeometry(baseRadius, 1, 16, 1, true);
    // Base at the nozzle, tip trailing behind the ship (+Z).
    geometry.translate(0, 0.5, 0);
    geometry.rotateX(Math.PI / 2);
    const plume = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(0.7, 1.3, 2.6),
        map: plumeTexture,
        transparent: true,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: getGlowTexture(),
        color: new THREE.Color(0.25, 0.5, 1.0),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    const position = local(name);
    plume.position.copy(position);
    glow.position.copy(position);
    group.add(plume, glow);
    return { plume, glow, baseRadius };
  });

  let throttle = 0;
  let boost = false;
  return {
    group,
    gunPorts: [local('gun_L'), local('gun_R')],
    cockpit: local('cockpit'),
    setBank(yawRate, deltaSeconds) {
      const target = THREE.MathUtils.clamp(yawRate * 0.28, -0.55, 0.55);
      model.rotation.z += (target - model.rotation.z) * (1 - Math.exp(-6 * deltaSeconds));
    },
    setThrottle(level, boosting) {
      throttle = THREE.MathUtils.clamp(level, 0, 1);
      boost = boosting;
    },
    update(elapsedSeconds) {
      const flicker = 0.9 + Math.sin(elapsedSeconds * 47) * 0.05 + Math.sin(elapsedSeconds * 31) * 0.05;
      const length = (0.15 + throttle * (boost ? 1.6 : 0.8)) * flicker;
      for (const engine of engines) {
        engine.plume.scale.set(1, 1, length);
        (engine.plume.material as THREE.MeshBasicMaterial).opacity = 0.2 + throttle * 0.35;
        engine.glow.scale.setScalar(engine.baseRadius * (2 + throttle * (boost ? 3 : 1.6)));
        engine.glow.material.opacity = 0.25 + throttle * 0.35;
      }
      const intensity = 0.5 + throttle * (boost ? 1.2 : 0.6);
      engineGlow.color.setRGB(0.25 * intensity, 0.55 * intensity, 1.1 * intensity);
      // Navigation lights blink once a second.
      const blink = elapsedSeconds % 1 < 0.12 ? 1 : 0.15;
      for (const light of navLights) {
        light.emissiveIntensity = (light.name === 'NavWhite' ? 4 : 6) * blink;
      }
    },
  };
}

/** Gives a copy its own materials, with the hull paint shifted towards `tint`. */
function paintCopy(model: THREE.Object3D, tint: THREE.Color): void {
  const copies = new Map<THREE.Material, THREE.Material>();
  model.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) {
      return;
    }
    const original = node.material as THREE.MeshStandardMaterial;
    let copy = copies.get(original) as THREE.MeshStandardMaterial | undefined;
    if (!copy) {
      copy = original.clone();
      // Strong, slightly dark paint: pale tints wash out to grey under the sun.
      if (copy.name === 'ArmourPlate') {
        copy.color.lerp(tint.clone().multiplyScalar(0.55), 0.85);
      } else if (copy.name === 'Hull') {
        copy.color.lerp(tint.clone().multiplyScalar(0.22), 0.6);
      } else if (copy.name === 'Marking') {
        copy.color.copy(tint);
      }
      copies.set(original, copy);
    }
    node.material = copy;
  });
}
