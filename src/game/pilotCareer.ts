import type { SoundEffects } from '../audio/soundEffects';
import type { Hud } from '../hud/hud';
import type { InputState } from '../input/inputState';
import { nextRank, rankFor, recordCareerRun, recordMedal, type RankName } from '../logic/career';
import { totalMedals } from '../logic/medals';
import { HARDCORE } from '../logic/reputation';
import { HARDPOINTS, type ModuleId } from '../logic/shipModules';
import { loadCareer, saveCareer } from './careerStore';
import type { GameSession } from './gameSession';
import { MedalBoard } from './medalBoard';
import { ModuleYard } from './moduleYard';
import type { PlaySession } from './playSession';
import type { RadioNet } from './radioNet';

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
      onMedal: (kind, medal) => this.save(recordMedal(this.record, kind, medal)),
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
    session.wallet.payRate = hardcore ? HARDCORE.payRate : 1;
    session.wallet.loanAllowed = !hardcore;
    this.medals?.reset();
    this.yard?.reset();
  }

  update(deltaSeconds: number): void {
    this.yard?.update();
    this.medals?.update(deltaSeconds);
  }

  markTrainingDone(): void {
    this.save({ ...this.record, trainingDone: true });
  }

  /** Adds the run to the career; returns the rank line for the end screen. */
  recordRun(earned: number, seasonCompleted: boolean): string {
    const before = this.rank;
    this.save(recordCareerRun(this.record, earned, seasonCompleted, this.deps.session.hardcore));
    const after = this.rank;
    return after === before ? after : `${after} (promoted from ${before})`;
  }

  /** This run's medals, for the end screen. */
  runMedals(): string {
    return this.medals?.summary() ?? 'Medals: none';
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
