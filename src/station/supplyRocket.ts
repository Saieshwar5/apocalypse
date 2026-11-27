import * as THREE from 'three';
import { EARTH_RADIUS, type Earth } from '../scene/earth';
import { getGlowTexture } from '../scene/glowTexture';
import type { SpaceStation } from './spaceStation';

const FLIGHT_SECONDS = 22;

/**
 * The supply rocket that climbs from the Launch Complex to the station after
 * a wave. It is cosmetic transport for a real delivery: the station's stock
 * only grows when the rocket arrives, and no rocket flies once the Launch
 * Complex is lost.
 */
export class SupplyRocket {
  readonly group = new THREE.Group();
  private readonly flame: THREE.Sprite;
  private progress = 1;
  private readonly start = new THREE.Vector3();
  private onArrival: (() => void) | null = null;

  constructor(
    private readonly earth: Earth,
    private readonly station: SpaceStation,
  ) {
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, 0.6, 10),
      new THREE.MeshStandardMaterial({ color: 0xd9dadc, metalness: 0.2, roughness: 0.5 }),
    );
    const nose = new THREE.Mesh(
      new THREE.ConeGeometry(0.07, 0.2, 10),
      new THREE.MeshStandardMaterial({ color: 0xb8461f, metalness: 0.2, roughness: 0.5 }),
    );
    nose.position.y = 0.4;
    this.flame = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: getGlowTexture(),
        color: new THREE.Color(5, 2.6, 1),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.flame.position.y = -0.4;
    this.group.add(body, nose, this.flame);
    this.group.visible = false;
  }

  get inFlight(): boolean {
    return this.progress < 1;
  }

  get position(): THREE.Vector3 {
    return this.group.position;
  }

  launch(siteLocalDirection: THREE.Vector3, onArrival: () => void): void {
    this.start.copy(this.earth.localToWorldDirection(siteLocalDirection)).multiplyScalar(EARTH_RADIUS + 0.2);
    this.progress = 0;
    this.onArrival = onArrival;
    this.group.visible = true;
  }

  cancel(): void {
    this.progress = 1;
    this.onArrival = null;
    this.group.visible = false;
  }

  update(deltaSeconds: number): void {
    if (!this.inFlight) {
      return;
    }
    if (this.station.destroyed) {
      this.cancel();
      return;
    }
    this.progress = Math.min(1, this.progress + deltaSeconds / FLIGHT_SECONDS);
    const eased = this.progress * this.progress * (3 - 2 * this.progress);
    // Climb straight up first, then arc over to meet the station.
    const target = this.station.position;
    const direction = this.start.clone().normalize().lerp(target.clone().normalize(), eased).normalize();
    const radius = THREE.MathUtils.lerp(this.start.length(), target.length(), Math.sqrt(this.progress));
    const previous = this.group.position.clone();
    this.group.position.copy(direction).multiplyScalar(radius);
    const heading = this.group.position.clone().sub(previous);
    if (heading.lengthSq() > 1e-8) {
      this.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), heading.normalize());
    }
    this.flame.scale.setScalar(0.5 + Math.random() * 0.25);
    if (this.progress >= 1) {
      this.group.visible = false;
      this.onArrival?.();
      this.onArrival = null;
    }
  }
}
