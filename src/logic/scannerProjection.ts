import type { Vec3Tuple } from './random';

export interface ScannerPoint {
  /** Where the contact's stalk meets the disc. */
  baseX: number;
  baseY: number;
  /** The contact itself, at the end of its stalk. */
  x: number;
  y: number;
  /** True when the contact is above the ship's wing plane. */
  above: boolean;
  /** True when beyond the scanner's range (drawn at the rim). */
  beyondRange: boolean;
}

/** Vertical squash of the disc: how much it is tilted towards the viewer. */
export const SCANNER_TILT = 0.42;
/** Pixels of stalk per unit of height, relative to the disc radius. */
const STALK_SCALE = 0.8;

/**
 * Projects a contact onto the 3D scanner. `local` is the contact's position
 * in the ship's frame (x right, y up, z backwards). The disc is the ship's
 * wing plane seen from behind and above: ahead is up the screen, and a stalk
 * rises or hangs from the disc to show height. Distance is compressed with a
 * square root so nearby contacts spread out.
 */
export function projectToScanner(local: Vec3Tuple, range: number, discRadius: number): ScannerPoint {
  const distance = Math.hypot(local[0], local[1], local[2]);
  if (distance === 0) {
    return { baseX: 0, baseY: 0, x: 0, y: 0, above: true, beyondRange: false };
  }
  const scaled = (Math.sqrt(Math.min(distance / range, 1)) * discRadius) / distance;
  const baseX = local[0] * scaled;
  const baseY = local[2] * scaled * SCANNER_TILT;
  return {
    baseX,
    baseY,
    x: baseX,
    y: baseY - local[1] * scaled * STALK_SCALE,
    above: local[1] >= 0,
    beyondRange: distance > range,
  };
}
