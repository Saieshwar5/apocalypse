import type { RunRecord } from '../logic/bestRuns';
import { formatCredits } from '../logic/contracts';
import { orbitRating } from '../logic/orbitPlan';

const LICENCE_LABEL: Record<string, string> = { good: 'Good standing', warning: 'Warning', probation: 'Probation', recalled: 'Recalled' };

export interface ScreenActions {
  onStart(): void;
  onTraining(): void;
  onResume(): void;
  onRestart(): void;
  onNext(): void;
  onShare(): void;
  /** From the pause screen: start the run again, or leave it. */
  onRestartRun(): void;
  onQuit(): void;
}

export interface RunSummary {
  earned: number;
  spent: number;
  balance: number;
  contractsCompleted: number;
  contractsLost: number;
  orbitHealth: number;
  reputation: number;
  licence: string;
  shipsLost: number;
  rank: string;
  /** "Medals: 2 gold · 3 silver · 1 bronze". */
  medals: string;
  hardcore: boolean;
  /** Relaxed, Standard or Veteran. */
  difficulty: string;
  /** Tonnes of debris swept from orbit. */
  debrisSwept: number;
  /** Every pilot's earnings, best first. */
  league: readonly { name: string; earned: number; you: boolean }[];
  wavesCleared: number;
  asteroidsDestroyed: number;
  impacts: number;
  citiesStanding: number;
  cityCount: number;
  /** Why the mission ended, shown above the heading. */
  reason: string;
  /** True when the orbit was completed rather than lost. */
  victory: boolean;
  integrity: number;
  planet: string;
  /** Star of the next system when there is one to travel to. */
  nextStar: string | null;
  bestRuns: readonly RunRecord[];
  current: RunRecord;
}

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) {
    throw new Error(`Screen element ${selector} is missing from index.html`);
  }
  return found;
}

/** Menu, pause and game-over overlays, plus the cockpit frame. */
export class GameScreens {
  private readonly menu = element<HTMLDivElement>('#menu');
  private readonly pause = element<HTMLDivElement>('#pause');
  private readonly gameOver = element<HTMLDivElement>('#game-over');
  private readonly loading = element<HTMLDivElement>('#loading');
  private readonly cockpit = element<HTMLDivElement>('#cockpit-frame');
  private readonly startButton = element<HTMLButtonElement>('#start-button');
  private readonly summary = element<HTMLDListElement>('#run-summary');
  private readonly cinematic = element<HTMLDivElement>('#cinematic');
  private readonly caption = element<HTMLParagraphElement>('#cinematic-caption');
  private readonly fade = element<HTMLDivElement>('#fade');

  constructor(actions: ScreenActions) {
    this.startButton.addEventListener('click', () => actions.onStart());
    element<HTMLButtonElement>('#training-button').addEventListener('click', () => actions.onTraining());
    element<HTMLButtonElement>('#resume-button').addEventListener('click', () => actions.onResume());
    element<HTMLButtonElement>('#restart-button').addEventListener('click', () => actions.onRestart());
    element<HTMLButtonElement>('#next-button').addEventListener('click', () => actions.onNext());
    element<HTMLButtonElement>('#share-button').addEventListener('click', () => actions.onShare());
    confirmButton(element<HTMLButtonElement>('#restart-run-button'), 'Sure? This run is lost', () => actions.onRestartRun());
    confirmButton(element<HTMLButtonElement>('#quit-button'), 'Sure? This run is lost', () => actions.onQuit());
  }

  /** The pilot's rank and what the next one needs, on the menu. */
  setRank(text: string): void {
    element<HTMLParagraphElement>('#rank-line').textContent = text;
  }

  showMenu(): void {
    this.loading.hidden = true;
    this.hideAll();
    this.menu.hidden = false;
    this.startButton.disabled = false;
    this.startButton.textContent = 'Launch interceptor';
    this.startButton.focus();
  }

  showPause(): void {
    this.pause.hidden = false;
    element<HTMLButtonElement>('#resume-button').focus();
  }

  showGameOver(summary: RunSummary): void {
    const rows: [string, string][] = [
      ['Licence', `${summary.hardcore ? 'HARDCORE · ' : ''}${LICENCE_LABEL[summary.licence] ?? summary.licence} · ${Math.round(summary.reputation)}`],
      ['Difficulty', summary.difficulty],
      ['Medals this run', summary.medals.replace(/^Medals: /, '')],
      ['Ships lost', String(summary.shipsLost)],
      ['Career rank', summary.rank],
      ['Earned', formatCredits(summary.earned)],
      ['Spent at the station', formatCredits(summary.spent)],
      ['Balance', formatCredits(summary.balance)],
      ['Contracts completed', String(summary.contractsCompleted)],
      ['Contracts lost to impacts', String(summary.contractsLost)],
      ...summary.league.map((row, index): [string, string] => [`${index + 1}. ${row.you ? 'You' : row.name}`, formatCredits(row.earned)]),
      [`${summary.planet} integrity`, `${Math.max(0, Math.round(summary.integrity))}%`],
      ['Orbit health', `${Math.round(summary.orbitHealth)}%`],
      ['Debris swept', `${summary.debrisSwept.toFixed(1)} t`],
      ['Fields cleared', String(summary.wavesCleared)],
      ['Asteroids destroyed', String(summary.asteroidsDestroyed)],
      ['Impacts', String(summary.impacts)],
      ['Cities standing', `${summary.citiesStanding} of ${summary.cityCount}`],
    ];
    this.summary.replaceChildren(
      ...rows.flatMap(([label, value]) => {
        const term = document.createElement('dt');
        term.textContent = label;
        const detail = document.createElement('dd');
        detail.textContent = value;
        return [term, detail];
      }),
    );
    const reason = element<HTMLParagraphElement>('#failure-reason');
    reason.style.whiteSpace = 'pre-line';
    reason.textContent = summary.reason;
    const stars = orbitRating(summary.integrity, summary.citiesStanding, summary.cityCount);
    element<HTMLHeadingElement>('#outcome-heading').textContent = summary.victory
      ? `Season complete ${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}`
      : 'Mission failed';
    this.gameOver.dataset.outcome = summary.victory ? 'victory' : 'defeat';
    const nextButton = element<HTMLButtonElement>('#next-button');
    nextButton.hidden = summary.nextStar === null;
    nextButton.textContent = summary.nextStar ? `Travel to ${summary.nextStar}` : '';
    element<HTMLButtonElement>('#restart-button').textContent = summary.victory ? 'Start again from Earth' : 'Launch again';
    this.setShareStatus('Copy result');
    element<HTMLOListElement>('#best-runs').replaceChildren(
      ...summary.bestRuns.map((run) => {
        const row = document.createElement('li');
        const isCurrent = run.earned === summary.current.earned && run.date === summary.current.date && run.planet === summary.current.planet;
        row.className = isCurrent ? 'current' : '';
        const what = document.createElement('span');
        what.textContent = `${run.date} · ${run.planet}${run.victory ? ` ${'★'.repeat(run.stars)}` : ''}`;
        const score = document.createElement('span');
        score.textContent = formatCredits(run.earned);
        row.append(what, score);
        return row;
      }),
    );
    this.gameOver.hidden = false;
    (summary.nextStar ? element<HTMLButtonElement>('#next-button') : element<HTMLButtonElement>('#restart-button')).focus();
  }

  hideAll(): void {
    this.menu.hidden = true;
    this.pause.hidden = true;
    this.gameOver.hidden = true;
  }

  setShareStatus(text: string): void {
    element<HTMLButtonElement>('#share-button').textContent = text;
  }

  /** Letterbox bars, captions and the skip hint during the launch. */
  setCinematic(visible: boolean): void {
    this.cinematic.hidden = !visible;
    if (!visible) {
      this.setCaption('');
    }
  }

  setCaption(text: string): void {
    this.caption.textContent = text;
    this.caption.classList.toggle('visible', text.length > 0);
  }

  /** White fade used for the cut from the pad to orbit (0..1). */
  setFade(opacity: number): void {
    this.fade.style.opacity = String(opacity);
  }

  setCockpitFrame(visible: boolean): void {
    this.cockpit.hidden = !visible;
  }
}

/**
 * A button that asks once more before acting: the first click changes its
 * label to `question`; a second click within four seconds confirms.
 */
export function confirmButton(button: HTMLButtonElement, question: string, onConfirm: () => void): void {
  const label = button.innerHTML;
  let armed: number | null = null;
  const disarm = () => {
    if (armed !== null) {
      window.clearTimeout(armed);
    }
    armed = null;
    button.innerHTML = label;
    button.classList.remove('confirming');
  };
  button.addEventListener('click', () => {
    if (armed === null) {
      button.textContent = question;
      button.classList.add('confirming');
      armed = window.setTimeout(disarm, 4000);
      return;
    }
    disarm();
    onConfirm();
  });
}
