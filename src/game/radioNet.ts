import type { SoundEffects } from '../audio/soundEffects';
import type { Hud } from '../hud/hud';
import { CAST, LINES, fillLine, type Moment, type SpeakerId } from '../logic/cast';
import { CHANNEL, VOICE, describeDirection, navExchange, type Exchange, type RadioPriority, type RadioSpeaker } from '../logic/radioScript';
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
  speaker: RadioSpeaker;
  text: string;
  priority: RadioPriority;
  /** Part of a two-way exchange: follows the line before it closely. */
  reply: boolean;
}

export interface RadioLogEntry {
  speaker: string;
  channel: string;
  color: string;
  text: string;
  /** Seconds into the run. */
  at: number;
}

/** Seconds between banter lines during calm zones, at random within this range. */
const BANTER_SECONDS: [number, number] = [22, 40];
/** Silence after a transmission ends, before the next: shorter inside an exchange. */
const GAP = { reply: 0.5, next: 1.8, chatter: 5 } as const;
/** The same speaker does not start a new topic within this many seconds (exchanges excepted). */
const PER_SPEAKER = 8;
const QUEUE_LENGTH = 6;
const LOG_LENGTH = 24;
const SELF_COLOR = '#d7ffe9';

/** Seconds a line takes to say, roughly: the radio waits for it to finish. */
export function lineSeconds(text: string): number {
  const words = text.split(/\s+/).length;
  return Math.min(7.5, Math.max(2.4, 1 + words * 0.36));
}

/**
 * The one radio channel everyone shares: mission control, the station
 * chiefs, the rival pilots and the pilot's own ship. Transmissions wait for
 * each other like real radio traffic: one voice at a time, a short pause
 * between lines, exchanges kept together, emergencies cutting in and
 * chatter only filling silence. Every line is kept in the radio log (L).
 */
export class RadioNet {
  /** Lines said this run, newest last. */
  readonly log: RadioLogEntry[] = [];
  private elapsed = 0;
  /** When the channel is free again. */
  private freeAt = 0;
  private readonly lastBy = new Map<RadioSpeaker, number>();
  private queue: Transmission[] = [];
  private calm = false;
  private banterIn: number = BANTER_SECONDS[0];

  constructor(private readonly deps: RadioNetDependencies) {}

  reset(): void {
    this.elapsed = 0;
    this.freeAt = 0;
    this.lastBy.clear();
    this.queue = [];
    this.calm = false;
    this.banterIn = BANTER_SECONDS[0];
    this.log.length = 0;
  }

  /** Banter, traffic and news only fill the channel when nothing urgent is happening. */
  setCalm(calm: boolean): void {
    this.calm = calm;
  }

  get isCalm(): boolean {
    return this.calm;
  }

  /** A line from a speaker; `urgent` jumps the queue and cuts in. */
  say(speaker: RadioSpeaker, text: string, urgent = false): void {
    this.enqueue([{ speaker, text: this.fill(text), priority: urgent ? 'emergency' : 'ops', reply: false }]);
  }

  /** Background talk: only said when the channel is quiet and nothing is waiting. */
  chatter(speaker: RadioSpeaker, text: string): void {
    if (this.queue.length > 0 || this.elapsed < this.freeAt) {
      return;
    }
    this.enqueue([{ speaker, text: this.fill(text), priority: 'chatter', reply: false }]);
  }

  /** A short back-and-forth, kept together. */
  exchange(lines: Exchange, priority: RadioPriority = 'ops'): void {
    this.enqueue(lines.map(([speaker, text], index) => ({ speaker, text: this.fill(text), priority, reply: index > 0 })));
  }

  /** The pilot picked a nav target: the ship calls it in and control reads back where it is. */
  navCallout(label: string, distance: number, local?: readonly [number, number, number], tip: string | null = null): void {
    const where = local ? describeDirection(local) : 'on your scope';
    this.exchange(navExchange(label, formatDistance(distance), where, tip));
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
    if (!template) {
      return;
    }
    const text = fillLine(template, values);
    if (moment === 'banter') {
      this.chatter(speaker, text);
    } else {
      this.say(speaker, text);
    }
  }

  update(deltaSeconds: number): void {
    this.elapsed += deltaSeconds;
    if (this.calm) {
      this.banterIn -= deltaSeconds;
      if (this.banterIn <= 0) {
        const random = this.deps.random ?? Math.random;
        this.banterIn = BANTER_SECONDS[0] + random() * (BANTER_SECONDS[1] - BANTER_SECONDS[0]);
        this.moment('banter');
      }
    }
    const next = this.queue[0];
    if (!next || this.elapsed < this.freeAt) {
      return;
    }
    // A new topic from someone who just spoke waits a little; replies never do.
    if (!next.reply && next.priority !== 'emergency' && this.elapsed - (this.lastBy.get(next.speaker) ?? -Infinity) < PER_SPEAKER) {
      return;
    }
    this.queue.shift();
    this.transmit(next);
  }

  private transmit(line: Transmission): void {
    const duration = lineSeconds(line.text);
    const following = this.queue[0];
    const gap = following?.reply ? GAP.reply : line.priority === 'chatter' ? GAP.chatter : GAP.next;
    this.freeAt = this.elapsed + duration + gap;
    this.lastBy.set(line.speaker, this.elapsed);
    const name = line.speaker === 'self' ? this.deps.callSign() : CAST[line.speaker].label;
    const color = line.speaker === 'self' ? SELF_COLOR : CAST[line.speaker].color;
    const channel = CHANNEL[line.speaker];
    this.log.push({ speaker: name, channel, color, text: line.text, at: this.elapsed });
    if (this.log.length > LOG_LENGTH) {
      this.log.shift();
    }
    this.deps.hud.showRadio({ name, channel, color, text: line.text, seconds: duration + 0.6, self: line.speaker === 'self' });
    this.deps.sound.radioLine(line.text, VOICE[line.speaker], duration, line.priority === 'emergency');
  }

  private enqueue(lines: Transmission[]): void {
    if (lines.length === 0) {
      return;
    }
    if (lines[0].priority === 'emergency') {
      // Cut in: drop chatter, go first, and do not wait for the channel.
      this.queue = [...lines, ...this.queue.filter((line) => line.priority !== 'chatter')];
      this.freeAt = Math.min(this.freeAt, this.elapsed);
      this.lastBy.delete(lines[0].speaker);
    } else {
      this.queue.push(...lines);
    }
    // Keep the newest important traffic; old chatter goes first.
    while (this.queue.length > QUEUE_LENGTH) {
      const chatter = this.queue.findIndex((line) => line.priority === 'chatter');
      this.queue.splice(chatter >= 0 ? chatter : this.queue.length - 1, 1);
    }
  }

  private fill(text: string): string {
    return fillLine(text, { callsign: this.deps.callSign(), rank: this.deps.rank?.() ?? 'Pilot' });
  }
}
