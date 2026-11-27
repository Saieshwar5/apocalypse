import * as THREE from 'three';
import type { SoundEffects } from '../audio/soundEffects';
import type { CameraRig } from '../camera/cameraRig';
import type { Hud } from '../hud/hud';
import { HULL_CAPACITY } from '../logic/shipDefense';
import {
  DOCKING,
  SERVICE_RATE,
  dockingReadiness,
  drawFromStock,
} from '../logic/stationSupply';
import { stationService } from '../logic/stationDamage';
import { formatSpeed } from '../logic/units';
import type { ShipController } from '../ship/shipController';
import type { MissileLauncher } from '../weapons/missileLauncher';
import type { SpaceStation } from './spaceStation';

export type DockingState = 'free' | 'approach' | 'docked';

const RELAUNCH_COOLDOWN = 6;
const LAUNCH_SPEED = 7;
/** The station's solid core, in world units, for bumping into it. */
const STATION_BODY_RADIUS = 1.7;

export interface DockingDependencies {
  ship: ShipController;
  station: SpaceStation;
  missiles: MissileLauncher;
  sound: SoundEffects;
  hud: Hud;
  cameraRig: CameraRig;
}

/**
 * Automatic docking with the station. Flying in close and slow hands the
 * ship to the docking guides, which back it into the bay; clamps engage with
 * a thud, the station refuels, rearms and repairs the ship, and thrust (W)
 * launches it again. While this controller holds the ship the pilot cannot
 * steer or fire, and asteroids keep coming.
 */
export class DockingController {
  state: DockingState = 'free';
  /** Line for the bottom of the HUD, or null when there is nothing to say. */
  hint: string | null = null;
  private timer = 0;
  private cooldown = 0;
  private beepTimer = 0;
  private missileProgress = 0;
  private readonly startPosition = new THREE.Vector3();
  private readonly startOrientation = new THREE.Quaternion();

  constructor(private readonly deps: DockingDependencies) {}

  /** True while the docking guides or clamps control the ship. */
  get holdingShip(): boolean {
    return this.state !== 'free';
  }

  reset(): void {
    this.state = 'free';
    this.hint = null;
    this.timer = 0;
    this.cooldown = 0;
  }

  /**
   * `pilotBusy` is true while the pilot is thrusting or firing: the guides
   * only take the ship when the controls are released, so fighting near the
   * station never triggers a dock by accident.
   */
  update(deltaSeconds: number, wantsLaunch: boolean, shipActive: boolean, pilotBusy: boolean): void {
    this.cooldown = Math.max(0, this.cooldown - deltaSeconds);
    if (!shipActive) {
      this.state = 'free';
      this.hint = null;
      return;
    }
    if (this.deps.station.destroyed || !this.deps.station.group.visible) {
      if (this.state !== 'free') {
        // Thrown clear as the station breaks up.
        const { ship, station } = this.deps;
        ship.velocity.copy(station.velocity).addScaledVector(ship.forward(), LAUNCH_SPEED * 1.5);
        ship.applyDamage(60);
        this.state = 'free';
      }
      this.hint = null;
      return;
    }
    if (this.state === 'free') {
      this.updateFree(pilotBusy);
    } else if (this.state === 'approach') {
      this.updateApproach(deltaSeconds);
    } else {
      this.updateDocked(deltaSeconds, wantsLaunch);
    }
  }

  private updateFree(pilotBusy: boolean): void {
    const { ship, station, hud, sound } = this.deps;
    const offset = ship.position.clone().sub(station.position);
    const distance = offset.length();
    const relativeSpeed = ship.velocity.distanceTo(station.velocity);
    const readiness = this.cooldown > 0 ? 'far' : dockingReadiness(distance, relativeSpeed);
    this.hint =
      readiness === 'too-fast'
        ? distance > DOCKING.range
          ? `Aegis station: fly closer and brake (S) below ${formatSpeed(DOCKING.maxRelativeSpeed)} to dock`
          : `Too fast to dock: ${formatSpeed(relativeSpeed)}. Hold S to brake below ${formatSpeed(DOCKING.maxRelativeSpeed)}`
        : readiness === 'ready' && pilotBusy
          ? 'In docking range: release the controls to dock'
          : null;
    if (readiness === 'ready' && !pilotBusy) {
      this.state = 'approach';
      this.timer = 0;
      this.beepTimer = 0;
      this.startPosition.copy(ship.position);
      this.startOrientation.copy(ship.object.quaternion);
      hud.showMessage('Docking guides have the ship. Hands off', 'info', 3);
      sound.chime();
      return;
    }
    // Bump off the station's body instead of flying through it.
    if (distance < STATION_BODY_RADIUS && distance > 0) {
      const normal = offset.normalize();
      ship.position.copy(station.position).addScaledVector(normal, STATION_BODY_RADIUS);
      const inward = ship.velocity.clone().sub(station.velocity).dot(normal);
      if (inward < 0) {
        ship.velocity.addScaledVector(normal, -inward * 1.4);
      }
    }
  }

  private updateApproach(deltaSeconds: number): void {
    const { ship, station, sound, hud, cameraRig } = this.deps;
    this.timer += deltaSeconds;
    const progress = Math.min(1, this.timer / DOCKING.approachSeconds);
    const eased = progress * progress * (3 - 2 * progress);
    const pose = station.dockPose();
    // Line up outside the bay first, then slide straight back in.
    const outward = new THREE.Vector3(0, 0, -1).applyQuaternion(pose.orientation);
    const entry = pose.position.clone().addScaledVector(outward, 3 * (1 - eased));
    ship.position.lerpVectors(this.startPosition, entry, Math.min(1, eased * 1.6));
    ship.object.quaternion.slerpQuaternions(this.startOrientation, pose.orientation, Math.min(1, eased * 2));
    ship.velocity.copy(station.velocity);
    this.hint = 'Docking…';

    // Beeps speed up as the ship closes on the clamps.
    this.beepTimer -= deltaSeconds;
    if (this.beepTimer <= 0) {
      sound.warningBeep(false);
      this.beepTimer = 0.6 - 0.45 * progress;
    }
    if (progress >= 1) {
      this.state = 'docked';
      this.timer = 0;
      this.missileProgress = 0;
      sound.dockClamp();
      cameraRig.addShake(0.45);
      hud.showMessage('Docking clamps engaged. Refuelling and rearming', 'success', 3.5);
    }
  }

  private updateDocked(deltaSeconds: number, wantsLaunch: boolean): void {
    const { ship, station, missiles, sound, hud } = this.deps;
    this.timer += deltaSeconds;
    const pose = station.dockPose();
    ship.position.copy(pose.position);
    ship.object.quaternion.copy(pose.orientation);
    ship.velocity.copy(station.velocity);

    const service = stationService(station.defence.health);
    const fuel = drawFromStock(station.stock.fuel, Math.min(SERVICE_RATE.fuel * service.rate * deltaSeconds, ship.fuelCapacity - ship.fuel));
    ship.fuel += fuel;
    station.stock.fuel -= fuel;
    this.missileProgress += SERVICE_RATE.missilesPerSecond * service.rate * deltaSeconds;
    if (service.missiles && this.missileProgress >= 1 && missiles.ammunition < missiles.capacity && station.stock.missiles >= 1) {
      this.missileProgress = 0;
      station.stock.missiles -= missiles.resupply(1);
      sound.warningBeep(false);
    }
    ship.repair(SERVICE_RATE.hull * service.rate * deltaSeconds, SERVICE_RATE.shield * deltaSeconds);

    const fuelDone = ship.fuel >= ship.fuelCapacity - 0.01 || station.stock.fuel <= 0;
    const missilesDone = missiles.ammunition >= missiles.capacity || station.stock.missiles < 1 || !service.missiles;
    const done = fuelDone && missilesDone && ship.hull >= HULL_CAPACITY && ship.shield >= ship.shieldCapacity - 0.01;
    const status = `fuel ${Math.round((ship.fuel / ship.fuelCapacity) * 100)}% · missiles ${missiles.ammunition}/${missiles.capacity} · hull ${Math.round(ship.hull)}%`;
    this.hint = done ? `Service complete (${status}). Press W to launch` : `Docked: ${status}. Press W to launch early`;

    if (wantsLaunch && this.timer > 1) {
      const outward = new THREE.Vector3(0, 0, -1).applyQuaternion(pose.orientation);
      ship.velocity.copy(station.velocity).addScaledVector(outward, LAUNCH_SPEED);
      this.state = 'free';
      this.cooldown = RELAUNCH_COOLDOWN;
      this.hint = null;
      sound.dockClamp();
      hud.showMessage('Clamps released. Good hunting', 'info', 2.5);
    }
  }
}
