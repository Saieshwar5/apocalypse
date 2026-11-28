import type { SpeakerId } from './cast';

/**
 * Season 1, "The Stream", in three acts told on the radio as the orbit
 * passes its sectors (there are 14). Act one: the fields are heavier than
 * the forecasts, and Farwatch, which should have seen them, did not. Act
 * two: a rock with something bolted to it, and what Farwatch's yard finds
 * inside. Act three: what the pilot does with the proof, and the giant.
 */
export interface StoryBeat {
  sector: number;
  speaker: SpeakerId;
  line: string;
}

export const SEASON_ONE: readonly StoryBeat[] = [
  { sector: 0, speaker: 'control', line: '{callsign}, welcome to the season. Earth crosses the comet stream for the next orbit. Every rock you stop is paid; every one you miss lands on someone.' },
  { sector: 2, speaker: 'moth', line: 'Moth. Funny. That last field was heavier than the forecast said. Farwatch used to get them right.' },
  { sector: 3, speaker: 'farwatch', line: 'Imani on Farwatch. For the record: my dishes saw that field late because someone cut our parts order. I did not cut it.' },
  { sector: 4, speaker: 'meridian', line: 'Mayor Adeyemi. Perihelion Mining has taken the top floor of our trade hall. Record profits, they tell me. From what, I wonder.' },
  { sector: 5, speaker: 'kestrel', line: 'Kestrel. Do not ask who holds the note on my ship, {callsign}. They have an office on Meridian now. That is all I will say.' },
  { sector: 8, speaker: 'moth', line: 'Moth. I ran the numbers on the iron ones. Some came in on paths no comet makes. Somebody is steering.' },
  { sector: 10, speaker: 'control', line: 'Capcom. The Authority has noticed the forecasts are off. If anyone has proof of why, Meridian is where to bring it.' },
  { sector: 12, speaker: 'control', line: 'All pilots: the giant is coming. This one pays everyone who helps. Work together.' },
];

export function beatForSector(sector: number): StoryBeat | null {
  return SEASON_ONE.find((beat) => beat.sector === sector) ?? null;
}

export const SEASON_TITLE = 'Season 1: The Stream';

/** The calm sector in which the strange rock is found. */
export const EVIDENCE_SECTOR = 6;

export const EVIDENCE = {
  /** Farwatch's fee for bringing the rock in. */
  pay: 900,
  /** What Perihelion offers for the proof, and what each choice does to the licence. */
  bribe: 3000,
  honestReputation: 12,
  soldReputation: -20,
} as const;

/** Where the pilot stands in the season's story. */
export type StoryStage = 'unaware' | 'rock-found' | 'proof-held' | 'gave-to-authority' | 'sold-to-company';

export const STORY_LINES = {
  found: ['moth', "Moth. {callsign}, there is an iron rock drifting with a thruster bolted to it. A thruster. Farwatch's yard can open it up. Tow it there."],
  opened: ['farwatch', 'Imani. We have it open. A guidance pack, Perihelion serial numbers, and our own missing parts wired into it. That is your proof, {callsign}. Take it to Meridian.'],
  offer: ['kestrel', 'Kestrel. They know you have it. Three thousand if it never reaches the Mayor. I am only passing the message. I hate that I am.'],
  honest: ['meridian', "Adeyemi. I have it, and the Authority has it. Perihelion's floor is sealed as of now. The city will remember this, {callsign}."],
  sold: ['kestrel', 'Kestrel. It is done. The money is in your account. I will not say thank you, and you should not want me to.'],
} as const satisfies Record<string, readonly [SpeakerId, string]>;

/** One line for the end of the run, by how the story stood. */
export function storyEnding(stage: StoryStage): string {
  switch (stage) {
    case 'gave-to-authority':
      return "You gave the proof to Meridian. Perihelion's office is sealed, and next season's forecasts can be trusted.";
    case 'sold-to-company':
      return 'You sold the proof to Perihelion. The forecasts stay wrong, and somebody goes on steering rocks.';
    case 'proof-held':
      return 'You still hold the proof of who is steering the rocks. It never reached Meridian.';
    case 'rock-found':
      return 'The rock with the thruster on it was never opened. Nobody knows why the fields are so heavy.';
    case 'unaware':
      return '';
  }
}
