/**
 * The people of the orbit. Every voice on the radio belongs to someone with
 * a name, a job and a manner, so the pilot remembers people, not systems.
 */
export type SpeakerId = 'control' | 'vulcan' | 'ceres' | 'halo' | 'kestrel' | 'moth';

export interface Speaker {
  id: SpeakerId;
  /** Shown before the line on the radio. */
  label: string;
  color: string;
  /** Voice pitch for speech. */
  pitch: number;
}

export const CAST: Record<SpeakerId, Speaker> = {
  control: { id: 'control', label: 'CAPCOM REYES', color: '#8fd3ff', pitch: 1.0 },
  vulcan: { id: 'vulcan', label: 'CHIEF OKAFOR · VULCAN', color: '#ffb347', pitch: 0.85 },
  ceres: { id: 'ceres', label: 'FOREMAN PATEL · CERES', color: '#7dffb0', pitch: 0.7 },
  halo: { id: 'halo', label: 'COMMANDER SATO · HALO', color: '#cfe3ff', pitch: 0.95 },
  kestrel: { id: 'kestrel', label: 'KESTREL', color: '#ff6b5e', pitch: 1.15 },
  moth: { id: 'moth', label: 'MOTH', color: '#ffd75e', pitch: 0.75 },
};

/** Call signs are short, upper case and plain: letters, digits, spaces and hyphens. */
export function sanitizeCallSign(value: unknown): string {
  const text = typeof value === 'string' ? value : '';
  const clean = text
    .toUpperCase()
    .replace(/[^A-Z0-9 -]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 14);
  return clean.length >= 2 ? clean : DEFAULT_CALL_SIGN;
}

export const DEFAULT_CALL_SIGN = 'VEGA';

/** Fills {callsign} (and any other {key}) in a line. */
export function fillLine(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

/** Rationing for the radio: a gap between any two lines, and a longer one per speaker. */
export const RADIO_NET = { anySeconds: 4, perSpeakerSeconds: 10, queueLength: 3, lineSeconds: 4.5 } as const;

export function radioClear(now: number, lastAny: number, lastBySpeaker: number): boolean {
  return now - lastAny >= RADIO_NET.anySeconds && now - lastBySpeaker >= RADIO_NET.perSpeakerSeconds;
}

/**
 * Lines for moments in a career. A moment with several speakers lets the
 * radio pick one; each speaker has a few lines to keep it from repeating.
 */
export type Moment =
  | 'run-start'
  | 'field-start'
  | 'calm-start'
  | 'repair-posted'
  | 'haul-posted'
  | 'haul-delivered'
  | 'ship-lost'
  | 'licence-warning'
  | 'licence-good'
  | 'big-save'
  | 'banter';

export const LINES: Record<Moment, Partial<Record<SpeakerId, readonly string[]>>> = {
  'run-start': {
    control: ['{callsign}, this is Capcom Reyes on Halo. You are cleared to work. Fly clean out there.', 'Morning, {callsign}. The stream is early this year. Contracts are on your board.'],
  },
  'field-start': {
    control: ['{callsign}, debris field inbound. Contracts are live.', 'Here they come, {callsign}. Mind the satellites.'],
    kestrel: ['Kestrel. Field is mine, {callsign}. Try to keep up.'],
    moth: ['Moth here. Plenty for everyone. Pick your rocks.'],
  },
  'calm-start': {
    control: ['Field clear. Refuel, repair, and check the board, {callsign}.', 'Quiet for now. Good time to sweep some debris, {callsign}.'],
  },
  'repair-posted': {
    vulcan: ['Okafor at Vulcan. I have a patient waiting: bring me that satellite, gently.', 'Vulcan Yard here. Cradle is open. Do not shake the poor thing on the way in.'],
  },
  'haul-posted': {
    ceres: ['Patel at Ceres. Crushers are hungry. Bring me that carbon rock.', 'Ceres here. Rock out there with our name on it. Pay is by the tonne.'],
  },
  'haul-delivered': {
    ceres: ['Good rock, {callsign}. The crushers thank you.', 'Patel here. Fuel and parts on the way. Nice hauling.'],
  },
  'ship-lost': {
    control: ['{callsign}, we saw that. Replacement is on its way. Take a breath.'],
    kestrel: ['Ha. Expensive day, {callsign}?'],
    moth: ['Moth. Happens to all of us, kid. Get back out there.'],
  },
  'licence-warning': {
    control: ['{callsign}, the Authority is watching your record. Clean work from here on.'],
    kestrel: ['Heard you are under review, {callsign}. More rocks for me.'],
  },
  'licence-good': {
    control: ['Good news, {callsign}. Your licence is clear again.'],
    moth: ['Told you they would come round. Nice work.'],
  },
  'big-save': {
    control: ['That rock was headed for {site}. Well flown, {callsign}.'],
    halo: ['Sato on Halo. {site} owes you one, pilot.'],
  },
  banter: {
    kestrel: ['Kestrel. Anyone else think Aegis coffee tastes like coolant?', 'Kestrel here. Bet I clear more rocks than anyone this orbit.'],
    moth: ['Moth. Thirty years flying this orbit. Still love the sunrise.', 'Moth here. Brake early, {callsign}. Space forgives nothing.'],
    halo: ['Sato on Halo. The station cat is in the airlock again. Nobody open it.'],
    vulcan: ['Okafor. If anyone sees my torque wrench drifting about, it is mine.'],
    ceres: ['Patel. Iron rocks break my crushers. Bring me carbon, please.'],
  },
};
