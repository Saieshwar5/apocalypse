import type { Hud } from '../hud/hud';
import { HelpScreen } from '../hud/helpScreen';
import type { InputState } from '../input/inputState';
import { duties, type MissionReadings } from '../logic/mission';

/** Set once the pilot has been shown the mission page before a launch. */
const BRIEFED_KEY = 'singularity.briefed.v1';

/** No key or mouse for this long in flight: suggest the help screen. */
const IDLE_SECONDS = 15;

export interface HelpDeskDependencies {
  input: InputState;
  hud: Hud;
  /** Advice for "What now?" from the current run. */
  advice: () => string[];
  /** How the five duties stand in the current run. */
  readings: () => MissionReadings;
  /** Freezes play (no pause screen); resumes flight; shows the pause screen again. */
  pause: () => void;
  resume: () => void;
  showPause: () => void;
  hidePause: () => void;
}

/**
 * Opens help from flight (H), from the pause screen and from the menu, and
 * returns to wherever the pilot came from. Also suggests it when the pilot
 * has been idle for a while.
 */
export class HelpDesk {
  private readonly screen = new HelpScreen();
  private from: 'flight' | 'pause' | 'menu' | 'briefing' = 'flight';
  private afterBriefing: (() => void) | null = null;
  private idlePrompted = false;

  constructor(private readonly deps: HelpDeskDependencies) {
    this.screen.onClose = () => this.close();
    document.querySelector('#menu-help-button')?.addEventListener('click', () => {
      this.from = 'menu';
      this.screen.show([], duties(null), 'mission', 'Back to the menu');
    });
    document.querySelector('#pause-help-button')?.addEventListener('click', () => {
      this.from = 'pause';
      deps.hidePause();
      this.screen.show(deps.advice(), duties(deps.readings()), 'now', 'Back');
    });
  }

  get open(): boolean {
    return this.screen.open;
  }

  /** In flight: H opens help; a long idle spell suggests it. */
  update(): void {
    const { input, hud } = this.deps;
    if (input.consumePress('KeyH')) {
      this.from = 'flight';
      this.deps.pause();
      this.screen.show(this.deps.advice(), duties(this.deps.readings()), 'now', 'Back to flight');
      return;
    }
    if (input.busy) {
      input.lastActivity = performance.now();
    }
    const idle = (performance.now() - input.lastActivity) / 1000 > IDLE_SECONDS;
    if (idle && !this.idlePrompted) {
      hud.showMessage('Not sure what to do? Press H for help', 'info', 4);
      this.idlePrompted = true;
    } else if (!idle) {
      this.idlePrompted = false;
    }
  }

  /** True until the pilot has read the mission page before a launch. */
  get needsBriefing(): boolean {
    try {
      return window.localStorage.getItem(BRIEFED_KEY) === null;
    } catch {
      return false;
    }
  }

  /** A new pilot's first launch: the mission page first, then `start`. */
  brief(start: () => void): void {
    try {
      window.localStorage.setItem(BRIEFED_KEY, '1');
    } catch {
      // Storage unavailable: the briefing simply is not remembered.
    }
    this.from = 'briefing';
    this.afterBriefing = start;
    this.screen.show([], duties(null), 'mission', 'Start flying', 'Before you launch');
  }

  private close(): void {
    this.screen.hide();
    if (this.from === 'briefing') {
      const start = this.afterBriefing;
      this.afterBriefing = null;
      start?.();
      return;
    }
    if (this.from === 'flight') {
      this.deps.resume();
    } else if (this.from === 'pause') {
      this.deps.showPause();
    }
  }
}
