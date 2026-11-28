import type { RadioLogEntry } from '../game/radioNet';
import { formatCountdown } from '../logic/units';

/** The radio log (L): the last lines said on the channel, newest at the bottom, so nothing is missed. */
export class RadioLog {
  private readonly panel = document.querySelector<HTMLElement>('#radio-log');
  private readonly list = document.querySelector<HTMLOListElement>('#radio-log-list');
  private shown = -1;

  get open(): boolean {
    return this.panel ? !this.panel.hidden : false;
  }

  toggle(): void {
    if (this.panel) {
      this.panel.hidden = !this.panel.hidden;
      this.shown = -1;
    }
  }

  close(): void {
    if (this.panel) {
      this.panel.hidden = true;
    }
  }

  /** Redraws when new lines have been said. */
  update(entries: readonly RadioLogEntry[]): void {
    if (!this.open || !this.list || entries.length === this.shown) {
      return;
    }
    this.shown = entries.length;
    this.list.replaceChildren(
      ...(entries.length === 0
        ? [Object.assign(document.createElement('li'), { textContent: 'Nothing on the radio yet.' })]
        : entries.map((entry) => {
            const item = document.createElement('li');
            const time = document.createElement('time');
            time.textContent = formatCountdown(entry.at);
            const name = document.createElement('strong');
            name.textContent = entry.speaker;
            name.style.color = entry.color;
            item.append(time, name, document.createTextNode(entry.text));
            return item;
          })),
    );
    this.list.lastElementChild?.scrollIntoView({ block: 'end' });
  }
}
