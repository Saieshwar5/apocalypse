import * as THREE from 'three';
import type { AsteroidField } from '../asteroids/asteroidField';
import type { SoundEffects } from '../audio/soundEffects';
import type { CameraRig } from '../camera/cameraRig';
import type { Explosions } from '../effects/explosions';
import type { Hud } from '../hud/hud';
import type { InputState } from '../input/inputState';
import { LOW_FUEL } from '../logic/stationSupply';
import { damping } from '../math/orientation';
import type { Earth } from '../scene/earth';
import type { ShipController } from '../ship/shipController';
import type { MissileLauncher } from '../weapons/missileLauncher';
import { DockingController } from './dockingController';
import { SpaceStation } from './spaceStation';
import { StationDefence } from './stationDefence';
import { SupplyRocket } from './supplyRocket';

export const STATION_NAME = 'AEGIS';

export interface StationOperationsDependencies {
  scene: THREE.Scene;
  stationModel: THREE.Object3D;
  earth: Earth;
  ship: ShipController;
  missiles: MissileLauncher;
  field: AsteroidField;
  explosions: Explosions;
  sound: SoundEffects;
  hud: Hud;
  cameraRig: CameraRig;
  input: InputState;
}

/**
 * Everything about the Aegis station in one place for the play session: its
 * orbit and damage, docking, supply rockets, moving it from the tactical map
 * and what the HUD shows about it.
 */
export class StationOperations {
  readonly station: SpaceStation;
  readonly docking: DockingController;
  private readonly defence: StationDefence;
  private readonly rocket: SupplyRocket;
  private fuelWarned = false;

  constructor(private readonly deps: StationOperationsDependencies) {
    this.station = new SpaceStation(deps.stationModel);
    this.docking = new DockingController({
      ship: deps.ship,
      station: this.station,
      missiles: deps.missiles,
      sound: deps.sound,
      hud: deps.hud,
      cameraRig: deps.cameraRig,
    });
    this.defence = new StationDefence({
      station: this.station,
      field: deps.field,
      explosions: deps.explosions,
      sound: deps.sound,
      hud: deps.hud,
      cameraRig: deps.cameraRig,
      stationName: STATION_NAME,
    });
    this.rocket = new SupplyRocket(deps.earth, this.station);
    deps.scene.add(this.station.group, this.rocket.group);
  }

  /** The station still exists and has been placed in orbit. */
  get present(): boolean {
    return this.station.group.visible && !this.station.destroyed;
  }

  get holdingShip(): boolean {
    return this.docking.holdingShip;
  }

  reset(): void {
    this.docking.reset();
    this.station.hide();
    this.rocket.cancel();
    this.fuelWarned = false;
  }

  begin(): void {
    this.station.placeAheadOf(this.deps.ship.position, this.deps.ship.forward());
  }

  /** Moves the station and runs docking. `pilotBusy`: thrusting or firing. */
  update(deltaSeconds: number, active: boolean, tactical: boolean, pilotBusy: boolean): void {
    const { input, ship, hud } = this.deps;
    this.station.update(deltaSeconds, this.docking.state === 'approach');
    this.rocket.update(deltaSeconds);
    if (tactical && this.present) {
      for (const [code, direction] of [['KeyE', 1], ['KeyQ', -1]] as const) {
        if (input.consumePress(code)) {
          this.station.relocate(direction);
          hud.showMessage(`${STATION_NAME} moving ${direction > 0 ? 'ahead' : 'back'} along its orbit`, 'info', 2.5);
        }
      }
    }
    const wantsLaunch = !tactical && input.isDown('KeyW');
    this.docking.update(deltaSeconds, wantsLaunch, active, pilotBusy);
    if (ship.fuel < LOW_FUEL && !this.fuelWarned && this.present) {
      hud.showMessage(`Fuel low. Dock at ${STATION_NAME} to refuel`, 'warning', 4);
    }
    this.fuelWarned = ship.fuel < LOW_FUEL;
  }

  /** Asteroid strikes and collision-course flags. Call after site threats are marked. */
  updateThreats(): void {
    this.defence.update(this.deps.ship.position);
  }

  /** After a wave: a supply rocket flies up if the Launch Complex can send one. */
  sendSupplies(launchSite: THREE.Vector3 | null): string {
    if (this.station.destroyed) {
      return '';
    }
    if (!launchSite) {
      return ' No supply: Launch Complex lost.';
    }
    this.rocket.launch(launchSite, () => {
      this.station.receiveSupplies();
      this.deps.hud.showMessage(`Supply rocket docked at ${STATION_NAME}: stock replenished`, 'success', 3.5);
      this.deps.sound.chime();
    });
    return ` Supply rocket launched to ${STATION_NAME}.`;
  }

  /** Outside view of the bay while the ship is being docked and serviced. */
  followDockedShip(camera: THREE.PerspectiveCamera, deltaSeconds: number): void {
    const pose = this.station.dockPose();
    const offset = new THREE.Vector3(3.2, 1.6, -7.5).applyQuaternion(pose.orientation);
    const position = camera.position.clone().lerp(pose.position.clone().add(offset), damping(2.5, deltaSeconds));
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(pose.orientation);
    this.deps.cameraRig.place(position, this.deps.ship.position, up, deltaSeconds);
  }

  hudInfo() {
    const { station } = this;
    return {
      distance: this.present ? this.deps.ship.position.distanceTo(station.position) : null,
      docked: this.docking.state === 'docked',
      destroyed: station.destroyed,
      stock: station.stock,
      shield: station.defence.shield,
      health: station.defence.health,
      threatenedIn: this.defence.threatenedIn,
    };
  }

  /** Markers for the overlay: the station, its commanded destination and any supply rocket. */
  markers(): { world: THREE.Vector3; name: string; ghost: boolean }[] {
    if (!this.present) {
      return [];
    }
    const list = [{ world: this.station.position, name: STATION_NAME, ghost: false }];
    if (this.station.relocating) {
      list.push({ world: this.station.destination(), name: `${STATION_NAME} moving here`, ghost: true });
    }
    if (this.rocket.inFlight) {
      list.push({ world: this.rocket.position, name: 'SUPPLY', ghost: true });
    }
    return list;
  }
}
