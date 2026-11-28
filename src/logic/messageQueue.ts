/**
 * One message line, taken in turn. A danger interrupts anything; job news
 * waits for a danger to finish instead of overwriting it; repeats of the
 * message on screen just extend it; old news that waited too long is
 * dropped rather than shown late.
 */
export type MessageTone = 'info' | 'warning' | 'danger' | 'success';

export interface QueuedMessage {
  text: string;
  tone: MessageTone;
  seconds: number;
}

const PRIORITY: Record<MessageTone, number> = { danger: 3, warning: 2, success: 1, info: 0 };
/** A waiting message older than this is no longer news. */
const STALE_SECONDS = 6;
const MAX_WAITING = 3;
/** Every message gets at least this long on screen before a same-level one replaces it. */
const MIN_READ_SECONDS = 1.2;

export class MessageQueue {
  current: QueuedMessage | null = null;
  private remaining = 0;
  private shownFor = 0;
  private waiting: (QueuedMessage & { age: number })[] = [];

  /** Returns the message to display now, or null if it waits (or nothing changes). */
  push(message: QueuedMessage): QueuedMessage | null {
    const current = this.current;
    if (current && current.text === message.text) {
      this.remaining = Math.max(this.remaining, message.seconds);
      return null;
    }
    if (!current || this.remaining <= 0) {
      return this.show(message);
    }
    const higher = PRIORITY[message.tone] > PRIORITY[current.tone];
    const sameAndRead = PRIORITY[message.tone] === PRIORITY[current.tone] && this.shownFor >= MIN_READ_SECONDS;
    if (higher || sameAndRead) {
      // The interrupted message gets its turn later if it still matters.
      if (higher && current.tone !== 'info' && this.remaining > 1) {
        this.wait({ ...current, seconds: this.remaining });
      }
      return this.show(message);
    }
    this.wait(message);
    return null;
  }

  /** Advances time; returns the next message when the current one ends, 'clear' when the line empties. */
  update(deltaSeconds: number): QueuedMessage | 'clear' | null {
    for (const waiting of this.waiting) {
      waiting.age += deltaSeconds;
    }
    this.waiting = this.waiting.filter((waiting) => waiting.age < STALE_SECONDS);
    if (!this.current) {
      return null;
    }
    this.remaining -= deltaSeconds;
    this.shownFor += deltaSeconds;
    if (this.remaining > 0) {
      return null;
    }
    const next = this.waiting.sort((a, b) => PRIORITY[b.tone] - PRIORITY[a.tone] || a.age - b.age).shift();
    if (next) {
      return this.show({ text: next.text, tone: next.tone, seconds: Math.min(next.seconds, 3) });
    }
    this.current = null;
    return 'clear';
  }

  get waitingCount(): number {
    return this.waiting.length;
  }

  private show(message: QueuedMessage): QueuedMessage {
    this.current = message;
    this.remaining = message.seconds;
    this.shownFor = 0;
    this.waiting = this.waiting.filter((waiting) => waiting.text !== message.text);
    return message;
  }

  private wait(message: QueuedMessage): void {
    if (this.waiting.some((waiting) => waiting.text === message.text)) {
      return;
    }
    this.waiting.push({ ...message, age: 0 });
    if (this.waiting.length > MAX_WAITING) {
      // Drop the least important, oldest first.
      this.waiting.sort((a, b) => PRIORITY[a.tone] - PRIORITY[b.tone] || b.age - a.age).shift();
    }
  }
}
