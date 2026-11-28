import type { InterceptVerdict } from './guidance';
import { LASER_RANGE } from './ballistics';
import { MISSILE_BLAST } from './shipDefense';
import { DOCKING } from './stationSupply';
import { formatCountdown, formatDistance, formatSpeed } from './units';

/**
 * "What should I do now?": plain advice written from the pilot's actual
 * situation, most important first. Shown at the top of the help screen.
 */
export interface WhatNowSituation {
  calm: boolean;
  threat: {
    name: string;
    site: string | null;
    seconds: number | null;
    verdict: InterceptVerdict;
    distance: number;
    /** Iron or a giant: the laser will not do. */
    needsMissiles: boolean;
  } | null;
  job: { title: string; detail: string } | null;
  /** Percent. */
  fuel: number;
  hull: number;
  missiles: number;
  docked: boolean;
  berthedAt: string | null;
  towing: boolean;
  storm: 'clear' | 'warning' | 'storm';
  sheltered: boolean;
  licenceGood: boolean;
  orbitHealth: number;
  /** Name of what the compass points at, if anything. */
  objective: string | null;
}

export function whatNow(situation: WhatNowSituation): string[] {
  const advice: string[] = [];
  const { threat } = situation;
  if (situation.storm !== 'clear' && !situation.sheltered) {
    advice.push("Solar storm: get into Earth's shadow (the night side) or dock at a station until it passes.");
  }
  if (situation.docked) {
    advice.push('You are docked at Aegis: 1-8 buy upgrades, I insures the ship, W launches.');
  } else if (situation.berthedAt) {
    const modules = situation.berthedAt === 'VULCAN YARD' ? ' 1-7 buys and fits modules.' : '';
    advice.push(`You are berthed at ${situation.berthedAt}: the ship is refuelling.${modules} W launches.`);
  }
  if (situation.hull < 30) {
    advice.push('Hull is low: repair at Aegis or, cheaper, at Vulcan Yard. One more hard hit could lose the ship.');
  }
  if (situation.fuel < 20 && !situation.docked && !situation.berthedAt) {
    advice.push(`Fuel is low: fly to Aegis, brake below ${formatSpeed(DOCKING.maxRelativeSpeed)} beside it and let go to dock. Ceres sells the cheapest fuel. Press G until the compass says HOME.`);
  }
  if (situation.towing) {
    advice.push('Something is on your tow line: fly it to the cyan diamond, nearly stop, then press T to release.');
  }
  if (threat) {
    const when = threat.seconds === null ? '' : ` in ${formatCountdown(threat.seconds)}`;
    const where = threat.site ? `${threat.site}` : 'Earth';
    advice.push(`${threat.name} will hit ${where}${when}, ${formatDistance(threat.distance)} away. Turn towards the dot on the compass by the crosshair until it says ON TARGET, then thrust (W).`);
    if (threat.verdict === 'too-late') {
      advice.push('You cannot reach it in time: leave it and take the next one.');
    } else if (threat.verdict === 'tight') {
      advice.push('It will be tight: boost (Shift) on the way.');
    }
    advice.push(
      threat.needsMissiles
        ? `Lasers barely scratch this one: lock it and fire missiles (F), but not from closer than ${formatDistance(MISSILE_BLAST.radius + 2)}: the blast hurts you too.`
        : `Lasers are short-range: get within ${formatDistance(LASER_RANGE.optimal)} and fire (click or Space). Brake (S) as you arrive so you do not fly past.`,
    );
  }
  if (situation.job) {
    advice.push(`Job: ${situation.job.title}. ${capitalise(situation.job.detail)}.`);
  }
  if (!situation.licenceGood) {
    advice.push('Your licence is under review: finish contracts cleanly and never hit satellites or other pilots.');
  }
  if (situation.orbitHealth < 50) {
    advice.push('Orbit health is falling: fly slowly through debris clouds to sweep them, and push rocks off course instead of shattering them.');
  }
  if (!threat && !situation.job && !situation.docked && !situation.berthedAt) {
    advice.push(
      situation.calm
        ? 'Calm zone: refuel and repair at a station, buy upgrades at Aegis or modules at Vulcan Yard, sweep debris for pay, or press Enter to move on to the next field.'
        : 'Nothing is threatening Earth right now. Fly near unknown contacts to scan them, or sweep a debris cloud.',
    );
  }
  if (situation.objective) {
    advice.push(`The compass points at: ${situation.objective}. N picks anything by name (a station, a satellite), U flies you there on autopilot, and the line under the compass says what to do next.`);
  }
  return advice.slice(0, 6);
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
