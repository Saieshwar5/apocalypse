import * as THREE from 'three';
import type { CombatFeedback } from '../hud/combatFeedback';
import { ASTEROID_CLASSES, MATERIAL_TRAITS } from '../logic/asteroidClasses';
import { burnsUp, threatRating, type ThreatRating } from '../logic/planetDamage';
import type { Asteroid } from './asteroidField';

/** Seconds of holding the reticle near an asteroid to identify it. */
const SCAN_SECONDS = 1.6;
const SCAN_RANGE = 110;
const SCAN_CONE = THREE.MathUtils.degToRad(9);
/** The Radar Station identifies anything that comes this close to the planet. */
const RADAR_COVERAGE = 40;
const RADAR_SCAN_SECONDS = 2.5;

export const RATING_LABEL: Record<ThreatRating, string> = {
  harmless: 'HARMLESS',
  low: 'LOW THREAT',
  moderate: 'MODERATE THREAT',
  severe: 'SEVERE THREAT',
};

export const RATING_COLOR: Record<ThreatRating, string> = {
  harmless: '#7f8c9e',
  low: '#7dffb0',
  moderate: '#ffb347',
  severe: '#ff5a4a',
};

export function ratingOf(asteroid: Asteroid): ThreatRating {
  return threatRating(asteroid.size, asteroid.material, asteroid.timeToImpact === null);
}

/**
 * Asteroids arrive as unknown contacts. Pointing the ship at one scans it;
 * the Radar Station does the same for anything close to the planet. Once
 * identified, its type and real danger are known, so a big harmless rubble
 * pile can be told from a small, dense iron body.
 */
export function updateIdentification(
  deltaSeconds: number,
  shipPosition: THREE.Vector3,
  shipForward: THREE.Vector3,
  asteroids: readonly Asteroid[],
  radarStanding: boolean,
  scanning: boolean,
  feedback: CombatFeedback,
): void {
  const offset = new THREE.Vector3();
  for (const asteroid of asteroids) {
    if (!asteroid.identified) {
      offset.copy(asteroid.mesh.position).sub(shipPosition);
      const distance = offset.length();
      const angle = shipForward.angleTo(offset) - Math.atan2(asteroid.radius, Math.max(distance, 0.01));
      if (scanning && distance < SCAN_RANGE && angle < SCAN_CONE) {
        asteroid.scanProgress += deltaSeconds / SCAN_SECONDS;
      } else if (radarStanding && asteroid.mesh.position.length() < RADAR_COVERAGE) {
        asteroid.scanProgress += deltaSeconds / RADAR_SCAN_SECONDS;
      }
      if (asteroid.scanProgress >= 1) {
        asteroid.identified = true;
        const rating = ratingOf(asteroid);
        feedback.note(
          asteroid.mesh.position,
          `${MATERIAL_TRAITS[asteroid.material].label.toUpperCase()} · ${RATING_LABEL[rating]}`,
          RATING_COLOR[rating],
        );
      }
    }
    // Until identified, plan for an ordinary stony body of that size.
    asteroid.assessedDamage = asteroid.identified
      ? burnsUp(asteroid.size, asteroid.material)
        ? 0
        : asteroid.planetDamage
      : ASTEROID_CLASSES[asteroid.size].planetDamage;
  }
}
