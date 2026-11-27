import { siteCondition } from '../logic/prioritySites';
import { formatCountdown } from '../logic/units';
import type { SiteState } from '../sites/siteDefence';

/** HUD list of priority sites: name, health bar and any incoming threat. */
export class SitePanel {
  private readonly rows = new Map<string, { row: HTMLLIElement; fill: HTMLDivElement; status: HTMLSpanElement }>();

  constructor(list: HTMLOListElement, sites: readonly SiteState[]) {
    list.replaceChildren();
    for (const site of sites) {
      const row = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'site-name';
      name.textContent = site.definition.name;
      const bar = document.createElement('div');
      bar.className = 'bar';
      const fill = document.createElement('div');
      fill.className = 'bar-fill';
      bar.append(fill);
      const status = document.createElement('span');
      status.className = 'site-status';
      row.append(name, bar, status);
      list.append(row);
      this.rows.set(site.definition.id, { row, fill, status });
    }
  }

  update(sites: readonly SiteState[]): void {
    for (const site of sites) {
      const entry = this.rows.get(site.definition.id);
      if (!entry) {
        continue;
      }
      const condition = siteCondition(site.health);
      const threatened = site.threatenedIn !== null && condition !== 'destroyed';
      const text = condition === 'destroyed' ? 'LOST' : threatened ? formatCountdown(site.threatenedIn ?? 0) : '';
      // Only touch the DOM when something changed.
      const state = `${condition}|${threatened}`;
      if (entry.row.dataset.state !== state) {
        entry.row.dataset.state = state;
        entry.row.dataset.condition = condition;
        entry.row.classList.toggle('threatened', threatened);
        entry.fill.dataset.level = condition === 'intact' ? 'stable' : condition === 'damaged' ? 'damaged' : 'critical';
      }
      const width = `${Math.ceil(site.health)}%`;
      if (entry.fill.style.width !== width) {
        entry.fill.style.width = width;
      }
      if (entry.status.textContent !== text) {
        entry.status.textContent = text;
      }
    }
  }
}
