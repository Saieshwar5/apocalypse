import type { RandomSource } from '../logic/random';

/**
 * Square scalar field that wraps on both axes, so textures built from it can
 * repeat without a visible edge.
 */
export class WrappedField {
  readonly data: Float32Array;

  constructor(readonly size: number) {
    this.data = new Float32Array(size * size);
  }

  index(x: number, y: number): number {
    const mask = this.size - 1;
    return ((y & mask) << Math.log2(this.size)) | (x & mask);
  }

  get(x: number, y: number): number {
    return this.data[this.index(x, y)];
  }

  /** Rescales all values to the 0..1 range. */
  normalise(): this {
    let min = Infinity;
    let max = -Infinity;
    for (const value of this.data) {
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    const range = Math.max(max - min, 1e-6);
    for (let index = 0; index < this.data.length; index += 1) {
      this.data[index] = (this.data[index] - min) / range;
    }
    return this;
  }

  /**
   * Calls `visit` for every texel within `radius` of a centre, wrapping at
   * the edges. `t` is the distance from the centre as a fraction of radius.
   */
  stamp(centreX: number, centreY: number, radius: number, visit: (index: number, t: number) => void): void {
    const reach = Math.ceil(radius);
    const originX = Math.round(centreX);
    const originY = Math.round(centreY);
    for (let dy = -reach; dy <= reach; dy += 1) {
      for (let dx = -reach; dx <= reach; dx += 1) {
        const distance = Math.hypot(originX + dx - centreX, originY + dy - centreY);
        if (distance < radius) {
          visit(this.index(originX + dx, originY + dy), distance / radius);
        }
      }
    }
  }
}

/**
 * Fractal value noise in 0..1 that tiles. `cells` is the number of lattice
 * cells across the field for the first octave; each octave doubles it.
 * `ridged` folds every octave around its midpoint, giving thin dark creases.
 */
export function tileableFractalNoise(
  size: number,
  cells: number,
  octaves: number,
  rng: RandomSource,
  ridged = false,
): WrappedField {
  const field = new WrappedField(size);
  let amplitude = 1;
  let octaveCells = cells;
  for (let octave = 0; octave < octaves && octaveCells <= size; octave += 1) {
    const lattice = new Float32Array(octaveCells * octaveCells);
    for (let index = 0; index < lattice.length; index += 1) {
      lattice[index] = rng();
    }
    const step = octaveCells / size;
    for (let y = 0; y < size; y += 1) {
      const fy = y * step;
      const y0 = Math.floor(fy);
      const y1 = (y0 + 1) % octaveCells;
      const ty = smooth(fy - y0);
      for (let x = 0; x < size; x += 1) {
        const fx = x * step;
        const x0 = Math.floor(fx);
        const x1 = (x0 + 1) % octaveCells;
        const tx = smooth(fx - x0);
        const top = lattice[y0 * octaveCells + x0] * (1 - tx) + lattice[y0 * octaveCells + x1] * tx;
        const bottom = lattice[y1 * octaveCells + x0] * (1 - tx) + lattice[y1 * octaveCells + x1] * tx;
        let value = top * (1 - ty) + bottom * ty;
        if (ridged) {
          value = Math.abs(value * 2 - 1);
        }
        field.data[y * size + x] += value * amplitude;
      }
    }
    amplitude *= 0.5;
    octaveCells *= 2;
  }
  return field.normalise();
}

function smooth(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}
