import { MAX_PLANET_INTEGRITY } from '../logic/planetDamage';
import { Wallet } from '../logic/economy';
import { GameEvents } from './gameEvents';
import { RIVALS, pilotName, type PilotId, type RivalId } from '../logic/rivals';

/** Money and progress for one play-through. */
export class GameSession {
  integrity = MAX_PLANET_INTEGRITY;
  /** The pilot's money: contracts pay in, the station and fines take out. */
  readonly wallet = new Wallet();
  /** Things that happened this run that the licence keeps account of. */
  readonly events = new GameEvents();
  /** The rival pilots' earnings, for the league table. */
  readonly rivalWallets = Object.fromEntries(RIVALS.map((rival) => [rival.id, new Wallet()])) as Record<RivalId, Wallet>;
  asteroidsDestroyed = 0;
  impactsThisWave = 0;
  destroyedThisWave = 0;
  totalImpacts = 0;
  wavesCleared = 0;
  sitesLost = 0;
  /** Asteroids that burned up harmlessly in the atmosphere. */
  burnUps = 0;

  /** New star system in the same campaign: the planet is fresh, the money carries on. */
  resetForNextSystem(): void {
    const { asteroidsDestroyed } = this;
    const keep = [this.wallet, ...Object.values(this.rivalWallets)].map(({ balance, earned, spent, fines }) => ({ balance, earned, spent, fines }));
    this.reset();
    [this.wallet, ...Object.values(this.rivalWallets)].forEach((wallet, index) => Object.assign(wallet, keep[index]));
    this.asteroidsDestroyed = asteroidsDestroyed;
  }

  /** Every pilot's earnings, best first. */
  league(): { pilot: PilotId; earned: number }[] {
    const rows: { pilot: PilotId; earned: number }[] = [{ pilot: 'player', earned: this.wallet.earned }];
    for (const rival of RIVALS) {
      rows.push({ pilot: rival.id, earned: this.rivalWallets[rival.id].earned });
    }
    return rows.sort((a, b) => b.earned - a.earned);
  }

  /** The league for the HUD: names, earnings and colours, best first. */
  leagueRows(): { name: string; earned: number; color: string; you: boolean }[] {
    return this.league().map(({ pilot, earned }) => ({
      name: pilotName(pilot),
      earned,
      color: pilot === 'player' ? '#7dffb0' : (RIVALS.find((rival) => rival.id === pilot)?.color ?? '#e8f1ff'),
      you: pilot === 'player',
    }));
  }

  /** The wallet of any pilot. */
  walletOf(pilot: PilotId): Wallet {
    return pilot === 'player' ? this.wallet : this.rivalWallets[pilot];
  }

  reset(): void {
    this.integrity = MAX_PLANET_INTEGRITY;
    this.wallet.reset();
    for (const wallet of Object.values(this.rivalWallets)) {
      wallet.reset();
    }
    this.asteroidsDestroyed = 0;
    this.impactsThisWave = 0;
    this.destroyedThisWave = 0;
    this.totalImpacts = 0;
    this.wavesCleared = 0;
    this.sitesLost = 0;
    this.burnUps = 0;
  }
}
