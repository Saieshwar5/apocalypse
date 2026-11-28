import type { LicenceView } from '../game/pilotCareer';
import { confirmButton } from '../game/gameScreens';
import { LIVERIES } from '../logic/livery';

/**
 * The title screen's live parts: the pilot licence (rank, progress, stats),
 * the paint chips that repaint the ship hanging in front of Earth, and the
 * new-career button. The wordmark and its orbit are plain markup and CSS.
 */
export class TitleScreen {
  private readonly rank = find('#licence-rank');
  private readonly bar = find('#licence-bar');
  private readonly next = find('#rank-line');
  private readonly stats = find('#licence-stats');
  private readonly chips = find('#paint-chips');
  private readonly livery = find('#livery-input') as HTMLSelectElement;

  constructor(onNewCareer: () => void) {
    confirmButton(find('#new-career-button') as HTMLButtonElement, 'This wipes rank, medals, hangar and logbook. Click again', onNewCareer);
    this.chips.replaceChildren(
      ...LIVERIES.map((livery) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.setAttribute('role', 'radio');
        chip.setAttribute('aria-label', livery.name);
        chip.title = livery.name;
        chip.dataset.livery = livery.id;
        const [r, g, b] = livery.tint ?? [0.55, 0.58, 0.62];
        chip.style.setProperty('--chip', `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`);
        chip.addEventListener('click', () => {
          this.livery.value = livery.id;
          this.livery.dispatchEvent(new Event('change'));
          this.markPaint();
        });
        return chip;
      }),
    );
    // The settings fill the hidden select after this runs; mark the chosen chip once they have.
    queueMicrotask(() => this.markPaint());
  }

  render(view: LicenceView): void {
    this.rank.textContent = view.rank;
    this.bar.style.width = `${Math.round(view.progress * 100)}%`;
    this.next.textContent = view.next.charAt(0).toUpperCase() + view.next.slice(1);
    const stat = (value: string, label: string) => {
      const group = document.createElement('div');
      const term = document.createElement('dt');
      term.textContent = label;
      const detail = document.createElement('dd');
      detail.textContent = value;
      group.append(term, detail);
      return group;
    };
    this.stats.replaceChildren(
      stat(`${view.earned.toLocaleString('en-US')} cr`, 'earned in your career'),
      stat(String(view.seasons), view.seasons === 1 ? 'season flown' : 'seasons flown'),
      stat(String(view.gold), view.gold === 1 ? 'gold medal' : 'gold medals'),
    );
    this.markPaint();
  }

  private markPaint(): void {
    for (const chip of this.chips.querySelectorAll<HTMLButtonElement>('button')) {
      chip.setAttribute('aria-checked', String(chip.dataset.livery === this.livery.value));
    }
  }
}

function find(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector);
  if (!found) {
    throw new Error(`Title screen element ${selector} is missing from index.html`);
  }
  return found;
}
