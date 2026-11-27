import type { SpeakerId } from './cast';

/**
 * Season 1, "The Stream": story beats spoken as the orbit passes certain
 * sectors (the orbit has 14). They seed the longer story: fields denser than
 * forecast, a mining company that profits from the danger, a rival in debt.
 */
export interface StoryBeat {
  sector: number;
  speaker: SpeakerId;
  line: string;
}

export const SEASON_ONE: readonly StoryBeat[] = [
  { sector: 0, speaker: 'control', line: '{callsign}, welcome to the season. Earth crosses the comet stream for the next orbit. Every rock you stop is paid; every one you miss lands on someone.' },
  { sector: 2, speaker: 'moth', line: 'Moth. Funny. That last field was heavier than the forecast said. Forecasts used to be good.' },
  { sector: 4, speaker: 'halo', line: 'Sato on Halo. Perihelion Mining is advertising on our screens again. Record profits, they say. From what, I wonder.' },
  { sector: 6, speaker: 'kestrel', line: 'Kestrel. Do not ask about my ship payments, {callsign}. Just do not.' },
  { sector: 8, speaker: 'moth', line: 'Moth. I ran the numbers on those heavy rocks. Some of them came in on paths no comet makes.' },
  { sector: 10, speaker: 'control', line: 'Capcom. The Authority has noticed the forecasts are off. Stay sharp, {callsign}. Keep the orbit clean.' },
  { sector: 12, speaker: 'control', line: 'All pilots: the giant is coming. This one pays everyone who helps. Work together.' },
];

export function beatForSector(sector: number): StoryBeat | null {
  return SEASON_ONE.find((beat) => beat.sector === sector) ?? null;
}

export const SEASON_TITLE = 'Season 1: The Stream';
