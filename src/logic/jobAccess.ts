import type { CargoKind } from './cargo';
import { RANKS, type RankName } from './career';

/**
 * Which work a pilot's licence covers. A Cadet flies the three jobs that
 * need only flying, shooting and berthing; towing and escorting come with
 * the Pilot rank, and the jobs where lives or a new satellite are at stake
 * with Senior Pilot. A new pilot meets the game three jobs at a time.
 */
export type JobId = 'intercept' | 'cargo' | 'sweep' | 'satelliteTow' | 'guard' | 'escort' | 'urgentCargo' | 'fragileCargo' | 'rescue' | 'passengers' | 'deploy';

export const JOB_RANK: Record<JobId, RankName> = {
  intercept: 'Cadet',
  cargo: 'Cadet',
  sweep: 'Cadet',
  satelliteTow: 'Pilot',
  guard: 'Pilot',
  escort: 'Pilot',
  urgentCargo: 'Pilot',
  fragileCargo: 'Pilot',
  rescue: 'Senior Pilot',
  passengers: 'Senior Pilot',
  deploy: 'Senior Pilot',
};

export const JOB_NAME: Record<JobId, string> = {
  intercept: 'intercepts',
  cargo: 'cargo runs',
  sweep: 'debris sweeps',
  satelliteTow: 'satellite tows',
  guard: 'guarding satellites',
  escort: 'rocket escorts',
  urgentCargo: 'urgent cargo',
  fragileCargo: 'fragile cargo',
  rescue: 'rescues',
  passengers: 'passengers',
  deploy: 'deploying satellites',
};

function level(rank: RankName): number {
  return RANKS.findIndex((candidate) => candidate.name === rank);
}

export function jobUnlocked(job: JobId, rank: RankName): boolean {
  return level(rank) >= level(JOB_RANK[job]);
}

/** The jobs that first open at exactly this rank. */
export function jobsOpenedAt(rank: RankName): JobId[] {
  return (Object.keys(JOB_RANK) as JobId[]).filter((job) => JOB_RANK[job] === rank);
}

/** "satellite tows, guarding satellites and rocket escorts", for announcements and the licence card. */
export function jobList(jobs: readonly JobId[]): string {
  const names = jobs.map((job) => JOB_NAME[job]);
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

const CARGO_JOB: Record<CargoKind, JobId> = { routine: 'cargo', urgent: 'urgentCargo', fragile: 'fragileCargo', passengers: 'passengers' };

/** The kinds of transfer a pilot of this rank is offered. */
export function cargoKindsFor(rank: RankName): CargoKind[] {
  return (Object.keys(CARGO_JOB) as CargoKind[]).filter((kind) => jobUnlocked(CARGO_JOB[kind], rank));
}
