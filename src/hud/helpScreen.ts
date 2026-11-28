import type { Duty } from '../logic/mission';
import { renderMission } from './missionPage';

export type HelpTab = 'mission' | 'now' | 'controls' | 'jobs' | 'screen';

const TAB_ORDER: readonly HelpTab[] = ['mission', 'now', 'controls', 'jobs', 'screen'];

/**
 * The help screen (H): the pilot's mission, what to do now, the controls,
 * how each job works and how to read the screen. It pauses play while open.
 */
export class HelpScreen {
  private readonly root = find('#help');
  private readonly list = find('#help-now');
  private readonly mission = find('#help-mission');
  private readonly title = find('#help-title');
  private readonly closeButton = find('#help-close');
  private readonly tabs = [...this.root.querySelectorAll<HTMLButtonElement>('[data-tab]')];
  private readonly pages = [...this.root.querySelectorAll<HTMLElement>('[data-page]')];
  /** Called when the pilot closes help (button, H or Esc). */
  onClose: (() => void) | null = null;

  constructor() {
    for (const tab of this.tabs) {
      tab.addEventListener('click', () => this.select(tab.dataset.tab as HelpTab));
    }
    this.closeButton.addEventListener('click', () => this.onClose?.());
    window.addEventListener('keydown', (event) => {
      if (!this.open || event.repeat) {
        return;
      }
      if (event.code === 'KeyH' || event.code === 'Escape') {
        event.preventDefault();
        this.onClose?.();
      } else if (/^Digit[1-5]$/.test(event.code)) {
        this.select(TAB_ORDER[Number(event.code.slice(5)) - 1]);
      }
    });
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  /**
   * `advice` fills "What now?" and `duties` the mission page; `closeLabel`
   * says where closing leads ("Back to flight", "Start flying").
   */
  show(advice: readonly string[], duties: readonly Duty[], tab: HelpTab, closeLabel: string, title = 'Help'): void {
    this.title.textContent = title;
    renderMission(this.mission, duties);
    this.closeButton.replaceChildren(`${closeLabel} `, Object.assign(document.createElement('kbd'), { textContent: 'H' }));
    this.list.replaceChildren(
      ...(advice.length > 0 ? advice : ['Start a run, then press H in flight for advice on what to do next.']).map((text) => {
        const item = document.createElement('li');
        item.textContent = text;
        return item;
      }),
    );
    this.root.hidden = false;
    this.select(tab);
  }

  hide(): void {
    this.root.hidden = true;
  }

  private select(tab: HelpTab): void {
    for (const button of this.tabs) {
      button.setAttribute('aria-selected', String(button.dataset.tab === tab));
    }
    for (const page of this.pages) {
      page.hidden = page.dataset.page !== tab;
    }
    this.tabs.find((button) => button.dataset.tab === tab)?.focus();
  }
}

function find(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector);
  if (!found) {
    throw new Error(`Help element ${selector} is missing from index.html`);
  }
  return found;
}
