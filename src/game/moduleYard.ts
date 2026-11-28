import type { SoundEffects } from '../audio/soundEffects';
import type { Hud } from '../hud/hud';
import type { InputState } from '../input/inputState';
import { formatCredits } from '../logic/contracts';
import { MODULES, afterShipLoss, handlingShare, moduleById, moduleEffects, yardAction, type Hangar } from '../logic/shipModules';
import type { Wallet } from '../logic/economy';
import type { MissileLauncher } from '../weapons/missileLauncher';
import type { GameSession } from './gameSession';
import type { TowLine } from './towLine';

export interface ModuleYardDependencies {
  session: GameSession;
  wallet: Wallet;
  input: InputState;
  hud: Hud;
  sound: SoundEffects;
  missiles: MissileLauncher;
  tow: TowLine;
  /** Where the ship is berthed, if anywhere. */
  berthedAt: () => string | null;
  /** Pushes the new fit into the ship, weapons and fuel tank. */
  applyLoadout: () => void;
  hardpoints: () => number;
  /** The career's hangar, and where to keep it after a change. */
  hangar: () => Hangar;
  saveHangar: (hangar: Hangar) => void;
  /** Ships lost this run, and whether the last one was insured. */
  shipLoss: () => { count: number; insured: boolean };
}

interface Row {
  root: HTMLLIElement;
  cost: HTMLSpanElement;
}

/**
 * Vulcan Yard's module shop. Berthed at Vulcan, the number keys buy a
 * module, bolt an owned one to a free hardpoint, or take one off. The panel
 * shows the hardpoints in use and how much the ship's handling suffers.
 */
export class ModuleYard {
  private readonly panel = find('#yard');
  private readonly credits = find('#yard-credits');
  private readonly slots = find('#yard-slots');
  private readonly handling = find('#yard-handling');
  private readonly bar = find('#yard-handling-bar');
  private readonly rows: Row[] = [];
  private lastState = '';
  private lossesSeen = 0;

  constructor(private readonly deps: ModuleYardDependencies) {
    const list = find('#yard-list');
    list.replaceChildren();
    MODULES.forEach((module, index) => {
      const root = document.createElement('li');
      const key = document.createElement('kbd');
      key.textContent = String(index + 1);
      const name = document.createElement('span');
      name.className = 'workshop-name';
      const title = document.createElement('b');
      title.textContent = module.name;
      const effect = document.createElement('small');
      effect.textContent = module.effect;
      name.append(title, effect);
      const mass = document.createElement('span');
      mass.className = 'workshop-level';
      mass.textContent = `+${Math.round(module.mass * 100)}% mass`;
      const cost = document.createElement('span');
      cost.className = 'workshop-cost';
      root.append(key, name, mass, cost);
      list.append(root);
      this.rows.push({ root, cost });
    });
  }

  /** At the start of a run: fit the ship from the career's hangar. */
  reset(): void {
    this.lossesSeen = 0;
    this.lastState = '';
    this.apply(this.deps.hangar());
  }

  update(): void {
    this.checkShipLoss();
    const atYard = this.deps.berthedAt() === 'vulcan';
    if (atYard) {
      this.handleKeys();
    }
    this.draw(atYard);
  }

  private handleKeys(): void {
    const { input, hud, sound, wallet } = this.deps;
    MODULES.forEach((module, index) => {
      if (!input.consumePress(`Digit${index + 1}`)) {
        return;
      }
      const result = yardAction(this.deps.hangar(), module.id, wallet.balance, this.deps.hardpoints());
      if (!result.ok) {
        const why = result.reason === 'too-expensive' ? `Not enough money for the ${module.name.toLowerCase()} (${formatCredits(module.price)})` : 'Every hardpoint is in use. Take a module off first';
        hud.showMessage(why, 'warning', 2.5);
        return;
      }
      if (result.cost > 0 && !wallet.spend(result.cost)) {
        return;
      }
      const fitted = result.hangar.fitted.includes(module.id);
      this.apply(result.hangar);
      if (module.id === 'missilePod' && fitted && result.action === 'bought') {
        // A new pod comes off the rack loaded; refitting an old one does not refill it.
        this.deps.missiles.resupply(this.deps.session.fit.extraMissiles);
      }
      const share = Math.round(handlingShare(this.deps.session.fit.massFactor) * 100);
      const verb = result.action === 'removed' ? 'removed' : fitted ? 'fitted' : 'bought and stored as a spare';
      hud.showMessage(`${module.name} ${verb}. Handling ${share}%`, 'success', 2.5);
      sound.dockClamp();
    });
  }

  /** Uninsured, the modules bolted on went down with the ship. */
  private checkShipLoss(): void {
    const loss = this.deps.shipLoss();
    if (loss.count <= this.lossesSeen) {
      return;
    }
    this.lossesSeen = loss.count;
    const before = this.deps.hangar();
    const after = afterShipLoss(before, loss.insured);
    if (after.fitted.length !== before.fitted.length) {
      const lost = before.fitted.map((id) => moduleById(id).name.toLowerCase()).join(' and ');
      this.deps.hud.showMessage(`Uninsured: the ${lost} went down with the ship`, 'danger', 4);
    }
    this.apply(after);
  }

  private apply(hangar: Hangar): void {
    const { session, tow } = this.deps;
    this.deps.saveHangar(hangar);
    session.fit = moduleEffects(hangar.fitted);
    tow.lineFit = { shipMass: session.fit.massFactor, lineStrength: session.fit.lineStrength, lineSteadying: session.fit.lineSteadying };
    this.deps.applyLoadout();
  }

  private draw(visible: boolean): void {
    const hangar = this.deps.hangar();
    const balance = this.deps.wallet.balance;
    const hardpoints = this.deps.hardpoints();
    const state = `${visible}|${Math.floor(balance)}|${hangar.owned.join()}|${hangar.fitted.join()}|${hardpoints}`;
    if (state === this.lastState) {
      return;
    }
    this.lastState = state;
    this.panel.hidden = !visible;
    this.credits.textContent = formatCredits(balance);
    this.slots.textContent = `HARDPOINTS ${hangar.fitted.length}/${hardpoints}`;
    const share = handlingShare(this.deps.session.fit.massFactor);
    this.handling.textContent = `HANDLING ${Math.round(share * 100)}%`;
    this.bar.style.width = `${Math.round(share * 100)}%`;
    MODULES.forEach((module, index) => {
      const row = this.rows[index];
      const fitted = hangar.fitted.includes(module.id);
      const owned = hangar.owned.includes(module.id);
      row.cost.textContent = fitted ? 'FITTED' : owned ? 'FIT' : module.price.toLocaleString('en-US');
      row.root.dataset.state = fitted ? 'fitted' : owned ? 'spare' : module.price <= balance ? 'affordable' : 'locked';
    });
  }
}

function find<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) {
    throw new Error(`Yard element ${selector} is missing from index.html`);
  }
  return found;
}
