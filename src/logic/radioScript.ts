import type { StationId } from './stations';
import type { SpeakerId } from './cast';

/**
 * How the radio sounds and what people say beyond single lines: channels,
 * voices, short two-way exchanges (the pilot's ship answers by itself),
 * traffic calls and news from the ground. Everything is plain data so the
 * radio's manners can be tested without audio.
 */

/** Who can be on the radio, including the pilot's own ship. */
export type RadioSpeaker = SpeakerId | 'self';

/** The channel shown on the radio panel for each speaker. */
export const CHANNEL: Record<RadioSpeaker, string> = {
  control: 'EDA OPS',
  vulcan: 'VULCAN',
  ceres: 'CERES',
  halo: 'HALO',
  meridian: 'MERIDIAN',
  anchor: 'ANCHOR',
  farwatch: 'FARWATCH',
  kestrel: 'PILOTS',
  moth: 'PILOTS',
  self: 'YOU',
};

/**
 * Each speaker's voice: which of the browser's English voices to use (by
 * position, so different people sound different where several exist), its
 * pitch and its pace.
 */
export const VOICE: Record<RadioSpeaker, { voice: number; pitch: number; rate: number }> = {
  control: { voice: 0, pitch: 1.0, rate: 1.08 },
  vulcan: { voice: 1, pitch: 0.85, rate: 0.98 },
  ceres: { voice: 2, pitch: 0.72, rate: 0.95 },
  halo: { voice: 3, pitch: 1.05, rate: 1.02 },
  meridian: { voice: 7, pitch: 1.0, rate: 1.0 },
  anchor: { voice: 8, pitch: 0.8, rate: 0.96 },
  farwatch: { voice: 9, pitch: 1.1, rate: 1.04 },
  kestrel: { voice: 4, pitch: 1.15, rate: 1.15 },
  moth: { voice: 5, pitch: 0.75, rate: 0.9 },
  self: { voice: 6, pitch: 0.95, rate: 1.1 },
};

/** Importance on the radio: an emergency cuts in; chatter only fills silence. */
export type RadioPriority = 'emergency' | 'ops' | 'chatter';

export type Exchange = readonly (readonly [RadioSpeaker, string])[];

const STATION_SPEAKER: Record<string, SpeakerId> = { vulcan: 'vulcan', ceres: 'ceres', halo: 'halo', meridian: 'meridian', anchor: 'anchor', farwatch: 'farwatch' };

/** Docking at Aegis: the pilot asks, control clears. */
export function dockingExchange(pick: number): Exchange {
  const replies = [
    '{callsign}, Aegis. Guides have you. Welcome home.',
    '{callsign}, Aegis. Cleared bay one. Hands off, we have you.',
    'Copy, {callsign}. Bay is open. Kettle is on.',
  ];
  return [
    ['self', 'Aegis, {callsign}, on approach. Requesting docking.'],
    ['control', replies[pick % replies.length]],
  ];
}

/** Berthing at an outpost: the pilot calls in, the station chief answers. */
export function berthExchange(station: Exclude<StationId, 'aegis'>, pick: number): Exchange {
  const replies: Record<typeof station, readonly string[]> = {
    vulcan: ['Okafor. Berth two is yours, {callsign}. Mind the cranes.', 'Vulcan Yard. Clamps on. Parts and fuel at yard prices.'],
    ceres: ['Patel. Welcome to Ceres, {callsign}. Cheapest fuel in orbit.', 'Ceres Works. Berth is yours. Breathe through your mouth, the crushers are running.'],
    halo: ["Sato. Welcome aboard, {callsign}. Crew's been asking about you.", 'Halo here. Clamps on. Stay as long as you need.'],
    meridian: ['Meridian harbour. Welcome to the city, {callsign}. Mind the ring as you leave.', 'Adeyemi. Good to see an Authority ship at our dock, {callsign}.'],
    anchor: ['Lind. Berth six, {callsign}. Fuel is fresh up from the ground.', 'Anchor port. Clamps on. Cheapest tank in low orbit.'],
    farwatch: ['Imani. Farwatch has you, {callsign}. It is a long way out: stay a while.', 'Farwatch. Clamps on. The dishes are listening.'],
  };
  const names = { vulcan: 'Vulcan', ceres: 'Ceres', halo: 'Halo', meridian: 'Meridian', anchor: 'Anchor', farwatch: 'Farwatch' };
  return [
    ['self', `${names[station]}, {callsign}, coming alongside to berth.`],
    [STATION_SPEAKER[station], replies[station][pick % replies[station].length]],
  ];
}

/**
 * Something on the tow line: the pilot reports it and whoever is waiting
 * for it says where it goes.
 */
export function towExchange(load: string, place: string, contact: SpeakerId, fragile: boolean, pick: number): Exchange {
  const tails = fragile ? ['Gently, she is fragile.', 'Easy on the line.', 'No hard pulls.'] : ['Brake early, it is heavy.', 'Nearly stop before you let go.', 'Take your time.'];
  return [
    ['self', `{callsign} has ${load} on the line.`],
    [contact, `Copy, {callsign}. Bring it to ${place}. ${tails[pick % tails.length]}`],
  ];
}

/**
 * Picking a nav target: the pilot announces it, control reads back where
 * it is in plain words and adds a tip when one helps.
 */
export function navExchange(label: string, distanceText: string, where: string, tip: string | null): Exchange {
  return [
    ['self', `Control, {callsign}, heading for ${label}.`],
    ['control', `Copy, {callsign}. ${label} is ${distanceText} out, ${where}.${tip ? ` ${tip}` : ''}`],
  ];
}

/** "ahead and above", "behind you, below": a direction in the pilot's terms. */
export function describeDirection(local: readonly [number, number, number]): string {
  const [x, y, z] = local;
  const length = Math.hypot(x, y, z) || 1;
  const ahead = -z / length;
  const side = x / length;
  const up = y / length;
  const parts: string[] = [];
  parts.push(ahead > 0.5 ? 'ahead' : ahead < -0.5 ? 'behind you' : side > 0 ? 'off to your right' : 'off to your left');
  if (Math.abs(side) > 0.35 && Math.abs(ahead) > 0.5) {
    parts.push(side > 0 ? 'to the right' : 'to the left');
  }
  if (Math.abs(up) > 0.3) {
    parts.push(up > 0 ? 'above' : 'below');
  }
  return parts.join(', ');
}

/** Launch traffic from Earth's spaceports. */
export function trafficCall(site: string, pick: number): string {
  const calls = [
    `All stations, traffic: launch from ${site}, climbing now. Keep clear of the corridor.`,
    `Traffic advisory. Heavy lifter off the pad at ${site}. Give it room.`,
    `Launch from ${site}. Supply run for the stations. Nobody shoot it, please.`,
  ];
  return calls[pick % calls.length];
}

/** News from the ground in calm zones: what the pilot's work means to people. */
export function newsLine(saved: string | null, lost: string | null, pick: number): string {
  if (lost && pick % 3 === 0) {
    return `News from the ground: ${lost} is still digging out. Relief flights are going in from all over.`;
  }
  if (saved) {
    const lines = [
      `News from the ground: ${saved} watched the field go over last night. They are calling it the quietest sky in years.`,
      `Ground news: schools in ${saved} are naming the pilots in class today. Yours came up, {callsign}.`,
      `From the ground: ${saved} turned its lights off to watch the debris burn up. Thousands on the rooftops.`,
    ];
    return lines[pick % lines.length];
  }
  return 'Quiet on the ground tonight. That is the job done right.';
}
