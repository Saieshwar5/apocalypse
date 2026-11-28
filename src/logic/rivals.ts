/**
 * Rival pilots: competitors working the same orbit under the same rules as
 * the player. They never attack anyone; they race for contracts.
 */
export type PilotId = 'player' | 'kestrel' | 'moth';
export type RivalId = Exclude<PilotId, 'player'>;
export type RivalStyle = 'hunter' | 'hauler';

export interface RivalDefinition {
  id: RivalId;
  name: string;
  callSign: string;
  style: RivalStyle;
  /** HUD, scanner and paint colour. */
  color: string;
  /** Paint tint applied to the shared ship model. */
  tint: [number, number, number];
  /** Seconds between decisions: a slower rival is easier to beat to a target. */
  decisionSeconds: number;
  /** Voice pitch for radio lines. */
  pitch: number;
}

export const RIVALS: readonly RivalDefinition[] = [
  { id: 'kestrel', name: 'KESTREL', callSign: 'KES', style: 'hunter', color: '#ff6b5e', tint: [1.0, 0.32, 0.26], decisionSeconds: 2.5, pitch: 1.15 },
  { id: 'moth', name: 'MOTH', callSign: 'MOTH', style: 'hauler', color: '#ffd75e', tint: [1.0, 0.82, 0.3], decisionSeconds: 3.5, pitch: 0.75 },
];

export function pilotName(pilot: PilotId): string {
  return pilot === 'player' ? 'YOU' : (RIVALS.find((rival) => rival.id === pilot)?.name ?? pilot.toUpperCase());
}

/**
 * Rivals' lasers are a little weaker than a skilled player's aim makes the
 * player's, so a pilot who commits early usually wins the race for a rock.
 */
export const RIVAL_LASER_DAMAGE = 1;

/** Fine for hitting a rival's ship with your own weapons. */
export const RIVAL_HIT_FINE = 100;

/** A rival heads home to refuel below this share of its tank. */
export const RIVAL_REFUEL_SHARE = 0.3;

export function needsRefuel(fuel: number, capacity: number): boolean {
  return fuel < capacity * RIVAL_REFUEL_SHARE;
}

export interface ContractOption {
  kind: 'asteroid' | 'satellite';
  pay: number;
  /** Seconds to get within weapon range or reach the satellite. */
  travelSeconds: number;
  /** Seconds the job leaves: impact or strike time; Infinity for no deadline. */
  deadlineSeconds: number;
  /** The asteroid is big or heavy: a hunter's favourite. */
  bigGame: boolean;
  /** Another pilot is already much closer. */
  someoneCloser: boolean;
}

/**
 * How attractive a contract is to a rival: pay per second of travel, with
 * a bonus for the rival's speciality (a hunter leaves satellite work to
 * others). Contracts that cannot be reached in
 * time, or that a closer pilot is about to take, are not worth chasing.
 */
export function rateContract(style: RivalStyle, option: ContractOption): number {
  if (option.pay <= 0 || option.travelSeconds > option.deadlineSeconds || option.someoneCloser) {
    return -Infinity;
  }
  const speciality =
    style === 'hunter' ? (option.kind === 'asteroid' ? (option.bigGame ? 1.8 : 1.2) : 0) : option.kind === 'satellite' ? 2 : 0.7;
  return (option.pay * speciality) / (10 + option.travelSeconds);
}

/**
 * Splits a payment by damage dealt, rounded to 5 credits. The pilot who
 * dealt the most receives the rounding remainder, so nothing is lost.
 */
export function splitPay(pay: number, damage: Partial<Record<PilotId, number>>): Partial<Record<PilotId, number>> {
  const entries = (Object.entries(damage) as [PilotId, number][]).filter(([, amount]) => amount > 0);
  const total = entries.reduce((sum, [, amount]) => sum + amount, 0);
  if (pay <= 0 || total <= 0) {
    return {};
  }
  const shares: Partial<Record<PilotId, number>> = {};
  let given = 0;
  for (const [pilot, amount] of entries) {
    const share = Math.floor((pay * amount) / total / 5) * 5;
    shares[pilot] = share;
    given += share;
  }
  const top = entries.reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0];
  shares[top] = (shares[top] ?? 0) + (pay - given);
  return shares;
}

/** Rationing for radio chatter, so rivals do not talk over everything. */
export const RADIO = { perRivalSeconds: 14, anySeconds: 5 } as const;

export function mayTalk(now: number, lastByRival: number, lastAny: number): boolean {
  return now - lastByRival >= RADIO.perRivalSeconds && now - lastAny >= RADIO.anySeconds;
}
