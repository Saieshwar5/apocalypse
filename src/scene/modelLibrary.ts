import type * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** 3D models built in Blender (see art/blender), loaded once at start-up. */
export interface ModelLibrary {
  interceptor: THREE.Object3D;
  booster: THREE.Object3D;
  launchPad: THREE.Object3D;
}

export async function loadModels(): Promise<ModelLibrary> {
  const loader = new GLTFLoader();
  const base = `${import.meta.env.BASE_URL}models/`;
  const [interceptor, booster, launchPad] = await Promise.all(
    ['interceptor.glb', 'booster.glb', 'launchpad.glb'].map(async (file) => {
      try {
        return (await loader.loadAsync(`${base}${file}`)).scene;
      } catch (error) {
        throw new Error(`Could not load model ${file}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }),
  );
  return { interceptor, booster, launchPad };
}

/** Finds a socket (an empty placed in Blender) or fails loudly if the model changed. */
export function requireNode(root: THREE.Object3D, name: string): THREE.Object3D {
  const node = root.getObjectByName(name);
  if (!node) {
    throw new Error(`Model is missing the "${name}" socket; rebuild it with the scripts in art/blender`);
  }
  return node;
}
