import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { compassPoint } from '../logic/navigation';

/**
 * A pilot who sees only the compass dot (not the true direction) turns
 * towards it: right for a dot on the right, nose up for a dot above. If the
 * compass ever mixed up left and right or up and down, this pilot would
 * spiral away instead of arriving ON TARGET.
 */
function followCompass(start: THREE.Quaternion, target: THREE.Vector3): { reached: boolean; seconds: number } {
  const orientation = start.clone();
  const step = 1 / 30;
  const turnRate = 2.0;
  const inverse = new THREE.Quaternion();
  for (let time = 0; time < 8; time += step) {
    const local = target.clone().applyQuaternion(inverse.copy(orientation).invert());
    const point = compassPoint(local.toArray());
    if (point.onTarget) {
      return { reached: true, seconds: time };
    }
    const length = Math.hypot(point.x, point.y) || 1;
    const rate = turnRate * Math.min(1, point.angle * 2);
    // Screen right is a turn about the ship's up axis (negative yaw); screen up is nose up (positive pitch).
    const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (-point.x / length) * rate * step);
    const pitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (-point.y / length) * rate * step);
    orientation.multiply(yaw).multiply(pitch).normalize();
  }
  return { reached: false, seconds: Infinity };
}

describe('following the compass', () => {
  it('brings the nose onto the objective from any starting orientation', () => {
    let seed = 12345;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const target = new THREE.Vector3(30, -12, 50);
    const times: number[] = [];
    for (let trial = 0; trial < 200; trial += 1) {
      const start = new THREE.Quaternion(random() - 0.5, random() - 0.5, random() - 0.5, random() - 0.5).normalize();
      const result = followCompass(start, target);
      expect(result.reached).toBe(true);
      times.push(result.seconds);
    }
    // A half turn at two radians a second takes under two seconds; nothing should wander.
    expect(Math.max(...times)).toBeLessThan(3);
  });
});
