import * as THREE from 'three';
import type { Hud } from '../hud/hud';
import type { InputState } from '../input/inputState';
import { SWEEP } from '../logic/cascade';
import { NAV_GROUP_TAG, bearingArrow, sortNavEntries, type NavGroup } from '../logic/flightDirector';
import { arrivalSeconds, compassPoint } from '../logic/navigation';
import { ORBIT_TIERS, orbitTransfers } from '../logic/orbits';
import { DOCKING } from '../logic/stationSupply';
import { TOW } from '../logic/towing';
import { formatCountdown, formatDistance } from '../logic/units';
import type { DebrisCloud } from '../satellites/debrisCloud';
import type { ShipController } from '../ship/shipController';
import type { PlaySession } from './playSession';

export interface NavEntry {
  /** Stable id: the same satellite keeps its id while it exists. */
  id: string;
  group: NavGroup;
  label: string;
  world: THREE.Vector3;
  /** Null when the point carries no velocity of its own (a job waypoint). */
  velocity: THREE.Vector3 | null;
  distance: number;
  /** Relative speed to arrive at, and how close counts as arrived. */
  arriveSpeed: number;
  arriveRange: number;
}

export interface NavComputerDependencies {
  play: PlaySession;
  ship: ShipController;
  input: InputState;
  hud: Hud;
}

const PAGE = 9;
const REFRESH_SECONDS = 0.25;
const BERTH_SPEED = 3;

/**
 * The navigation computer (N): a list of everything worth flying to, jobs
 * first, each with its distance, a direction arrow and arrival time. A
 * number key makes it the nav target, which the compass, flight director,
 * route line and scanner then follow until the pilot picks something else.
 */
export class NavComputer {
  /** The picked target's id, or null. */
  selected: string | null = null;
  private page = -1;
  /** Beside the tactical map the list stays open and picking keeps it open. */
  private pinned = false;
  private entries: NavEntry[] = [];
  private refresh = 0;
  private readonly cloudIds = new WeakMap<DebrisCloud, number>();
  private nextCloudId = 1;
  private readonly panel = find('#nav-computer');
  private readonly list = find('#nav-list');
  private readonly pageLabel = find('#nav-page');
  private readonly caption = find('#nav-caption');

  constructor(private readonly deps: NavComputerDependencies) {}

  get open(): boolean {
    return this.page >= 0;
  }

  reset(): void {
    this.selected = null;
    this.close();
  }

  /** The picked target as it is this frame, or null if it no longer exists. */
  current(): NavEntry | null {
    if (!this.selected) {
      return null;
    }
    return this.build().find((entry) => entry.id === this.selected) ?? null;
  }

  /** Entries on the page now showing, numbered from 1, for the number tags in the world. */
  visibleEntries(): { number: number; entry: NavEntry; selected: boolean }[] {
    if (!this.open) {
      return [];
    }
    return this.entries
      .slice(this.page * PAGE, this.page * PAGE + PAGE)
      .map((entry, index) => ({ number: index + 1, entry, selected: entry.id === this.selected }));
  }

  /**
   * Keys and the panel. Returns the id of a newly picked target, 'cleared'
   * when the pilot cleared it, or null. `onMap`: the tactical map is open,
   * so the list sits beside it and stays open.
   */
  update(deltaSeconds: number, allowed: boolean, onMap = false): string | null {
    const { input } = this.deps;
    if (!allowed) {
      this.pinned = false;
      this.close();
      return null;
    }
    if (onMap !== this.pinned) {
      this.pinned = onMap;
      this.page = onMap ? 0 : -1;
      this.entries = this.build();
      this.refresh = 0;
      this.panel.classList.toggle('on-map', onMap);
      this.caption.textContent = onMap ? 'Number key sets the destination · 0 clears it · Tab returns to the cockpit' : 'Number key sets the target · 0 clears it · U autopilot';
    }
    if (input.consumePress('KeyN')) {
      this.entries = this.build();
      const pages = Math.max(1, Math.ceil(this.entries.length / PAGE));
      this.page = this.page + 1 >= pages ? (this.pinned ? 0 : -1) : this.page + 1;
      this.refresh = 0;
    }
    if (!this.open) {
      this.panel.hidden = true;
      return null;
    }
    let picked: string | null = null;
    for (let digit = 0; digit <= PAGE; digit += 1) {
      if (!input.consumePress(`Digit${digit}`)) {
        continue;
      }
      if (digit === 0) {
        this.selected = null;
        picked = 'cleared';
      } else {
        const entry = this.entries[this.page * PAGE + digit - 1];
        if (entry) {
          this.selected = entry.id;
          picked = entry.id;
        }
      }
      if (this.pinned) {
        this.refresh = 0;
      } else {
        this.close();
      }
      return picked;
    }
    this.refresh -= deltaSeconds;
    if (this.refresh <= 0) {
      this.refresh = REFRESH_SECONDS;
      this.entries = this.build();
      this.render();
    }
    return null;
  }

  close(): void {
    this.page = -1;
    this.panel.hidden = true;
  }

  /** Everything worth flying to, sorted: jobs, stations, satellites, pilots, debris. */
  build(): NavEntry[] {
    const { play, ship } = this.deps;
    const entries: Omit<NavEntry, 'distance'>[] = [];
    const jobText = play.services.jobRows().map((row) => `${row.title} ${row.detail}`).join(' | ');
    const waypoint = play.services.waypoint();
    // A waypoint that is simply "go to this satellite" is already in the list as that satellite's job.
    const sameAsSatellite = waypoint !== null && play.satellites.all.some((satellite) => satellite.alive && jobText.includes(satellite.name) && satellite.position.distanceTo(waypoint.world) < 2);
    if (waypoint && !sameAsSatellite) {
      entries.push({ id: `job:${waypoint.label}`, group: 'job', label: waypoint.label, world: waypoint.world, velocity: null, arriveSpeed: waypoint.arrive?.speed ?? TOW.attachSpeed, arriveRange: waypoint.arrive?.range ?? 8 });
    }
    const aegis = play.stationOps.whereabouts();
    if (aegis) {
      // Inside docking range, so arriving hands straight over to the docking guides.
      entries.push({ id: 'aegis', group: 'station', label: 'AEGIS (home)', world: aegis.position, velocity: aegis.velocity, arriveSpeed: DOCKING.maxRelativeSpeed - 1, arriveRange: DOCKING.range - 3 });
    }
    for (const outpost of play.services.outposts.list) {
      // Aim at the port, where the berth takes the ship.
      entries.push({
        id: `station:${outpost.id}`,
        group: 'station',
        label: outpost.name,
        world: play.services.outposts.portPosition(outpost.id),
        velocity: outpost.velocity,
        arriveSpeed: BERTH_SPEED - 0.5,
        arriveRange: 4,
      });
    }
    // The three orbits, straight up or down from here: a change of height and nothing else.
    for (const transfer of orbitTransfers(ship.position.toArray())) {
      entries.push({
        id: `orbit:${transfer.tier}`,
        group: 'orbit',
        label: `${ORBIT_TIERS[transfer.tier].name.toUpperCase()} · ${transfer.way === 'here' ? 'you are here' : `${transfer.way} ${formatDistance(transfer.height)}`}`,
        world: new THREE.Vector3(...transfer.point),
        velocity: null,
        arriveSpeed: 4,
        arriveRange: 6,
      });
    }
    for (const satellite of play.satellites.all) {
      if (!satellite.alive) {
        continue;
      }
      // A satellite named in a contract is listed with the jobs.
      const row = play.services.jobRows().find((job) => job.title.includes(satellite.name) || job.detail.includes(satellite.name));
      entries.push({
        id: `sat:${satellite.id}`,
        group: jobText.includes(satellite.name) ? 'job' : 'satellite',
        label: row ? `${row.title}` : satellite.name,
        world: satellite.position,
        velocity: satellite.velocity,
        // Close and slow enough to connect the tow line on arrival.
        arriveSpeed: TOW.attachSpeed - 0.8,
        arriveRange: satellite.radius + TOW.attachRange - 1.5,
      });
    }
    for (const rival of play.services.rivals.rivals) {
      entries.push({ id: `pilot:${rival.definition.id}`, group: 'pilot', label: rival.definition.name, world: rival.ship.position, velocity: rival.ship.velocity, arriveSpeed: 5, arriveRange: 10 });
    }
    const clouds = [...play.satellites.fleet.debris.clouds].filter((cloud) => cloud.mass >= 1).sort((a, b) => b.mass - a.mass).slice(0, 3);
    for (const cloud of clouds) {
      entries.push({
        id: `cloud:${this.cloudId(cloud)}`,
        group: 'debris',
        label: `Debris ${cloud.mass.toFixed(1)} t`,
        world: cloud.position,
        velocity: cloud.velocity,
        arriveSpeed: SWEEP.maxRelativeSpeed - 1,
        arriveRange: cloud.radius,
      });
    }
    return sortNavEntries(entries.map((entry) => ({ ...entry, distance: entry.world.distanceTo(ship.position) })));
  }

  private cloudId(cloud: DebrisCloud): number {
    let id = this.cloudIds.get(cloud);
    if (id === undefined) {
      id = this.nextCloudId;
      this.nextCloudId += 1;
      this.cloudIds.set(cloud, id);
    }
    return id;
  }

  private render(): void {
    const { ship } = this.deps;
    const pages = Math.max(1, Math.ceil(this.entries.length / PAGE));
    this.pageLabel.textContent = pages > 1 ? `page ${this.page + 1}/${pages} · N next` : this.pinned ? '' : 'N closes';
    const inverse = ship.object.quaternion.clone().invert();
    this.list.replaceChildren(
      ...this.entries.slice(this.page * PAGE, this.page * PAGE + PAGE).map((entry, index) => {
        const local = entry.world.clone().sub(ship.position).applyQuaternion(inverse);
        const point = compassPoint(local.toArray());
        const relative = ship.velocity.clone().sub(entry.velocity ?? new THREE.Vector3());
        const eta = arrivalSeconds(entry.distance, relative.dot(entry.world.clone().sub(ship.position).normalize()));
        const item = document.createElement('li');
        item.dataset.group = entry.group;
        item.classList.toggle('selected', entry.id === this.selected);
        const cells = [
          String(index + 1),
          NAV_GROUP_TAG[entry.group],
          entry.label,
          formatDistance(entry.distance),
          bearingArrow(point.x, point.y, point.behind),
          eta !== null ? formatCountdown(eta) : '',
        ];
        item.replaceChildren(
          ...cells.map((text, cell) => {
            const span = document.createElement(cell === 0 ? 'kbd' : 'span');
            span.textContent = text;
            return span;
          }),
        );
        return item;
      }),
    );
    this.panel.hidden = false;
  }
}

function find(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector);
  if (!found) {
    throw new Error(`Navigation computer element ${selector} is missing from index.html`);
  }
  return found;
}
