import type * as THREE from 'three';
import { deliveryStep, deliveryTitle, type DeliveryStep } from '../logic/delivery';
import type { SpeakerId } from '../logic/cast';
import { PLACEMENT } from '../logic/towing';
import type { SatelliteFleet } from '../satellites/satelliteFleet';
import type { Outposts } from '../station/outposts';
import type { HaulWork } from './haulWork';
import type { RescueWork } from './rescueWork';
import { escapePoint, secondsToStrike } from './satelliteJobHelpers';
import type { SatelliteWork } from './satelliteWork';
import type { TowLine } from './towLine';

/** What a job says about the load on the line and where it goes. */
export interface DeliverySource {
  /** "WX-2 CIRRUS", "9.6 t rock", "the escape pod". */
  load: string;
  /** "Vulcan Yard cradle", "Ceres Works intake"... */
  place: string;
  /** Centre of the drop zone and how it moves. */
  world: THREE.Vector3;
  velocity: THREE.Vector3;
  /** Release inside this distance, slower than this relative speed. */
  radius: number;
  maxSpeed: number;
  loadPosition: THREE.Vector3;
  loadVelocity: THREE.Vector3;
  /** A fragile load's condition in percent, or null. */
  condition: number | null;
  /** Who on the radio is waiting for it. */
  contact: SpeakerId;
  /** A dodge: held out of a rock's path instead of dropped. Seconds until the rock arrives, or null once it has passed. */
  dodge?: { strikeSeconds: number | null };
}

export interface Delivery extends DeliverySource {
  /** "Towing WX-2 CIRRUS (87%) → Vulcan Yard cradle". */
  title: string;
  step: DeliveryStep;
  /** Distance from the load to the centre of the drop zone. */
  distance: number;
}

/**
 * Whatever is on the player's tow line, described the same way: a faulty
 * satellite bound for Vulcan's cradle, a repaired or sinking one bound for
 * its orbit slot, one being held out of a rock's path, a haul rock for
 * Ceres, or an escape pod for Halo.
 */
export function currentDelivery(tow: TowLine, work: SatelliteWork, haul: HaulWork, rescue: RescueWork, fleet: SatelliteFleet, outposts: Outposts): Delivery | null {
  const source = satelliteDelivery(tow, work, fleet, outposts) ?? haul.delivery() ?? rescue.delivery();
  if (!source) {
    return null;
  }
  const distance = source.loadPosition.distanceTo(source.world);
  const step = deliveryStep({
    distance,
    radius: source.radius,
    speed: source.loadVelocity.distanceTo(source.velocity),
    maxSpeed: source.maxSpeed,
    dodge: source.dodge,
  });
  return { ...source, title: deliveryTitle(source.load, source.place, source.condition), step, distance };
}

function satelliteDelivery(tow: TowLine, work: SatelliteWork, fleet: SatelliteFleet, outposts: Outposts): DeliverySource | null {
  const satellite = tow.load;
  const job = satellite ? work.jobInfo(satellite) : null;
  if (!satellite || !job) {
    return null;
  }
  const base = {
    load: satellite.name,
    radius: PLACEMENT.radius,
    maxSpeed: PLACEMENT.maxSpeed,
    loadPosition: satellite.position,
    loadVelocity: satellite.velocity,
    condition: satellite.condition,
  };
  if (job.kind === 'repair-tow' && !job.ready) {
    return { ...base, place: 'Vulcan Yard cradle', world: outposts.portPosition('vulcan'), velocity: outposts.get('vulcan').velocity, contact: 'vulcan' };
  }
  const slot = fleet.slot(satellite);
  if (job.kind === 'dodge' && !job.ready && job.asteroid) {
    return {
      ...base,
      place: "clear of the rock's path",
      world: escapePoint(satellite, job.asteroid),
      velocity: slot.velocity,
      contact: 'control',
      dodge: { strikeSeconds: secondsToStrike(job.asteroid, satellite) },
    };
  }
  return { ...base, place: 'its orbit slot', world: slot.position, velocity: slot.velocity, contact: job.kind === 'repair-tow' ? 'vulcan' : 'control' };
}
