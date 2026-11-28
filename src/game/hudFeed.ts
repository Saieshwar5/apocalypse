import * as THREE from 'three';
import type { Asteroid } from '../asteroids/asteroidField';
import { SCANNER_RANGE } from '../hud/radar';
import { altitudeReadout } from '../logic/atmosphere';
import { EARTH_RADIUS } from '../scene/earth';
import { AIM_DISTANCE, type PlaySession } from './playSession';

/**
 * Feeds the HUD, the scanner and the target overlay from the play session
 * each frame: everything the pilot sees on top of the 3D view.
 */
export function feedHud(play: PlaySession, deltaSeconds: number, ranked: readonly Asteroid[], showTargets = true): void {
  const { hud, radar, overlay, ship, shipModel, session, camera } = play.deps;
  const delivery = play.services.delivery();
  hud.update(deltaSeconds, {
    integrity: session.integrity,
    orbitHealth: play.services.debris.health,
    licence: { summary: play.licence.summary, stage: play.licence.stage },
    wave: Math.max(1, play.campaign.director.wave),
    focus: { calm: play.campaign.director.phase !== 'field', tactical: play.tactical },
    missileCapacity: play.missiles.capacity,
    fuelCapacity: ship.fuelCapacity,
    shieldCapacity: ship.shieldCapacity,
    balance: session.wallet.balance,
    earned: session.wallet.earned,
    league: session.leagueRows(),
    contracts: play.contracts.listings(ranked),
    jobs: play.services.jobRows(),
    contractSummary: play.contracts.summary(play.campaign.director.phase === 'field'),
    laserHeat: play.laser.heat,
    overheated: play.laser.overheated,
    missiles: play.missiles.ammunition,
    boost: ship.boostEnergy,
    shield: ship.shield,
    hull: ship.hull,
    speed: ship.velocity.length(),
    shipPosition: ship.position,
    fuel: ship.fuel,
    station: play.stationOps.hudInfo(),
    altitude: altitudeReadout(ship.position.length(), EARTH_RADIUS),
    zone: play.hazards.zone,
    sites: play.sites.sites,
    controls: {
      mouseCaptured: play.deps.input.pointerLocked,
      assist: ship.assist,
      autopilot: play.hazards.pullingUp ? 'AUTO PULL-UP' : play.hazards.returning ? 'AUTOPILOT RETURNING' : play.autopilotLabel,
      thrusting: play.deps.input.isDown('KeyW'),
      braking: play.deps.input.isDown('KeyS'),
      berthed: play.stationOps.holdingShip || play.services.berths.holding,
    },
    tow: delivery ? { title: delivery.title, step: delivery.step.state === 'travel' ? `${delivery.step.text} · T lets go` : delivery.step.text, state: delivery.step.state } : null,
  });
  const range = (play.sites.isStanding('radar') ? SCANNER_RANGE : SCANNER_RANGE / 2) * play.satellites.scannerBonus * play.services.weather.scannerFactor * play.services.cities.watchFactor;
  const urgent = new Set(ranked.slice(0, 3).filter((threat) => threat.timeToImpact !== null).map((threat) => threat.id));
  radar.draw(deltaSeconds, shipModel.group, play.field.all, urgent, play.missiles.lockedTarget?.id ?? null, EARTH_RADIUS, range, play.stationOps.present ? play.stationOps.station.position : null, play.campaign.scannerBlind, play.satellites.positions(), play.services.radarContacts());
  if (!showTargets || !play.shipActive || !play.targeting || play.stationOps.holdingShip) {
    overlay.clear();
    return;
  }
  camera.updateMatrixWorld();
  overlay.draw(deltaSeconds, {
    camera,
    aimPoint: new THREE.Vector3(0, 0, -AIM_DISTANCE).applyMatrix4(shipModel.group.matrixWorld),
    overheated: play.laser.overheated,
    ranked,
    targeting: play.targeting,
    feedback: play.feedback,
    tactical: play.tactical,
    shipPosition: ship.position,
    sites: play.siteMarkers.visibleLabels(camera.position),
    stationMarkers: [...play.stationOps.markers(), ...play.services.markers()],
    guidance: {
      guidance: play.guidance,
      satellites: play.satellites.all,
      shipPosition: ship.position,
      shipVelocity: ship.velocity,
      showDrift: !ship.assist,
      priorityPay: play.guidance.priority ? play.contracts.offerFor(play.guidance.priority.item) : 0,
      waypoint: play.campaign.training.waypoint() ?? play.services.waypoint(),
      debris: play.services.debris.labels(ship.position),
      priorityEstimate: play.guidance.priority ? !play.guidance.priority.item.identified : false,
    },
  });
}
