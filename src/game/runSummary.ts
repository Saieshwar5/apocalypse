import { DIFFICULTY } from '../logic/difficulty';
import { saveRun } from './runHistory';
import { orbitRating } from '../logic/orbitPlan';
import type { RunRecord } from '../logic/bestRuns';
import { nextSystem, type StarSystem } from '../logic/starSystems';
import { pilotName } from '../logic/rivals';
import type { RunSummary } from './gameScreens';
import type { GameSession } from './gameSession';
import type { PilotCareer } from './pilotCareer';
import type { PlaySession } from './playSession';

/** Everything the end screen shows about a run; also records it in the best runs and the career. */
export function runSummary(
  play: PlaySession,
  session: GameSession,
  career: PilotCareer,
  system: StarSystem,
  systemIndex: number,
  reason: string,
  victory: boolean,
): RunSummary {
  const { citiesStanding, cityCount } = play.sites;
  const current: RunRecord = {
    earned: session.wallet.earned,
    planet: system.planet,
    victory,
    stars: orbitRating(session.integrity, citiesStanding, cityCount),
    citiesStanding,
    cityCount,
    date: new Date().toISOString().slice(0, 10),
  };
  const next = victory ? nextSystem(systemIndex) : null;
  return {
    planet: system.planet,
    nextStar: next?.star ?? null,
    bestRuns: saveRun(current),
    current,
    earned: session.wallet.earned,
    spent: session.wallet.spent,
    balance: session.wallet.balance,
    contractsCompleted: play.contracts.contractsCompleted,
    contractsLost: play.contracts.contractsLost,
    orbitHealth: play.services.debris.health,
    reputation: play.licence.reputation,
    licence: play.licence.stage,
    shipsLost: play.licence.shipsLost,
    rank: career.recordRun(session.wallet.earned, victory && play.licence.stage === 'good', reason),
    medals: career.runMedals(),
    hardcore: session.hardcore,
    difficulty: DIFFICULTY[session.difficulty].label,
    debrisSwept: play.services.debris.swept,
    league: session.league().map(({ pilot, earned }) => ({ name: pilotName(pilot), earned, you: pilot === 'player' })),
    wavesCleared: session.wavesCleared,
    asteroidsDestroyed: session.asteroidsDestroyed,
    impacts: session.totalImpacts,
    citiesStanding: play.sites.citiesStanding,
    cityCount: play.sites.cityCount,
    reason,
    victory,
    integrity: session.integrity,
  };
}
