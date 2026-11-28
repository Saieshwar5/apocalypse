import { berthExchange, dockingExchange, newsLine, towExchange, trafficCall } from '../logic/radioScript';
import type { RandomSource } from '../logic/random';
import type { PlaySession } from './playSession';
import type { RadioNet } from './radioNet';

/** News waits this long into a calm zone, after the first calls have settled. */
const NEWS_DELAY = 14;

/**
 * Turns what happens into radio traffic, the way it would sound: the ship
 * asks for docking and Aegis clears it, a station chief welcomes the ship
 * alongside, the pilot reports a satellite on the line, launches are called
 * out, and calm zones bring news from the people on the ground.
 */
export class RadioTraffic {
  private lastDocking = 'free';
  private lastBerth: string | null = null;
  private lastTow: string | null = null;
  private lastPhase = '';
  private newsIn = Infinity;
  private pick = 0;

  constructor(
    private readonly play: PlaySession,
    private readonly radio: RadioNet,
    private readonly rng: RandomSource,
  ) {}

  reset(): void {
    this.lastDocking = 'free';
    this.lastBerth = null;
    this.lastTow = null;
    this.lastPhase = '';
    this.newsIn = Infinity;
  }

  update(deltaSeconds: number): void {
    const { play, radio } = this;
    const docking = play.stationOps.docking.state;
    if (docking === 'approach' && this.lastDocking === 'free') {
      radio.exchange(dockingExchange(this.next()));
    }
    this.lastDocking = docking;

    const berth = play.services.berths.berthedAt;
    if (berth && berth !== this.lastBerth) {
      radio.exchange(berthExchange(berth, this.next()));
    }
    this.lastBerth = berth;

    const tow = play.services.work.towStatus();
    const satellite = tow?.match(/(WX|NAV|COM)-\d [A-Z]+/)?.[0] ?? null;
    if (satellite && satellite !== this.lastTow) {
      radio.exchange(towExchange(satellite, this.next()));
    }
    this.lastTow = satellite;

    const phase = play.campaign.director.phase;
    if (phase === 'calm' && this.lastPhase !== 'calm') {
      this.newsIn = NEWS_DELAY;
    } else if (phase !== 'calm') {
      this.newsIn = Infinity;
    }
    this.lastPhase = phase;
    this.newsIn -= deltaSeconds;
    if (this.newsIn <= 0) {
      this.newsIn = Infinity;
      radio.chatter('control', this.news());
    }
  }

  /** A launch from Earth: a traffic call, when the radio is quiet. */
  launch(site: string): void {
    if (this.radio.isCalm) {
      this.radio.chatter('control', trafficCall(site, this.next()));
    }
  }

  private news(): string {
    const sites = this.play.sites.sites.filter((site) => site.definition.kind === 'city');
    const standing = sites.filter((site) => site.health > 50);
    const lost = sites.filter((site) => site.health <= 0);
    const saved = standing.length > 0 ? standing[Math.floor(this.rng() * standing.length)].definition.name : null;
    return newsLine(saved, lost.length > 0 ? lost[0].definition.name : null, this.next());
  }

  private next(): number {
    this.pick += 1 + Math.floor(this.rng() * 3);
    return this.pick;
  }
}
