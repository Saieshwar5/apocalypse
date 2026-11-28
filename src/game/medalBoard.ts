import type { SoundEffects } from '../audio/soundEffects';
import { formatCredits } from '../logic/contracts';
import {
  JOB_LABEL,
  addMedal,
  contractScore,
  emptyTally,
  medalBonus,
  medalFor,
  totalMedals,
  type JobKind,
  type Medal,
  type MedalTally,
} from '../logic/medals';
import type { GameSession } from './gameSession';
import type { RadioNet } from './radioNet';

export interface MedalBoardDependencies {
  session: GameSession;
  sound: SoundEffects;
  radio: RadioNet;
  /** Keeps the medal with the career. */
  onMedal: (kind: JobKind, medal: Medal) => void;
}

const TITLE: Record<Medal, string> = { gold: 'GOLD', silver: 'SILVER', bronze: 'BRONZE' };
const TOAST_SECONDS = 3.2;

/**
 * Grades every finished job: listens for completed work, turns its score
 * into a medal, pays the medal bonus and shows the badge. Intercepts are
 * frequent, so only their golds get a badge; every medal is counted.
 */
export class MedalBoard {
  /** This run's medals, for the end screen. */
  tally: MedalTally = emptyTally();
  private readonly toast = find('#medal-toast');
  private readonly title = this.toast.querySelector('strong') as HTMLElement;
  private readonly detail = this.toast.querySelector('em') as HTMLElement;
  private toastLeft = 0;

  constructor(private readonly deps: MedalBoardDependencies) {
    deps.session.events.on((event) => {
      if (event.type === 'contract-completed') {
        this.award('contract', contractScore(event.early ?? false, event.clean), 0);
      } else if (event.type === 'satellite-job-completed' && event.job && event.score !== undefined) {
        this.award(event.job, event.score, event.pay ?? 0);
      }
    });
  }

  reset(): void {
    this.tally = emptyTally();
    this.toastLeft = 0;
    this.toast.hidden = true;
  }

  update(deltaSeconds: number): void {
    if (this.toastLeft > 0) {
      this.toastLeft -= deltaSeconds;
      this.toast.hidden = this.toastLeft <= 0;
    }
  }

  /** "3 gold · 5 silver · 2 bronze", for the end screen. */
  summary(): string {
    const counts = (['gold', 'silver', 'bronze'] as const).map((medal) => `${totalMedals(this.tally, medal)} ${medal}`);
    return `Medals: ${counts.join(' · ')}`;
  }

  private award(kind: JobKind, score: number, pay: number): void {
    const medal = medalFor(score);
    this.tally = addMedal(this.tally, kind, medal);
    this.deps.onMedal(kind, medal);
    const bonus = medalBonus(kind, medal, pay);
    if (bonus > 0) {
      this.deps.session.wallet.earn(bonus);
    }
    if (kind === 'contract' && medal !== 'gold') {
      return;
    }
    const job = JOB_LABEL[kind].replace(/s$/, '').toLowerCase();
    this.show(medal, `${job}${bonus > 0 ? ` · bonus ${formatCredits(bonus)}` : ''}`);
    if (medal === 'gold') {
      this.deps.sound.chime();
      if (kind !== 'contract') {
        this.deps.radio.moment('gold-medal');
      }
    }
  }

  private show(medal: Medal, detail: string): void {
    this.toast.dataset.medal = medal;
    this.title.textContent = `${TITLE[medal]} MEDAL`;
    this.detail.textContent = detail;
    // Restart the entrance animation.
    this.toast.hidden = true;
    void this.toast.offsetWidth;
    this.toast.hidden = false;
    this.toastLeft = TOAST_SECONDS;
  }
}

function find(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector);
  if (!found) {
    throw new Error(`Medal element ${selector} is missing from index.html`);
  }
  return found;
}
