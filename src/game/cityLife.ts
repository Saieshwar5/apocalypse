import type { Hud } from '../hud/hud';
import { CITY_IDS, CITY_STATE_NAME, WATCH_RANGE, cityLights, cityState, supplyShare, type CityId, type CityState } from '../logic/cities';
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

/** What each station says when its supplies turn for the worse, or recover. */
const CALLS: Record<CityId, Partial<Record<CityState, string>>> = {
  meridian: {
    short: 'Meridian to all pilots. The city is running short. Cargo for our docks is paying well.',
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

  constructor(private readonly deps: CityLifeDependencies) {}

  reset(): void {
    this.states.clear();
  }

  update(): void {
    const stocks = this.deps.stocks();
    for (const city of CITY_IDS) {
      const share = supplyShare(city, stocks[city]);
      this.deps.outposts.setCityLights(city, cityLights(share));
      const state = cityState(share);
      const before = this.states.get(city);
      this.states.set(city, state);
      if (before && before !== state) {
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
      return { city, name, state: this.stateOf(city), text: `${name} ${CITY_STATE_NAME[this.stateOf(city)]}` };
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
