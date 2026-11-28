import * as THREE from 'three';

/** Direction from the planet towards its star; shared by lighting, shadows and the solar-storm shelter. */
export const SUN_DIRECTION = new THREE.Vector3(1, 0.25, 0.45).normalize();
