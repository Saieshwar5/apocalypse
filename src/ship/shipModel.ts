import * as THREE from 'three';

/**
 * Procedurally modelled interceptor. Forward is -Z, up is +Y, roughly 1.7
 * units long. A real glTF model can replace this later without changing the
 * controller, which only moves `group`.
 */
export interface ShipModel {
  group: THREE.Group;
  /** Local positions bolts leave from (left, right). */
  gunPorts: [THREE.Vector3, THREE.Vector3];
  setThrottle(level: number, boosting: boolean): void;
  update(elapsedSeconds: number): void;
}

const HULL = new THREE.MeshStandardMaterial({ color: 0xc3c8d0, metalness: 0.75, roughness: 0.3 });
const DARK_PANEL = new THREE.MeshStandardMaterial({ color: 0x2a2f37, metalness: 0.6, roughness: 0.45 });
const ACCENT = new THREE.MeshStandardMaterial({ color: 0xb8461f, metalness: 0.4, roughness: 0.5 });
const CANOPY = new THREE.MeshPhysicalMaterial({
  color: 0x0a1726,
  metalness: 0.3,
  roughness: 0.05,
  clearcoat: 1,
  emissive: new THREE.Color(0.02, 0.06, 0.1),
});

export function createShipModel(): ShipModel {
  const group = new THREE.Group();
  group.name = 'interceptor';

  const body = new THREE.Mesh(createFuselageGeometry(), HULL);
  group.add(body);

  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.9), DARK_PANEL);
  spine.position.set(0, 0.2, 0.25);
  group.add(spine);

  const canopy = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), CANOPY);
  canopy.scale.set(0.12, 0.09, 0.3);
  canopy.position.set(0, 0.16, -0.25);
  group.add(canopy);

  const rightWing = new THREE.Mesh(createWingGeometry(), HULL);
  const leftWing = rightWing.clone();
  leftWing.scale.x = -1;
  group.add(rightWing, leftWing);

  for (const side of [-1, 1]) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.012, 0.06), ACCENT);
    stripe.position.set(side * 0.55, 0.026, 0.36);
    stripe.rotation.y = side * -0.55;
    group.add(stripe);

    const fin = new THREE.Mesh(createFinGeometry(), DARK_PANEL);
    fin.position.set(side * 0.16, 0.12, 0.45);
    fin.rotation.z = side * -0.35;
    group.add(fin);

    const cannon = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.024, 0.5, 10), DARK_PANEL);
    cannon.rotation.x = Math.PI / 2;
    cannon.position.set(side * 0.46, -0.02, 0.0);
    group.add(cannon);

    const navLight = new THREE.Mesh(
      new THREE.SphereGeometry(0.025, 10, 8),
      new THREE.MeshBasicMaterial({ color: side < 0 ? new THREE.Color(6, 0.3, 0.2) : new THREE.Color(0.3, 6, 0.6) }),
    );
    navLight.position.set(side * 0.82, 0.02, 0.6);
    group.add(navLight);
  }

  const plumeTexture = createPlumeTexture();
  const exhausts: THREE.Mesh[] = [];
  const nozzleGlows: THREE.MeshBasicMaterial[] = [];
  for (const side of [-1, 1]) {
    const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.1, 0.42, 20), DARK_PANEL);
    engine.rotation.x = Math.PI / 2;
    engine.position.set(side * 0.13, -0.02, 0.62);
    group.add(engine);

    const glowMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 0.7, 1.4) });
    nozzleGlows.push(glowMaterial);
    const nozzle = new THREE.Mesh(new THREE.CircleGeometry(0.075, 20), glowMaterial);
    nozzle.position.set(side * 0.13, -0.02, 0.835);
    group.add(nozzle);

    const plume = new THREE.Mesh(
      createPlumeGeometry(),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(0.7, 1.3, 2.6),
        map: plumeTexture,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    plume.position.set(side * 0.13, -0.02, 0.84);
    exhausts.push(plume);
    group.add(plume);
  }

  let throttle = 0;
  let boost = false;
  return {
    group,
    gunPorts: [new THREE.Vector3(-0.46, -0.02, -0.26), new THREE.Vector3(0.46, -0.02, -0.26)],
    setThrottle(level, boosting) {
      throttle = THREE.MathUtils.clamp(level, 0, 1);
      boost = boosting;
    },
    update(elapsedSeconds) {
      const flicker = 0.9 + Math.sin(elapsedSeconds * 47) * 0.05 + Math.sin(elapsedSeconds * 31) * 0.05;
      const length = (0.25 + throttle * (boost ? 2.6 : 1.3)) * flicker;
      for (const plume of exhausts) {
        plume.scale.set(1, 1, length);
        (plume.material as THREE.MeshBasicMaterial).opacity = 0.15 + throttle * 0.3;
      }
      const intensity = 0.5 + throttle * (boost ? 1.2 : 0.7);
      for (const glow of nozzleGlows) {
        glow.color.setRGB(0.35 * intensity, 0.7 * intensity, 1.4 * intensity);
      }
    },
  };
}

function createFuselageGeometry(): THREE.BufferGeometry {
  const profile = [
    [0.0, -0.86],
    [0.15, -0.84],
    [0.21, -0.62],
    [0.23, -0.2],
    [0.215, 0.2],
    [0.16, 0.5],
    [0.085, 0.72],
    [0.03, 0.84],
    [0.0, 0.88],
  ].map(([radius, y]) => new THREE.Vector2(radius, y));
  const geometry = new THREE.LatheGeometry(profile, 32);
  geometry.scale(1, 1, 0.72);
  // Lathe builds along +Y; turn it so the nose points along -Z.
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

/** Swept right wing, laid flat; the left wing is a mirrored copy. */
function createWingGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0.15, -0.25);
  shape.lineTo(0.82, 0.42);
  shape.lineTo(0.84, 0.66);
  shape.lineTo(0.15, 0.6);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.035,
    bevelEnabled: true,
    bevelThickness: 0.01,
    bevelSize: 0.01,
    bevelSegments: 2,
  });
  // Shape Y becomes world +Z (towards the tail); extrusion becomes thickness.
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, 0.02, 0);
  return geometry;
}

function createFinGeometry(): THREE.BufferGeometry {
  // Shape X runs along the hull (towards the tail), shape Y is height.
  const shape = new THREE.Shape();
  shape.moveTo(-0.15, 0);
  shape.lineTo(0.22, 0);
  shape.lineTo(0.28, 0.3);
  shape.lineTo(0.14, 0.3);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: false });
  // Rotating -90 degrees about Y maps shape X to +Z and the extrusion to -X.
  geometry.rotateY(-Math.PI / 2);
  geometry.translate(0.01, 0, 0);
  return geometry;
}

/** Cone whose base sits at the nozzle and whose tip points backwards (+Z). */
function createPlumeGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.ConeGeometry(0.07, 0.8, 16, 1, true);
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, 0, 0.4);
  return geometry;
}

/**
 * Bright at the nozzle, fading to nothing at the tip. Cone UVs run from 0 at
 * the base to 1 at the tip, and canvas textures are flipped, so the bottom of
 * the canvas is the nozzle end.
 */
function createPlumeTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createLinearGradient(0, 128, 0, 0);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.25, 'rgba(160,200,255,0.55)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 4, 128);
  }
  return new THREE.CanvasTexture(canvas);
}
