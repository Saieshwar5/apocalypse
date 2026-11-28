export type HelpTab = 'now' | 'controls' | 'jobs' | 'screen';

/**
 * The help screen (H): what to do now, the controls, how each job works and
 * how to read the screen. It pauses play while it is open.
 */
export class HelpScreen {
  private readonly root = find('#help');
  private readonly list = find('#help-now');
  private readonly tabs = [...this.root.querySelectorAll<HTMLButtonElement>('[data-tab]')];
  private readonly pages = [...this.root.querySelectorAll<HTMLElement>('[data-page]')];
  /** Called when the pilot closes help (button, H or Esc). */
  onClose: (() => void) | null = null;

  constructor() {
    for (const tab of this.tabs) {
      tab.addEventListener('click', () => this.select(tab.dataset.tab as HelpTab));
    }
    find('#help-close').addEventListener('click', () => this.onClose?.());
    window.addEventListener('keydown', (event) => {
      if (!this.open || event.repeat) {
        return;
      }
      if (event.code === 'KeyH' || event.code === 'Escape') {
        event.preventDefault();
        this.onClose?.();
      } else if (/^Digit[1-4]$/.test(event.code)) {
        this.select((['now', 'controls', 'jobs', 'screen'] as const)[Number(event.code.slice(5)) - 1]);
      }
    });
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  /** `advice` fills "What now?"; with none (on the menu) help opens on the controls. */
  show(advice: readonly string[], tab: HelpTab = advice.length > 0 ? 'now' : 'controls'): void {
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
