import * as THREE from 'three';

export interface CockpitReadings {
  speedKmS: number;
  fuel: number;
  hull: number;
  shield: number;
  missiles: string;
  /** Short status words: THRUST, BRAKING, BERTHED... */
  status: string;
  /** Top line of the contract board, or the next job. */
  job: string;
  alert: boolean;
}

const SCREEN = { width: 256, height: 128 } as const;
const REFRESH_SECONDS = 0.2;

/**
 * The cockpit seen from the pilot's seat: canopy frame, a dashboard with
 * three live screens (flight, systems, job), lit switches and the HUD
 * combiner glass. It hangs from the camera, so it stays fixed in view
 * while the ship turns, and it is lit by the scene's sun and earthshine.
 */
export class CockpitInterior {
  readonly group = new THREE.Group();
  private readonly screens: { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture; draw: (context: CanvasRenderingContext2D, readings: CockpitReadings) => void }[] = [];
  private readonly warning: THREE.MeshBasicMaterial;
  private refresh = 0;
  private time = 0;

  constructor() {
    this.group.visible = false;
    const frame = new THREE.MeshStandardMaterial({ color: 0x1b1f26, metalness: 0.6, roughness: 0.45 });
    const panel = new THREE.MeshStandardMaterial({ color: 0x14171c, metalness: 0.3, roughness: 0.7 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x3a4250, metalness: 0.8, roughness: 0.3 });

    // Canopy: two pillars rising from the dashboard corners and a bow across the top.
    const pillar = (side: number) => {
      const from = new THREE.Vector3(side * 0.62, -0.2, -0.5);
      const to = new THREE.Vector3(side * 0.26, 0.36, -0.46);
      const length = from.distanceTo(to);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.045, length, 0.03), frame);
      mesh.position.copy(from).add(to).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
      return mesh;
    };
    const bow = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.035, 0.03), frame);
    bow.position.set(0, 0.36, -0.46);
    const spine = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.2, 0.02), frame);
    spine.position.set(0, 0.45, -0.42);
    this.group.add(pillar(-1), pillar(1), bow, spine);

    // Dashboard: a sloped panel with a trim edge along the top.
    const dash = new THREE.Group();
    dash.position.set(0, -0.215, -0.5);
    dash.rotation.x = -0.75;
    const face = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.2, 0.02), panel);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.012, 0.03), trim);
    edge.position.y = 0.1;
    dash.add(face, edge);
    this.group.add(dash);

    const addScreen = (x: number, width: number, draw: (context: CanvasRenderingContext2D, readings: CockpitReadings) => void) => {
      const canvas = document.createElement('canvas');
      canvas.width = SCREEN.width;
      canvas.height = SCREEN.height;
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 2), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
      screen.position.set(x, 0.005, 0.012);
      const bezel = new THREE.Mesh(new THREE.BoxGeometry(width + 0.014, width / 2 + 0.014, 0.008), trim);
      bezel.position.set(x, 0.005, 0.008);
      dash.add(bezel, screen);
      this.screens.push({ canvas, texture, draw });
    };
    addScreen(-0.36, 0.2, drawFlight);
    addScreen(0, 0.2, drawSystems);
    addScreen(0.36, 0.2, drawJob);

    // Rows of small lit switches under the screens.
    const switchColors = [0x6dff9a, 0x5fd8ff, 0xffc46b];
    for (let index = 0; index < 18; index += 1) {
      const lamp = new THREE.Mesh(
        new THREE.BoxGeometry(0.012, 0.008, 0.006),
        new THREE.MeshBasicMaterial({ color: switchColors[index % 3], toneMapped: false }),
      );
      lamp.position.set(-0.56 + (index % 9) * 0.03 + (index >= 9 ? 0.84 : 0), -0.075, 0.014);
      dash.add(lamp);
    }
    // Master caution lamp: flashes when something needs the pilot now.
    this.warning = new THREE.MeshBasicMaterial({ color: 0x401010, toneMapped: false });
    const caution = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.022, 0.008), this.warning);
    caution.position.set(0, 0.075, 0.014);
    dash.add(caution);

    // HUD combiner glass: a faint tinted pane with a thin frame, above the dashboard.
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(0.2, 0.12),
      new THREE.MeshBasicMaterial({ color: 0x5dffb0, transparent: true, opacity: 0.012, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    glass.position.set(0, -0.07, -0.47);
    glass.rotation.x = -0.15;
    const glassFrame = new THREE.LineSegments(new THREE.EdgesGeometry(glass.geometry), new THREE.LineBasicMaterial({ color: 0x2c3440 }));
    glassFrame.position.copy(glass.position);
    glassFrame.rotation.copy(glass.rotation);
    // The pane itself is nearly invisible; its frame shows where the combiner sits.
    glass.visible = false;
    this.group.add(glass, glassFrame);
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  update(deltaSeconds: number, readings: CockpitReadings): void {
    if (!this.group.visible) {
      return;
    }
    this.time += deltaSeconds;
    this.warning.color.setHex(readings.alert && this.time % 0.8 < 0.4 ? 0xff3b2e : 0x401010);
    this.refresh -= deltaSeconds;
    if (this.refresh > 0) {
      return;
    }
    this.refresh = REFRESH_SECONDS;
    for (const screen of this.screens) {
      const context = screen.canvas.getContext('2d');
      if (!context) {
        continue;
      }
      context.fillStyle = '#04090f';
      context.fillRect(0, 0, SCREEN.width, SCREEN.height);
      screen.draw(context, readings);
      // Scan lines for a little depth.
      context.fillStyle = 'rgba(0, 0, 0, 0.18)';
      for (let y = 0; y < SCREEN.height; y += 3) {
        context.fillRect(0, y, SCREEN.width, 1);
      }
      screen.texture.needsUpdate = true;
    }
  }
}

function label(context: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string): void {
  context.font = `600 ${size}px ui-monospace, Menlo, monospace`;
  context.fillStyle = color;
  context.fillText(text, x, y);
}

function bar(context: CanvasRenderingContext2D, y: number, name: string, value: number, color: string): void {
  label(context, name, 14, y + 10, 14, '#7f93aa');
  context.fillStyle = 'rgba(255,255,255,0.08)';
  context.fillRect(80, y, 160, 12);
  context.fillStyle = value < 25 ? '#ff5a4a' : color;
  context.fillRect(80, y, (160 * Math.max(0, Math.min(100, value))) / 100, 12);
}

function drawFlight(context: CanvasRenderingContext2D, readings: CockpitReadings): void {
  label(context, 'FLIGHT', 14, 22, 14, '#5fd8ff');
  label(context, readings.speedKmS.toFixed(1), 14, 82, 52, '#e8f6ff');
  label(context, 'km/s', 150, 82, 18, '#7f93aa');
  label(context, readings.status, 14, 114, 16, readings.alert ? '#ff8a7a' : '#7dffb0');
}

function drawSystems(context: CanvasRenderingContext2D, readings: CockpitReadings): void {
  label(context, 'SYSTEMS', 14, 22, 14, '#5fd8ff');
  bar(context, 36, 'FUEL', readings.fuel, '#7dffb0');
  bar(context, 58, 'SHIELD', readings.shield, '#5fd8ff');
  bar(context, 80, 'HULL', readings.hull, '#ffd36a');
  label(context, `MSL ${readings.missiles}`, 14, 118, 16, '#e8f6ff');
}

function drawJob(context: CanvasRenderingContext2D, readings: CockpitReadings): void {
  label(context, 'BOARD', 14, 22, 14, '#5fd8ff');
  const words = readings.job.toUpperCase().split(' ');
  let line = '';
  let y = 50;
  for (const word of words) {
    if ((line + word).length > 20) {
      label(context, line, 14, y, 16, '#ffd36a');
      line = '';
      y += 22;
      if (y > 118) {
        return;
      }
    }
    line += `${word} `;
  }
  label(context, line, 14, y, 16, '#ffd36a');
}
