import { UPGRADES, nextCost, type UpgradeLevels } from '../logic/upgrades';

/**
 * The station workshop, shown while docked. Upgrades are bought with the
 * number keys because the mouse is captured for flying.
 */
export class WorkshopPanel {
  private readonly rows: { root: HTMLLIElement; cost: HTMLSpanElement; level: HTMLSpanElement }[] = [];
  private lastState = '';

  constructor(
    private readonly panel: HTMLElement,
    private readonly credits: HTMLElement,
    list: HTMLOListElement,
  ) {
    list.replaceChildren();
    UPGRADES.forEach((upgrade, index) => {
      const root = document.createElement('li');
      const key = document.createElement('kbd');
      key.textContent = String(index + 1);
      const name = document.createElement('span');
      name.className = 'workshop-name';
      name.textContent = `${upgrade.name} · ${upgrade.effect}`;
      const level = document.createElement('span');
      level.className = 'workshop-level';
      const cost = document.createElement('span');
      cost.className = 'workshop-cost';
      root.append(key, name, level, cost);
      list.append(root);
      this.rows.push({ root, cost, level });
    });
  }

  update(visible: boolean, levels: UpgradeLevels, credits: number): void {
    const state = `${visible}|${credits}|${Object.values(levels).join(',')}`;
    if (state === this.lastState) {
      return;
    }
    this.lastState = state;
    this.panel.hidden = !visible;
    this.credits.textContent = credits.toLocaleString();
    UPGRADES.forEach((upgrade, index) => {
      const row = this.rows[index];
      const cost = nextCost(levels, upgrade.id);
      row.level.textContent = `${levels[upgrade.id]}/${upgrade.costs.length}`;
      row.cost.textContent = cost === null ? 'MAX' : cost.toLocaleString();
      row.root.dataset.state = cost === null ? 'maxed' : cost <= credits ? 'affordable' : 'locked';
    });
  }
}
