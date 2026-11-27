import * as THREE from 'three';
import { siteCondition, type SiteCondition } from '../logic/prioritySites';
import { EARTH_RADIUS, type Earth } from '../scene/earth';
import type { SiteDefence, SiteState } from './siteDefence';

const CONDITION_COLOR: Record<SiteCondition, THREE.Color> = {
  intact: new THREE.Color(0.35, 1.6, 0.8),
  damaged: new THREE.Color(2.0, 1.2, 0.3),
  critical: new THREE.Color(2.6, 0.4, 0.25),
  destroyed: new THREE.Color(0.35, 0.08, 0.06),
};

export interface SiteLabel {
  site: SiteState;
  world: THREE.Vector3;
  condition: SiteCondition;
}

/**
 * Glowing rings on the globe at each priority site. They are fixed to the
 * surface, so they turn with the planet; colour shows the site's condition
 * and a threatened site pulses.
 */
export class SiteMarkers {
  private readonly rings = new Map<string, { outer: THREE.Mesh; dot: THREE.Mesh }>();
  private elapsed = 0;

  constructor(
    private readonly earth: Earth,
    private readonly defence: SiteDefence,
  ) {
    this.rebuild();
  }

  /** Recreates the rings; call after the site list changes. */
  rebuild(): void {
    for (const marker of this.rings.values()) {
      for (const mesh of [marker.outer, marker.dot]) {
        mesh.parent?.remove(mesh);
        (mesh.material as THREE.Material).dispose();
      }
    }
    this.rings.clear();
    const { earth, defence } = this;
    const ringGeometry = new THREE.RingGeometry(0.2, 0.26, 40);
    const dotGeometry = new THREE.CircleGeometry(0.07, 20);
    for (const site of defence.sites) {
      const material = () =>
        new THREE.MeshBasicMaterial({
          transparent: true,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
      const outer = new THREE.Mesh(ringGeometry, material());
      const dot = new THREE.Mesh(dotGeometry, material());
      for (const mesh of [outer, dot]) {
        // Just above the cloud layer so clouds never hide a marker.
        mesh.position.copy(site.localDirection).multiplyScalar(EARTH_RADIUS * 1.012);
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), site.localDirection);
        earth.attachToSurface(mesh);
      }
      this.rings.set(site.definition.id, { outer, dot });
    }
  }

  update(deltaSeconds: number): void {
    this.elapsed += deltaSeconds;
    for (const site of this.defence.sites) {
      const marker = this.rings.get(site.definition.id);
      if (!marker) {
        continue;
      }
      const condition = siteCondition(site.health);
      const threatened = site.threatenedIn !== null && site.health > 0;
      const pulse = threatened ? 1 + 0.5 * Math.sin(this.elapsed * 9) : 1;
      const color = threatened ? CONDITION_COLOR.critical : CONDITION_COLOR[condition];
      for (const mesh of [marker.outer, marker.dot]) {
        const material = mesh.material as THREE.MeshBasicMaterial;
        material.color.copy(color).multiplyScalar(threatened ? 0.8 + 0.6 * pulse : 1);
        material.opacity = condition === 'destroyed' ? 0.7 : 0.95;
      }
      marker.outer.scale.setScalar(threatened ? 1 + 0.35 * pulse : 1);
    }
  }

  /** Label anchors for sites on the side of the planet facing the camera. */
  visibleLabels(cameraPosition: THREE.Vector3): SiteLabel[] {
    const labels: SiteLabel[] = [];
    for (const site of this.defence.sites) {
      const world = this.earth.localToWorldDirection(site.localDirection).multiplyScalar(EARTH_RADIUS * 1.012);
      // Facing the camera when the surface normal points towards it, with a
      // margin so labels disappear before they reach the limb.
      const toCamera = cameraPosition.clone().sub(world).normalize();
      if (toCamera.dot(world.clone().normalize()) > 0.12) {
        labels.push({ site, world, condition: siteCondition(site.health) });
      }
    }
    return labels;
  }
}
