import type * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** 3D models built in Blender (see art/blender), loaded once at start-up. */
export interface ModelLibrary {
  interceptor: THREE.Object3D;
  booster: THREE.Object3D;
  launchPad: THREE.Object3D;
  station: THREE.Object3D;
  /** Three roots in one file: Sat_Comms, Sat_Nav and Sat_Weather. */
  satellites: THREE.Object3D;
  /** The outposts: Vulcan Yard, Ceres Works and Halo. */
  vulcan: THREE.Object3D;
  ceres: THREE.Object3D;
  halo: THREE.Object3D;
}

export async function loadModels(): Promise<ModelLibrary> {
  const loader = new GLTFLoader();
  const base = `${import.meta.env.BASE_URL}models/`;
  const [interceptor, booster, launchPad, station, satellites, vulcan, ceres, halo] = await Promise.all(
    ['interceptor.glb', 'booster.glb', 'launchpad.glb', 'station.glb', 'satellites.glb', 'vulcan.glb', 'ceres.glb', 'halo.glb'].map(async (file) => {
      try {
        return (await loader.loadAsync(`${base}${file}`)).scene;
      } catch (error) {
        throw new Error(`Could not load model ${file}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }),
  );
  return { interceptor, booster, launchPad, station, satellites, vulcan, ceres, halo };
}

/** Finds a socket (an empty placed in Blender) or fails loudly if the model changed. */
export function requireNode(root: THREE.Object3D, name: string): THREE.Object3D {
  const node = root.getObjectByName(name);
  if (!node) {
    throw new Error(`Model is missing the "${name}" socket; rebuild it with the scripts in art/blender`);
  }
  return node;
}
