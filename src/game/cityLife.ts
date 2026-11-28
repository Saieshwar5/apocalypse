import type { Hud } from '../hud/hud';
import { CITY_IDS, CITY_PAY, CITY_STATE_NAME, STATION_STRIKE, WATCH_RANGE, cityLights, cityState, strikeDamage, structureLights, supplyShare, type CityId, type CityState } from '../logic/cities';
import type { Stock } from '../logic/stationEconomy';
import { STATIONS, type StationId } from '../logic/stations';
import type { Outposts } from '../station/outposts';
import type { RadioNet } from './radioNet';

export interface CityLifeDependencies {
  outposts: Outposts;
  stocks: () => Record<StationId, Stock>;
  hud: Hud;
  radio: RadioNet;
}

/** A station's supplies must stay in a new state this long before it is announced. */
const SETTLE_SECONDS = 20;

/** What each station says when its supplies turn for the worse, or recover. */
const CALLS: Record<CityId, Partial<Record<CityState, string>>> = {
  meridian: {
    short: 'Meridian to all pilots. The city is running short, and it is starting to show in what we can pay. Cargo for our docks is paying well.',
    failing: 'This is Mayor Adeyemi. Meridian is rationing. We need fuel and parts now.',
    thriving: 'Meridian here. Stores are full and the lights are on. Thank you, pilots.',
  },
  anchor: {
    short: 'Anchor port. We are low on parts for the lift. Fuel will get dear if this goes on.',
    failing: 'Lind at Anchor. The lift from Earth has stopped: no parts. Nothing is coming up.',
    thriving: 'Anchor port. The lift is running at full rate. Fuel is cheap today.',
  },
  farwatch: {
    short: 'Farwatch. We are short out here. The dishes are on reduced power: expect less warning.',
    failing: 'Imani at Farwatch. We are going dark. You will see the rocks late.',
    thriving: 'Farwatch. Full power on the dishes. You will have every rock early.',
  },
};

/**
 * The life of the three great stations: their windows burn as bright as
 * their stores are full, they call out when supplies turn, and Farwatch's
 * state sets how far the scanner sees.
 */
export class CityLife {
  private readonly states = new Map<CityId, CityState>();
  /** Each station's structure, 100 when whole; a rock that gets through holes it. */
  private readonly structure = new Map<CityId, number>();
  private readonly pending = new Map<CityId, { state: CityState; seconds: number }>();

  constructor(private readonly deps: CityLifeDependencies) {}

  reset(): void {
    this.states.clear();
    this.structure.clear();
    this.pending.clear();
  }

  /** A rock got through. */
  strike(city: CityId): void {
    this.structure.set(city, strikeDamage(this.structureOf(city)));
  }

  structureOf(city: CityId): number {
    return this.structure.get(city) ?? 100;
  }

  /** Every job pays a little more while Meridian thrives, and less while it fails. */
  get payFactor(): number {
    return CITY_PAY[this.stateOf('meridian')];
  }

  update(deltaSeconds = 0): void {
    const stocks = this.deps.stocks();
    for (const city of CITY_IDS) {
      const share = supplyShare(city, stocks[city]);
      // A holed station mends itself slowly, while it has parts to mend with.
      if (stocks[city].parts > 0 && this.structureOf(city) < 100) {
        this.structure.set(city, Math.min(100, this.structureOf(city) + STATION_STRIKE.repairPerSecond * deltaSeconds));
      }
      this.deps.outposts.setCityLights(city, cityLights(share) * structureLights(this.structureOf(city)));
      const state = cityState(share);
      const before = this.states.get(city);
      if (!before) {
        this.states.set(city, state);
        continue;
      }
      // A station hovering at a threshold would flip back and forth: a new state must hold for a while first.
      const pending = this.pending.get(city);
      if (state === before) {
        this.pending.delete(city);
      } else if (!pending || pending.state !== state) {
        this.pending.set(city, { state, seconds: 0 });
      } else if ((pending.seconds += deltaSeconds) >= SETTLE_SECONDS) {
        this.pending.delete(city);
        this.states.set(city, state);
        this.announce(city, state);
      }
    }
  }

  stateOf(city: CityId): CityState {
    return this.states.get(city) ?? 'steady';
  }

  /** Scanner range multiplier from Farwatch's lookout. */
  get watchFactor(): number {
    return WATCH_RANGE[this.stateOf('farwatch')];
  }

  /** "Meridian steady", for the map and the mission page. */
  summary(): { city: CityId; name: string; state: CityState; text: string }[] {
    return CITY_IDS.map((city) => {
      const name = STATIONS[city].name[0] + STATIONS[city].name.slice(1).toLowerCase();
      const holed = this.structureOf(city) < 70 ? ', holed' : '';
      return { city, name, state: this.stateOf(city), text: `${name} ${CITY_STATE_NAME[this.stateOf(city)]}${holed}` };
    });
  }

  private announce(city: CityId, state: CityState): void {
    const line = CALLS[city][state];
    if (line) {
      this.deps.radio.say(city, line, state === 'failing');
      this.deps.hud.showMessage(`${STATIONS[city].name} is ${CITY_STATE_NAME[state]}`, state === 'thriving' ? 'success' : state === 'failing' ? 'danger' : 'warning', 4);
    }
  }
}
