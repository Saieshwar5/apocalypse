import * as THREE from 'three';
import type { CircularOrbit } from '../logic/satellites';
import { DebrisCloud, createFragmentGeometry, createFragmentMaterial, type DebrisKind } from './debrisCloud';

/** Clouds thinner than this (tonnes) have dispersed and are removed. */
const DISPERSED_MASS = 0.3;

/**
 * Every debris cloud in orbit, sharing one clock with the satellites so a
 * wreck stays on its satellite's orbit. Clouds are added by destroyed
 * satellites and by rocks shattered in orbit; their masses are changed by
 * the Cascade (drag, growth) and by the pilot's sweeping.
 */
export class DebrisField {
  readonly group = new THREE.Group();
  private readonly geometry = createFragmentGeometry();
  private readonly material = createFragmentMaterial();
  private list: DebrisCloud[] = [];

  constructor(private readonly rng: () => number) {
    this.group.name = 'debris';
  }

  get clouds(): readonly DebrisCloud[] {
    return this.list;
  }

  get totalMass(): number {
    return this.list.reduce((sum, cloud) => sum + cloud.mass, 0);
  }

  /** Adds a cloud on `orbit`; `clock` is the shared orbit clock now. */
  add(orbit: CircularOrbit, mass: number, kind: DebrisKind, clock: number): DebrisCloud {
    const cloud = new DebrisCloud(this.geometry, this.material, orbit, this.rng, mass, kind);
    cloud.update(clock, 0);
    this.list.push(cloud);
    this.group.add(cloud.mesh);
    return cloud;
  }

  update(clock: number, deltaSeconds: number): void {
    for (const cloud of this.list) {
      cloud.update(clock, deltaSeconds);
    }
    const dispersed = this.list.filter((cloud) => cloud.mass < DISPERSED_MASS);
    for (const cloud of dispersed) {
      cloud.dispose();
    }
    if (dispersed.length > 0) {
      this.list = this.list.filter((cloud) => cloud.mass >= DISPERSED_MASS);
    }
  }

  reset(): void {
    for (const cloud of this.list) {
      cloud.dispose();
    }
    this.list = [];
  }

  dispose(): void {
    this.reset();
    this.geometry.dispose();
    this.material.dispose();
  }
}
