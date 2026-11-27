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
import { PRICES, buyUnits, emergencyFuel, type Wallet } from '../logic/economy';
import { formatCredits } from '../logic/contracts';
import { formatSpeed } from '../logic/units';
import type { ShipController } from '../ship/shipController';
import type { MissileLauncher } from '../weapons/missileLauncher';
import type { SpaceStation } from './spaceStation';

export type DockingState = 'free' | 'approach' | 'docked';

const RELAUNCH_COOLDOWN = 6;
const LAUNCH_SPEED = 7;
/** The station's solid core, in world units, for bumping into it. */
const STATION_BODY_RADIUS = 1.7;
const STATION_LABEL = 'Aegis';

export interface DockingDependencies {
  ship: ShipController;
  station: SpaceStation;
  missiles: MissileLauncher;
  sound: SoundEffects;
  hud: Hud;
  cameraRig: CameraRig;
  /** The pilot pays for fuel, missiles and hull repairs. */
  wallet: Wallet;
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
  /** What this visit has cost so far. */
  private bill = 0;
  private emergencyFuelGiven = 0;
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
      this.bill = 0;
      this.emergencyFuelGiven = 0;
      sound.dockClamp();
      cameraRig.addShake(0.45);
      hud.showMessage(
        `Docking clamps engaged. Fuel ${formatCredits(PRICES.fuelPerUnit)} a unit, missiles ${formatCredits(PRICES.missile)}, hull ${formatCredits(PRICES.hullPerPoint)} a point`,
        'success',
        4,
      );
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
    const { wallet } = this.deps;
    const fuelWanted = drawFromStock(station.stock.fuel, Math.min(SERVICE_RATE.fuel * service.rate * deltaSeconds, ship.fuelCapacity - ship.fuel));
    // A pilot who cannot pay still gets enough fuel to fly: the Authority covers it.
    const freeFuel = wallet.balance < PRICES.fuelPerUnit ? emergencyFuel(ship.fuel, fuelWanted) : 0;
    const boughtFuel = buyUnits(fuelWanted - freeFuel, PRICES.fuelPerUnit, wallet.balance);
    this.charge(boughtFuel.cost);
    this.emergencyFuelGiven += freeFuel;
    ship.fuel += freeFuel + boughtFuel.units;
    station.stock.fuel -= freeFuel + boughtFuel.units;

    this.missileProgress += SERVICE_RATE.missilesPerSecond * service.rate * deltaSeconds;
    // Fuel and hull come first: missiles are only bought with what is left over.
    const reserved = (ship.fuelCapacity - ship.fuel) * PRICES.fuelPerUnit + (HULL_CAPACITY - ship.hull) * PRICES.hullPerPoint;
    const canAffordMissile = wallet.balance - Math.max(0, reserved) >= PRICES.missile;
    if (service.missiles && this.missileProgress >= 1 && missiles.ammunition < missiles.capacity && station.stock.missiles >= 1 && canAffordMissile) {
      this.missileProgress = 0;
      const loaded = missiles.resupply(1);
      station.stock.missiles -= loaded;
      this.charge(loaded * PRICES.missile);
      sound.warningBeep(false);
    }
    const hull = buyUnits(Math.min(SERVICE_RATE.hull * service.rate * deltaSeconds, HULL_CAPACITY - ship.hull), PRICES.hullPerPoint, wallet.balance);
    this.charge(hull.cost);
    ship.repair(hull.units, SERVICE_RATE.shield * deltaSeconds);

    const broke = wallet.balance < PRICES.fuelPerUnit;
    const fuelDone = ship.fuel >= ship.fuelCapacity - 0.01 || station.stock.fuel <= 0 || (broke && freeFuel <= 0);
    const missilesDone =
      missiles.ammunition >= missiles.capacity || station.stock.missiles < 1 || !service.missiles || wallet.balance < PRICES.missile;
    const hullDone = ship.hull >= HULL_CAPACITY || broke;
    const done = fuelDone && missilesDone && hullDone && ship.shield >= ship.shieldCapacity - 0.01;
    const status = `fuel ${Math.round((ship.fuel / ship.fuelCapacity) * 100)}% · missiles ${missiles.ammunition}/${missiles.capacity} · hull ${Math.round(ship.hull)}% · bill ${formatCredits(this.bill)}`;
    const shortOfMoney = !canAffordMissile && missiles.ammunition < missiles.capacity ? ' · no money for missiles' : '';
    this.hint = done
      ? `Serviced: ${status}${shortOfMoney} · W launches`
      : `Docked: ${status} · W launches early`;

    if (wantsLaunch && this.timer > 1) {
      const outward = new THREE.Vector3(0, 0, -1).applyQuaternion(pose.orientation);
      ship.velocity.copy(station.velocity).addScaledVector(outward, LAUNCH_SPEED);
      this.state = 'free';
      this.cooldown = RELAUNCH_COOLDOWN;
      this.hint = null;
      sound.dockClamp();
      const covered = this.emergencyFuelGiven > 0.5 ? ` Emergency fuel covered by the Authority: ${Math.round(this.emergencyFuelGiven)} units.` : '';
      hud.showMessage(`Clamps released. ${STATION_LABEL} bill: ${formatCredits(this.bill)}.${covered}`, 'info', 3.5);
    }
  }

  private charge(amount: number): void {
    if (amount > 0 && this.deps.wallet.spend(amount)) {
      this.bill += amount;
    }
  }
}
