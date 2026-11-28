import { CASCADE } from './cascade';
import type { LicenceStage } from './reputation';

/**
 * The pilot's mission in plain words: who they are, the five things in
 * their care, the people on the radio and how a run ends. Each duty can
 * carry a live reading from the current run, so the page shows how the
 * pilot is doing, not only what the job is.
 */
export type DutyId = 'earth' | 'orbit' | 'satellites' | 'stations' | 'people';

export type ReadingState = 'good' | 'watch' | 'bad';

export interface MissionReadings {
  /** Earth integrity, 0 to 100. */
  earth: number;
  sitesStanding: number;
  sitesTotal: number;
  /** Orbit Health, 0 to 100. */
  orbitHealth: number;
  satellitesWorking: number;
  satellitesTotal: number;
  /** Aegis Station's stock as shares of full, 0 to 1; null when there is no station. */
  aegis: { fuel: number; missiles: number } | null;
  licence: { stage: LicenceStage; score: number };
}

export interface Duty {
  id: DutyId;
  title: string;
  /** What it means. */
  why: string;
  /** The work that serves it. */
  how: string;
  /** What happens if it is neglected. */
  cost: string;
  reading: { text: string; state: ReadingState } | null;
}

export const ROLE: readonly string[] = [
  'You are a contract pilot for the Earth Defence Authority, flying an interceptor out of Aegis Station.',
  'For one full orbit, split into 14 sectors, Earth crosses a stream of comet debris. Dangerous sectors bring rocks; calm sectors are for repairs, refuelling and paid work around the stations.',
  'Nobody gives you orders. The contract board offers jobs, you choose which to take, and every job is paid. A Cadet starts with three kinds of work; more open as you are promoted. Five things are in your care, and the run is judged on all of them.',
];

const STATIC: readonly Omit<Duty, 'reading'>[] = [
  {
    id: 'earth',
    title: 'Protect Earth',
    why: 'Rocks from the stream fall towards cities, the radar and the launch site.',
    how: 'Intercept contracts: destroy a rock with the laser or a missile, or push it off course so it misses.',
    cost: 'Every rock that lands takes Earth Integrity down and can destroy a site for good. Without the radar your scanner sees half as far; without the launch site no supplies reach Aegis.',
  },
  {
    id: 'orbit',
    title: 'Keep the orbit clean',
    why: 'A shattered rock leaves debris in orbit. Debris breaks satellites, and broken satellites make more debris.',
    how: 'Sweep debris clouds (fly slowly through the amber rings), and push rocks off course instead of shattering them when you can.',
    cost: `Orbit Health falls. Below ${CASCADE.tippingHealth}% debris multiplies by itself, and at zero the orbit is closed for good.`,
  },
  {
    id: 'satellites',
    title: 'Look after the satellites',
    why: 'They relay tracking data, so your scanner sees further for each one still working.',
    how: 'Satellite tows to Vulcan Yard and back or up out of the atmosphere, guarding a satellite from a rock, and carrying a replacement from the yard to an empty slot.',
    cost: 'A lost satellite shortens your scanner range and leaves a debris cloud where it was. Only a senior pilot can bring out a replacement.',
  },
  {
    id: 'stations',
    title: 'Keep the stations supplied',
    why: 'Aegis gives you fuel, missiles and repairs. Its stock arrives by supply rocket after each field, while the Launch Complex stands.',
    how: 'Cargo runs carry fuel and parts from the depot at Ceres Works to whichever station is short. Escort the supply rocket through the debris.',
    cost: 'Stations run short: fuel costs more, and there may be no missiles left when you dock.',
  },
  {
    id: 'people',
    title: 'Protect people and fly clean',
    why: 'Crews work outside, escape pods drift, and the stations and satellites are full of expensive, fragile things.',
    how: 'Rescue pods before they burn up, carry passengers gently, and never shoot or ram a satellite, a station or another pilot.',
    cost: 'Your licence standing falls: a warning, then probation, then you are recalled to Earth.',
  },
];

function level(value: number, watchBelow: number, badBelow: number): ReadingState {
  return value < badBelow ? 'bad' : value < watchBelow ? 'watch' : 'good';
}

const LICENCE_STATE: Record<LicenceStage, ReadingState> = { good: 'good', warning: 'watch', probation: 'bad', recalled: 'bad' };
const LICENCE_TEXT: Record<LicenceStage, string> = { good: 'good standing', warning: 'warning', probation: 'on probation', recalled: 'recalled' };

function percent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(100, value)))}%`;
}

function reading(id: DutyId, r: MissionReadings): Duty['reading'] {
  switch (id) {
    case 'earth': {
      const lost = r.sitesTotal - r.sitesStanding;
      return {
        text: `Earth ${percent(r.earth)} · ${r.sitesStanding} of ${r.sitesTotal} sites standing`,
        state: lost > 0 && r.earth >= 40 ? 'watch' : level(r.earth, 70, 40),
      };
    }
    case 'orbit':
      return { text: `Orbit Health ${percent(r.orbitHealth)}`, state: level(r.orbitHealth, 70, CASCADE.tippingHealth + 10) };
    case 'satellites': {
      const share = r.satellitesTotal > 0 ? r.satellitesWorking / r.satellitesTotal : 1;
      return { text: `${r.satellitesWorking} of ${r.satellitesTotal} satellites working`, state: level(share, 1, 0.6) };
    }
    case 'stations':
      if (!r.aegis) {
        return null;
      }
      return {
        text: `Aegis: fuel ${percent(r.aegis.fuel * 100)} · missiles ${percent(r.aegis.missiles * 100)}`,
        state: level(Math.min(r.aegis.fuel, r.aegis.missiles), 0.4, 0.15),
      };
    case 'people':
      return { text: `Licence: ${LICENCE_TEXT[r.licence.stage]} (${Math.round(r.licence.score)})`, state: LICENCE_STATE[r.licence.stage] };
  }
}

/** The five duties, with live readings when a run is in progress. */
export function duties(readings: MissionReadings | null): Duty[] {
  return STATIC.map((duty) => ({ ...duty, reading: readings ? reading(duty.id, readings) : null }));
}

const SEVERITY: Record<ReadingState, number> = { good: 0, watch: 1, bad: 2 };

/** The duty that most needs the pilot now, or null when all are in good shape. */
export function weakestDuty(list: readonly Duty[]): DutyId | null {
  let worst: Duty | null = null;
  for (const duty of list) {
    if (duty.reading && SEVERITY[duty.reading.state] > (worst?.reading ? SEVERITY[worst.reading.state] : 0)) {
      worst = duty;
    }
  }
  return worst?.id ?? null;
}

export interface Person {
  name: string;
  role: string;
}

export const PEOPLE: readonly Person[] = [
  { name: 'Capcom Reyes', role: 'Your controller. Warns you about fields, storms and trouble.' },
  { name: 'Chief Okafor, Vulcan Yard', role: 'Repairs satellites and sells ship modules.' },
  { name: 'Foreman Patel, Ceres Works', role: 'Runs the depot that makes the orbit\'s fuel and parts.' },
  { name: 'Commander Sato, Halo', role: 'Looks after the people of the orbit: passengers and rescues.' },
  { name: 'Kestrel and Moth', role: 'Rival pilots after the same contracts. They are not enemies.' },
];

export interface Ending {
  title: string;
  text: string;
  win: boolean;
}

export const ENDINGS: readonly Ending[] = [
  { title: 'Season complete', text: 'Earth clears the stream after 14 sectors. Your pay and medals go on your career.', win: true },
  { title: 'Earth has fallen', text: 'Earth Integrity reached zero.', win: false },
  { title: 'The Singularity', text: 'Orbit Health reached zero: debris multiplied until nothing could fly.', win: false },
  { title: 'Licence revoked', text: 'You failed probation and were recalled.', win: false },
  { title: 'Ship lost, no replacement', text: 'You could not pay for a new ship, even with the emergency loan. Insurance at Aegis makes one much cheaper.', win: false },
];
