import * as THREE from 'three';
import { getGlowTexture } from '../scene/glowTexture';
import {
  DRONE_OUTPUT,
  MARKETS,
  MISSILE_WORKSHOP,
  REFINERY,
  SHUTTLE,
  planShuttle,
  unitPrice,
  type Good,
  type ShuttleRoute,
  type Stock,
} from '../logic/stationEconomy';
import type { StationId } from '../logic/stations';

export interface StationMarketDependencies {
  /** Where each station is now; null when it is gone (Aegis destroyed). */
  positionOf: (station: StationId) => THREE.Vector3 | null;
  /** Aegis keeps its own fuel and missile stock (station code); the market reads and writes it. */
  aegisStock: () => { fuel: number; missiles: number } | null;
  aegisMissileCapacity: number;
}

interface Shuttle {
  route: ShuttleRoute;
  age: number;
  group: THREE.Group;
}

/**
 * Stock and prices at the four stations, Ceres's production and the
 * automatic shuttles that carry fuel and parts to whichever station is
 * shortest. Aegis also turns parts into missiles. Shuttles are visible:
 * small cargo craft flying an arc around the planet between stations.
 */
export class StationMarket {
  readonly group = new THREE.Group();
  private readonly stocks: Record<Exclude<StationId, 'aegis'>, Stock>;
  private aegisParts: number = MARKETS.aegis.start.parts;
  private shuttles: Shuttle[] = [];
  private shuttleTimer = SHUTTLE.intervalSeconds * 0.5;
  private workshopTimer = 0;
  private readonly bodyGeometry = new THREE.BoxGeometry(0.5, 0.3, 0.9);
  private readonly bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.6, roughness: 0.45 });
  private readonly glowMaterial = new THREE.SpriteMaterial({
    map: getGlowTexture(),
    color: new THREE.Color(1.6, 1.2, 0.6),
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  constructor(private readonly deps: StationMarketDependencies) {
    this.group.name = 'shuttles';
    this.stocks = { vulcan: { ...MARKETS.vulcan.start }, ceres: { ...MARKETS.ceres.start }, halo: { ...MARKETS.halo.start } };
  }

  reset(): void {
    this.stocks.vulcan = { ...MARKETS.vulcan.start };
    this.stocks.ceres = { ...MARKETS.ceres.start };
    this.stocks.halo = { ...MARKETS.halo.start };
    this.aegisParts = MARKETS.aegis.start.parts;
    for (const shuttle of this.shuttles) {
      shuttle.group.removeFromParent();
    }
    this.shuttles = [];
    this.shuttleTimer = SHUTTLE.intervalSeconds * 0.5;
    this.workshopTimer = 0;
  }

  stock(station: StationId, good: Good): number {
    if (station === 'aegis') {
      return good === 'fuel' ? (this.deps.aegisStock()?.fuel ?? 0) : this.aegisParts;
    }
    return this.stocks[station][good];
  }

  /** Adds (or with a negative amount, takes) goods, within the store's capacity. Returns the change made. */
  add(station: StationId, good: Good, amount: number): number {
    const capacity = MARKETS[station].capacity[good];
    const before = this.stock(station, good);
    const after = Math.min(capacity, Math.max(0, before + amount));
    if (station === 'aegis') {
      const aegis = this.deps.aegisStock();
      if (good === 'fuel' && aegis) {
        aegis.fuel = after;
      } else if (good === 'parts') {
        this.aegisParts = after;
      }
    } else {
      this.stocks[station][good] = after;
    }
    return after - before;
  }

  /** Every station's stock now. */
  snapshot(): Record<StationId, Stock> {
    return { aegis: { fuel: this.stock('aegis', 'fuel'), parts: this.aegisParts }, ...this.stocks } as Record<StationId, Stock>;
  }

  price(station: StationId, good: Good): number {
    return unitPrice(MARKETS[station].basePrice[good], this.stock(station, good), MARKETS[station].capacity[good]);
  }

  /** A hauled rock delivered to Ceres's intake is refined into fuel and parts. */
  refine(tonnes: number): { fuel: number; parts: number } {
    return { fuel: this.add('ceres', 'fuel', tonnes * REFINERY.fuelPerTonne), parts: this.add('ceres', 'parts', tonnes * REFINERY.partsPerTonne) };
  }

  update(deltaSeconds: number): void {
    this.add('ceres', 'fuel', DRONE_OUTPUT.fuel * deltaSeconds);
    this.add('ceres', 'parts', DRONE_OUTPUT.parts * deltaSeconds);
    this.runWorkshop(deltaSeconds);
    this.dispatchShuttles(deltaSeconds);
    this.flyShuttles(deltaSeconds);
  }

  /** Aegis builds missiles from parts while it has parts and room in its store. */
  private runWorkshop(deltaSeconds: number): void {
    const aegis = this.deps.aegisStock();
    if (!aegis || aegis.missiles >= this.deps.aegisMissileCapacity || this.aegisParts < MISSILE_WORKSHOP.partsPerMissile) {
      this.workshopTimer = 0;
      return;
    }
    this.workshopTimer += deltaSeconds;
    if (this.workshopTimer >= MISSILE_WORKSHOP.secondsPerMissile) {
      this.workshopTimer = 0;
      this.aegisParts -= MISSILE_WORKSHOP.partsPerMissile;
      aegis.missiles += 1;
    }
  }

  private dispatchShuttles(deltaSeconds: number): void {
    this.shuttleTimer -= deltaSeconds;
    if (this.shuttleTimer > 0) {
      return;
    }
    this.shuttleTimer = SHUTTLE.intervalSeconds;
    const route = planShuttle(this.snapshot());
    if (!route || !this.deps.positionOf(route.to)) {
      return;
    }
    this.add(route.from, route.good, -route.amount);
    const group = new THREE.Group();
    const body = new THREE.Mesh(this.bodyGeometry, this.bodyMaterial);
    const glow = new THREE.Sprite(this.glowMaterial);
    glow.scale.setScalar(0.8);
    glow.position.z = 0.55;
    group.add(body, glow);
    this.group.add(group);
    this.shuttles.push({ route, age: 0, group });
  }

  /** Each shuttle follows an arc around the planet, never a straight line through it. */
  private flyShuttles(deltaSeconds: number): void {
    for (const shuttle of [...this.shuttles]) {
      shuttle.age += deltaSeconds;
      const from = this.deps.positionOf(shuttle.route.from);
      const to = this.deps.positionOf(shuttle.route.to);
      const t = Math.min(1, shuttle.age / SHUTTLE.travelSeconds);
      if (!from || !to || t >= 1) {
        if (to) {
          this.add(shuttle.route.to, shuttle.route.good, shuttle.route.amount);
        }
        shuttle.group.removeFromParent();
        this.shuttles = this.shuttles.filter((candidate) => candidate !== shuttle);
        continue;
      }
      const eased = t * t * (3 - 2 * t);
      const position = arcPoint(from, to, eased);
      const ahead = arcPoint(from, to, Math.min(1, eased + 0.01));
      shuttle.group.position.copy(position);
      shuttle.group.lookAt(ahead);
      // lookAt points +Z at the target; the shuttle's nose is -Z.
      shuttle.group.rotateY(Math.PI);
    }
  }
}

/** A point between two positions that turns around the planet and blends the heights. */
function arcPoint(from: THREE.Vector3, to: THREE.Vector3, t: number): THREE.Vector3 {
  const a = from.clone().normalize();
  const b = to.clone().normalize();
  const angle = a.angleTo(b);
  const radius = THREE.MathUtils.lerp(from.length(), to.length(), t) + Math.sin(Math.PI * t) * 6;
  if (angle < 1e-4) {
    return a.multiplyScalar(radius);
  }
  const sin = Math.sin(angle);
  return a
    .multiplyScalar(Math.sin((1 - t) * angle) / sin)
    .add(b.multiplyScalar(Math.sin(t * angle) / sin))
    .normalize()
    .multiplyScalar(radius);
}
