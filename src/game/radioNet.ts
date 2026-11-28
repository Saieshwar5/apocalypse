import type { SoundEffects } from '../audio/soundEffects';
import type { Hud } from '../hud/hud';
import { CAST, LINES, RADIO_NET, fillLine, radioClear, type Moment, type SpeakerId } from '../logic/cast';
import { formatDistance } from '../logic/units';

export interface RadioNetDependencies {
  hud: Hud;
  sound: SoundEffects;
  callSign: () => string;
  /** The pilot's rank, for lines that address them formally. */
  rank?: () => string;
  random?: () => number;
}

interface Transmission {
  speaker: SpeakerId;
  text: string;
}

/** Seconds between banter lines during calm zones, at random within this range. */
const BANTER_SECONDS: [number, number] = [22, 40];

/**
 * The one radio channel everyone shares: mission control, the station chiefs
 * and the rival pilots. Lines are queued and spaced out so they never talk
 * over each other or over mission control's urgent calls, and each speaker
 * has a voice of their own. In calm zones the channel fills with banter.
 */
export class RadioNet {
  private elapsed = 0;
  private lastAny = -Infinity;
  private readonly lastBy = new Map<SpeakerId, number>();
  private queue: Transmission[] = [];
  private calm = false;
  private banterIn: number = BANTER_SECONDS[0];

  constructor(private readonly deps: RadioNetDependencies) {}

  reset(): void {
    this.elapsed = 0;
    this.lastAny = -Infinity;
    this.lastBy.clear();
    this.queue = [];
    this.calm = false;
    this.banterIn = BANTER_SECONDS[0];
  }

  /** Banter only fills the channel when nothing urgent is happening. */
  setCalm(calm: boolean): void {
    this.calm = calm;
  }

  /** A specific line from a speaker; `urgent` jumps the queue and ignores the speaker's own spacing. */
  say(speaker: SpeakerId, text: string, urgent = false): void {
    const line = { speaker, text: fillLine(text, { callsign: this.deps.callSign(), rank: this.deps.rank?.() ?? 'Pilot' }) };
    if (urgent) {
      this.queue.unshift(line);
      this.lastBy.delete(speaker);
    } else {
      this.queue.push(line);
    }
    this.queue = this.queue.slice(0, RADIO_NET.queueLength);
  }

  /** Mission control confirms a nav target the pilot picked. */
  navCallout(label: string, distance: number): void {
    this.say('control', `Copy, {callsign}. ${label}, ${formatDistance(distance)} out. Follow your director.`);
  }

  /** A line for a moment, from one of the speakers who has something to say about it. */
  moment(moment: Moment, values: Record<string, string> = {}, onlyFrom?: SpeakerId): void {
    const options = LINES[moment];
    const speakers = (Object.keys(options) as SpeakerId[]).filter((speaker) => !onlyFrom || speaker === onlyFrom);
    if (speakers.length === 0) {
      return;
    }
    const random = this.deps.random ?? Math.random;
    const speaker = speakers[Math.floor(random() * speakers.length)];
    const lines = options[speaker] ?? [];
    const template = lines[Math.floor(random() * lines.length)];
    if (template) {
      this.say(speaker, fillLine(template, values));
    }
  }

  update(deltaSeconds: number): void {
    this.elapsed += deltaSeconds;
    if (this.calm) {
      this.banterIn -= deltaSeconds;
      if (this.banterIn <= 0) {
        const random = this.deps.random ?? Math.random;
        this.banterIn = BANTER_SECONDS[0] + random() * (BANTER_SECONDS[1] - BANTER_SECONDS[0]);
        if (this.queue.length === 0) {
          this.moment('banter');
        }
      }
    }
    const next = this.queue[0];
    if (!next || !radioClear(this.elapsed, this.lastAny, this.lastBy.get(next.speaker) ?? -Infinity)) {
      return;
    }
    this.queue.shift();
    this.lastAny = this.elapsed;
    this.lastBy.set(next.speaker, this.elapsed);
    const speaker = CAST[next.speaker];
    this.deps.hud.showRadio(speaker.label, speaker.color, next.text, RADIO_NET.lineSeconds);
    this.deps.sound.chatter(next.text, speaker.pitch);
  }
}
