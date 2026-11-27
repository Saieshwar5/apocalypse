export interface ScreenActions {
  onStart(): void;
  onResume(): void;
  onRestart(): void;
}

export interface RunSummary {
  score: number;
  wavesCleared: number;
  asteroidsDestroyed: number;
  impacts: number;
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

  constructor(actions: ScreenActions) {
    this.startButton.addEventListener('click', () => actions.onStart());
    element<HTMLButtonElement>('#resume-button').addEventListener('click', () => actions.onResume());
    element<HTMLButtonElement>('#restart-button').addEventListener('click', () => actions.onRestart());
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
      ['Score', summary.score.toLocaleString()],
      ['Waves survived', String(summary.wavesCleared)],
      ['Asteroids destroyed', String(summary.asteroidsDestroyed)],
      ['Impacts on Earth', String(summary.impacts)],
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
    this.gameOver.hidden = false;
    element<HTMLButtonElement>('#restart-button').focus();
  }

  hideAll(): void {
    this.menu.hidden = true;
    this.pause.hidden = true;
    this.gameOver.hidden = true;
  }

  setCockpitFrame(visible: boolean): void {
    this.cockpit.hidden = !visible;
  }
}
