import * as THREE from 'three';
import { EARTH_RADIUS, type Earth } from '../scene/earth';
import { getGlowTexture } from '../scene/glowTexture';
import type { SpaceStation } from './spaceStation';

/** Long enough that a pilot can escort it through a field. */
export const FLIGHT_SECONDS = 32;

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
    // Big enough to see and to escort.
    this.group.scale.setScalar(2.5);
    this.group.visible = false;
  }

  get inFlight(): boolean {
    return this.progress < 1;
  }

  get position(): THREE.Vector3 {
    return this.group.position;
  }

  /** Seconds of flight left, or 0 when not flying. */
  get secondsLeft(): number {
    return this.inFlight ? (1 - this.progress) * FLIGHT_SECONDS : 0;
  }

  /** Where the rocket will be after `secondsAhead`, with the station carried along its orbit meanwhile. */
  positionAhead(secondsAhead: number): THREE.Vector3 {
    const progress = Math.min(1, this.progress + secondsAhead / FLIGHT_SECONDS);
    return this.pathPoint(progress, this.station.position.clone().addScaledVector(this.station.velocity, secondsAhead));
  }

  private pathPoint(progress: number, target: THREE.Vector3 = this.station.position): THREE.Vector3 {
    const eased = progress * progress * (3 - 2 * progress);
    const direction = this.start.clone().normalize().lerp(target.clone().normalize(), eased).normalize();
    const radius = THREE.MathUtils.lerp(this.start.length(), target.length(), Math.sqrt(progress));
    return direction.multiplyScalar(radius);
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
    // Climb straight up first, then arc over to meet the station.
    const previous = this.group.position.clone();
    this.group.position.copy(this.pathPoint(this.progress));
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
