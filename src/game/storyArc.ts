import type { Hud } from '../hud/hud';
import type { InputState } from '../input/inputState';
import { formatCredits } from '../logic/contracts';
import type { Wallet } from '../logic/economy';
import { EVIDENCE, EVIDENCE_SECTOR, STORY_LINES } from '../logic/story';
import type { GameEvents } from './gameEvents';
import type { GameSession } from './gameSession';
import type { RadioNet } from './radioNet';

export interface StoryArcDependencies {
  session: GameSession;
  /** Posts the strange rock as a tow to Farwatch's yard; false if it could not be posted now. */
  postEvidence: () => boolean;
  /** True while the ship is berthed at Meridian. */
  atMeridian: () => boolean;
  input: InputState;
  wallet: Wallet;
  events: GameEvents;
  hud: Hud;
  radio: RadioNet;
}

/** Seconds after the proof is found before Perihelion's offer arrives. */
const OFFER_DELAY = 25;

/**
 * The season's story as things the pilot does: a rock with a thruster on
 * it is found and towed to Farwatch; the yard finds proof of who has been
 * steering rocks; and at Meridian the pilot chooses to hand the proof to
 * the Authority or sell it to the company that made it.
 */
export class StoryArc {
  private offerIn = Infinity;

  constructor(private readonly deps: StoryArcDependencies) {}

  reset(): void {
    this.deps.session.story = 'unaware';
    this.offerIn = Infinity;
  }

  /** A calm sector has begun: in the right one, the strange rock turns up. */
  calmSector(index: number): void {
    const { session, radio } = this.deps;
    if (index >= EVIDENCE_SECTOR && session.story === 'unaware' && this.deps.postEvidence()) {
      session.story = 'rock-found';
      radio.say(...STORY_LINES.found);
    }
  }

  /** Farwatch's yard has opened the rock. */
  evidenceDelivered(): void {
    const { session, radio, hud } = this.deps;
    session.story = 'proof-held';
    this.offerIn = OFFER_DELAY;
    radio.say(...STORY_LINES.opened, true);
    hud.showMessage(`Farwatch paid ${formatCredits(EVIDENCE.pay)} and found proof inside the rock. Take it to Meridian`, 'success', 6);
  }

  update(deltaSeconds: number): void {
    const { session, input, radio, hud, events, wallet } = this.deps;
    if (session.story !== 'proof-held') {
      return;
    }
    this.offerIn -= deltaSeconds;
    if (this.offerIn <= 0) {
      this.offerIn = Infinity;
      radio.say(...STORY_LINES.offer);
    }
    if (!this.deps.atMeridian()) {
      return;
    }
    if (input.consumePress('Digit1')) {
      session.story = 'gave-to-authority';
      events.emit({ type: 'story-choice', honest: true });
      radio.say(...STORY_LINES.honest, true);
      hud.showMessage('You gave the proof to the Mayor and the Authority', 'success', 5);
    } else if (input.consumePress('Digit2')) {
      session.story = 'sold-to-company';
      events.emit({ type: 'story-choice', honest: false });
      wallet.earn(EVIDENCE.bribe);
      radio.say(...STORY_LINES.sold, true);
      hud.showMessage(`You sold the proof to Perihelion: ${formatCredits(EVIDENCE.bribe)}`, 'warning', 5);
    }
  }

  /** The choice, shown on the hint line while berthed at Meridian with the proof. */
  get hint(): string | null {
    return this.deps.session.story === 'proof-held' && this.deps.atMeridian()
      ? `You hold the proof. 1: give it to the Mayor and the Authority · 2: sell it to Perihelion (${formatCredits(EVIDENCE.bribe)})`
      : null;
  }
}
