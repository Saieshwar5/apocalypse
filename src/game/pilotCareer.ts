import { jobList, jobsOpenedAt } from '../logic/jobAccess';
import type { SoundEffects } from '../audio/soundEffects';
import type { Hud } from '../hud/hud';
import type { InputState } from '../input/inputState';
import { RANKS, nextRank, parseCareer, rankFor, recordCareerRun, recordMedal, type RankName } from '../logic/career';
import { JOB_LABEL, totalMedals } from '../logic/medals';
import { addLogEntry } from '../logic/logbook';
import { HARDCORE } from '../logic/reputation';
import { HARDPOINTS, type ModuleId } from '../logic/shipModules';
import { loadCareer, saveCareer } from './careerStore';
import type { GameSession } from './gameSession';
import { MedalBoard } from './medalBoard';
import { ModuleYard } from './moduleYard';
import type { PlaySession } from './playSession';
import type { RadioNet } from './radioNet';

export interface LicenceView {
  rank: string;
  /** 0..1 towards the next rank. */
  progress: number;
  /** What the next rank needs, in words. */
  next: string;
  gold: number;
  seasons: number;
  earned: number;
  runs: number;
}

export interface PilotCareerDependencies {
  session: GameSession;
  hud: Hud;
  sound: SoundEffects;
  input: InputState;
  radio: RadioNet;
  showModules: (fitted: readonly ModuleId[]) => void;
}

/**
 * Everything that lasts between runs: the career record and rank, the
 * hangar of modules and the Vulcan Yard that fits them, the medals, and
 * the choice of a hardcore licence.
 */
export class PilotCareer {
  record = loadCareer();
  private yard: ModuleYard | null = null;
  private medals: MedalBoard | null = null;

  constructor(private readonly deps: PilotCareerDependencies) {}

  get rank(): RankName {
    return rankFor(this.record);
  }

  /** Called once the play session exists. */
  attach(play: PlaySession): void {
    const { session, hud, sound, input, radio } = this.deps;
    this.medals = new MedalBoard({
      session,
      sound,
      radio,
      onMedal: (kind, medal) => {
        const first = medal === 'gold' && this.record.medals[kind].gold === 0;
        this.save(recordMedal(this.record, kind, medal));
        if (first) {
          this.note(`First gold medal: ${JOB_LABEL[kind].toLowerCase().replace(/s$/, '')}`);
        }
      },
    });
    this.yard = new ModuleYard({
      session,
      wallet: session.wallet,
      input,
      hud,
      sound,
      missiles: play.missiles,
      tow: play.services.tow,
      berthedAt: () => play.services.berths.berthedAt,
      applyLoadout: () => play.campaign.applyLoadout(),
      hardpoints: () => (this.rank === 'Senior Pilot' || this.rank === 'Commander' ? HARDPOINTS.senior : HARDPOINTS.base),
      hangar: () => this.record.hangar,
      saveHangar: (hangar) => this.save({ ...this.record, hangar }),
      showModules: this.deps.showModules,
      shipLoss: () => ({ count: play.licence.shipsLost, insured: play.licence.lastLossInsured }),
    });
  }

  /** After the play session has reset for a new run. */
  startRun(hardcore: boolean): void {
    const { session } = this.deps;
    session.hardcore = hardcore;
    session.rank = this.rank;
    session.wallet.payRate = (hardcore ? HARDCORE.payRate : 1) * session.rules.pay;
    session.wallet.loanAllowed = !hardcore;
    this.medals?.reset();
    this.yard?.reset();
  }

  update(deltaSeconds: number): void {
    this.yard?.update();
    this.medals?.update(deltaSeconds);
    this.checkPromotion();
  }

  /** The rank counting what this run has earned so far: a pilot is promoted in flight, not only afterwards. */
  private checkPromotion(): void {
    const { session, hud, radio, sound } = this.deps;
    const now = rankFor({ ...this.record, earned: this.record.earned + session.wallet.earned });
    if (now === session.rank) {
      return;
    }
    session.rank = now;
    const opened = jobList(jobsOpenedAt(now));
    hud.showMessage(`Promoted to ${now}.${opened ? ` Now on your licence: ${opened}` : ''}`, 'success', 6);
    radio.say('control', `{callsign}, the Authority has made you ${now}.${opened ? ` Your licence now covers ${opened}.` : ''} Well earned.`);
    sound.chime();
  }

  markTrainingDone(): void {
    this.save({ ...this.record, trainingDone: true });
  }

  /** Adds the run to the career; returns the rank line for the end screen. */
  recordRun(earned: number, seasonCompleted: boolean, ending: string): string {
    const before = this.rank;
    this.save(recordCareerRun(this.record, earned, seasonCompleted, this.deps.session.hardcore));
    const after = this.rank;
    this.note(`${seasonCompleted ? 'Season completed' : 'Run ended'}: ${ending}. Earned ${Math.round(earned).toLocaleString('en-US')} cr`);
    if (after !== before) {
      this.note(`Promoted to ${after}`);
    }
    return after === before ? after : `${after} (promoted from ${before})`;
  }

  /** A clean slate: rank, earnings, hangar, medals, logbook and secrets. Settings and best runs stay. */
  resetCareer(): void {
    this.save(parseCareer(null));
  }

  /** Writes a line in the pilot's logbook. */
  note(text: string): void {
    this.save({ ...this.record, log: addLogEntry(this.record.log, text, new Date().toISOString().slice(0, 10)) });
  }

  /** Marks a secret found; false if it was found before (it pays only once). */
  discover(id: string): boolean {
    if (this.record.secrets.includes(id)) {
      return false;
    }
    this.save({ ...this.record, secrets: [...this.record.secrets, id] });
    return true;
  }

  /** Fills the menu's logbook list. */
  showLogbook(): void {
    const panel = document.querySelector<HTMLDetailsElement>('#logbook');
    const list = document.querySelector<HTMLOListElement>('#logbook-list');
    if (!panel || !list) {
      return;
    }
    panel.hidden = this.record.log.length === 0;
    list.replaceChildren(
      ...this.record.log.map((entry) => {
        const item = document.createElement('li');
        const time = document.createElement('time');
        time.textContent = entry.date;
        const text = document.createElement('span');
        text.textContent = entry.text;
        item.append(time, text);
        return item;
      }),
    );
  }

  /** This run's medals, for the end screen. */
  runMedals(): string {
    return this.medals?.summary() ?? 'Medals: none';
  }

  /** What the pilot licence on the title screen shows. */
  licenceView(): LicenceView {
    const next = nextRank(this.record);
    const current = RANKS.find((rank) => rank.name === this.rank) ?? RANKS[0];
    const target = RANKS.find((rank) => rank.name === next?.name);
    // Progress by earnings towards the next rank (seasons are named in the line below the bar).
    const span = target ? Math.max(1, target.earned - current.earned) : 1;
    const progress = target ? Math.min(1, Math.max(0, (this.record.earned - current.earned) / span)) : 1;
    const needs = next
      ? [next.earnedNeeded > 0 ? `${next.earnedNeeded.toLocaleString('en-US')} cr more` : '', next.seasonsNeeded > 0 ? `${next.seasonsNeeded} more season${next.seasonsNeeded > 1 ? 's' : ''}` : '']
          .filter(Boolean)
          .join(' and ')
      : '';
    return {
      rank: this.rank,
      progress,
      next: next ? `${needs} to ${next.name}` : 'Highest rank. The orbit is yours to keep',
      gold: totalMedals(this.record.medals, 'gold'),
      seasons: this.record.seasons,
      earned: this.record.earned,
      runs: this.record.runs,
    };
  }

  /** The menu's career line. */
  rankLine(): string {
    const next = nextRank(this.record);
    const needs = next
      ? `: ${[next.earnedNeeded > 0 ? `${next.earnedNeeded.toLocaleString('en-US')} cr more` : '', next.seasonsNeeded > 0 ? `${next.seasonsNeeded} more season${next.seasonsNeeded > 1 ? 's' : ''}` : ''].filter(Boolean).join(' and ')} to ${next.name}`
      : '';
    const gold = totalMedals(this.record.medals, 'gold');
    const medals = gold > 0 ? ` · ${gold} gold medal${gold === 1 ? '' : 's'}` : '';
    return `Rank: ${this.rank}${needs} · career earnings ${this.record.earned.toLocaleString('en-US')} cr${medals}`;
  }

  private save(record: typeof this.record): void {
    this.record = record;
    saveCareer(record);
  }
}
