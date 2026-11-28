import * as THREE from 'three';
import type { SoundEffects } from '../audio/soundEffects';
import type { Hud } from '../hud/hud';
import type { InputState } from '../input/inputState';
import { formatCredits, formatPrice } from '../logic/contracts';
import { buyUnits, type Wallet } from '../logic/economy';
import { HULL_CAPACITY } from '../logic/shipDefense';
import { SERVICE_RATE } from '../logic/stationSupply';
import type { ShipController } from '../ship/shipController';
import type { Outpost, Outposts } from '../station/outposts';
import type { StationMarket } from './stationMarket';

/** Berth within this distance of a station's port, nearly stopped relative to it. */
const BERTH = { range: 7, maxRelativeSpeed: 3, holdSeconds: 1.2, launchSpeed: 5, cooldown: 5 } as const;
/** Vulcan Yard repairs hulls more cheaply than Aegis. */
const YARD_HULL_PRICE = 2;

export interface OutpostBerthDependencies {
  outposts: Outposts;
  market: StationMarket;
  ship: ShipController;
  input: InputState;
  wallet: Wallet;
  hud: Hud;
  sound: SoundEffects;
}

/**
 * Berthing at Vulcan Yard, Ceres Works and Halo: stop beside a station's
 * port with the controls released and the ship is held there, moving with
 * the station, while it buys fuel at the local price (cheapest at Ceres) and,
 * at Vulcan, cheaper hull repairs. W launches.
 */
export class OutpostBerths {
  /** Line for the bottom of the HUD while berthed or close, or null. */
  hint: string | null = null;
  private berth: Outpost | null = null;
  private readonly offset = new THREE.Vector3();
  private readonly hold = new THREE.Quaternion();
  private still = 0;
  private cooldown = 0;
  private bill = 0;

  constructor(private readonly deps: OutpostBerthDependencies) {}

  get holding(): boolean {
    return this.berth !== null;
  }

  /** Which outpost the ship is berthed at, or null. */
  get berthedAt(): Outpost['id'] | null {
    return this.berth?.id ?? null;
  }

  reset(): void {
    this.berth = null;
    this.hint = null;
    this.still = 0;
    this.cooldown = 0;
  }

  /** `pilotBusy`: thrusting or firing; berthing waits until the controls are released. */
  update(deltaSeconds: number, active: boolean, pilotBusy: boolean): void {
    this.cooldown = Math.max(0, this.cooldown - deltaSeconds);
    if (!active) {
      this.reset();
      return;
    }
    if (this.berth) {
      this.held(this.berth, deltaSeconds);
      return;
    }
    this.hint = null;
    const { outposts, ship } = this.deps;
    for (const outpost of outposts.list) {
      const port = outpost.port.getWorldPosition(new THREE.Vector3());
      const distance = port.distanceTo(ship.position);
      if (distance > BERTH.range * 2.5) {
        continue;
      }
      const relativeSpeed = ship.velocity.distanceTo(outpost.velocity);
      const close = distance <= BERTH.range && relativeSpeed <= BERTH.maxRelativeSpeed;
      this.hint = close
        ? pilotBusy
          ? `${outpost.name}: release the controls to berth`
          : `${outpost.name}: berthing…`
        : `${outpost.name}: come within ${Math.round(BERTH.range)} units of the port and brake to berth`;
      this.still = close && !pilotBusy && this.cooldown <= 0 ? this.still + deltaSeconds : 0;
      if (this.still >= BERTH.holdSeconds) {
        this.berthAt(outpost);
      }
      return;
    }
    this.still = 0;
  }

  private berthAt(outpost: Outpost): void {
    const { ship, hud, sound } = this.deps;
    this.berth = outpost;
    this.bill = 0;
    this.offset.copy(ship.position);
    outpost.group.worldToLocal(this.offset);
    this.hold.copy(outpost.group.quaternion).invert().multiply(ship.object.quaternion);
    sound.dockClamp();
    const yard = outpost.id === 'vulcan' ? `, hull ${formatCredits(YARD_HULL_PRICE)} a point` : '';
    hud.showMessage(`Berthed at ${outpost.name}. Fuel ${formatPrice(this.deps.market.price(outpost.id, 'fuel'))} a unit${yard}`, 'success', 3.5);
  }

  private held(outpost: Outpost, deltaSeconds: number): void {
    const { ship, input, wallet, market, sound, hud } = this.deps;
    ship.position.copy(this.offset);
    outpost.group.localToWorld(ship.position);
    ship.object.quaternion.copy(outpost.group.quaternion).multiply(this.hold);
    ship.velocity.copy(outpost.velocity);

    // Fuel at the local price, from the station's own store.
    const price = market.price(outpost.id, 'fuel');
    const wanted = Math.min(SERVICE_RATE.fuel * deltaSeconds, ship.fuelCapacity - ship.fuel, market.stock(outpost.id, 'fuel'));
    const fuel = buyUnits(wanted, price, wallet.balance);
    if (fuel.units > 0 && wallet.spend(fuel.cost)) {
      ship.fuel += fuel.units;
      market.add(outpost.id, 'fuel', -fuel.units);
      this.bill += fuel.cost;
    }
    if (outpost.id === 'vulcan') {
      const hull = buyUnits(Math.min(SERVICE_RATE.hull * deltaSeconds, HULL_CAPACITY - ship.hull), YARD_HULL_PRICE, wallet.balance);
      if (hull.units > 0 && wallet.spend(hull.cost)) {
        ship.repair(hull.units, 0);
        this.bill += hull.cost;
      }
    }
    ship.repair(0, SERVICE_RATE.shield * deltaSeconds);
    this.hint = `Berthed at ${outpost.name}: fuel ${Math.round((ship.fuel / ship.fuelCapacity) * 100)}% at ${formatPrice(price)} · hull ${Math.round(ship.hull)}% · bill ${formatCredits(this.bill)} · W launches`;

    if (input.isDown('KeyW')) {
      const away = ship.forward();
      ship.velocity.copy(outpost.velocity).addScaledVector(away, BERTH.launchSpeed);
      this.berth = null;
      this.cooldown = BERTH.cooldown;
      this.hint = null;
      sound.dockClamp();
      hud.showMessage(`Left ${outpost.name}. Bill: ${formatCredits(this.bill)}`, 'info', 2.5);
    }
  }
}
