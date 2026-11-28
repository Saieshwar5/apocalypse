/**
 * What deserves a place on the screen right now. The HUD shows what the
 * pilot needs to decide in this moment, brings other things up when they
 * suddenly matter, and keeps everything else one key away (Tab, the
 * tactical map, shows the planning view around the map). Calm zones show
 * the work-and-money view; fields show the fighting view.
 */
export type HudDensity = 'minimal' | 'standard' | 'full';

export const HUD_DENSITIES: readonly HudDensity[] = ['minimal', 'standard', 'full'];

export interface HudSituation {
  density: HudDensity;
  /** In a calm zone (planning time) rather than a debris field. */
  calm: boolean;
  /** The tactical map (Tab) is open: the planning readings, and room for the map itself. */
  tactical: boolean;
  integrity: number;
  orbitHealth: number;
  licenceGood: boolean;
  /** Seconds since the balance last changed, and since the league order changed. */
  moneySeconds: number;
  leagueSeconds: number;
  /** Sites with a rock on the way, and sites already damaged. */
  threatenedSites: number;
  damagedSites: number;
  /** Fuel or hull low, or out of missiles: the way to a station matters. */
  needsStation: boolean;
  /** Low orbit, atmosphere, or near the edge of the defence zone. */
  altitudeMatters: boolean;
  laserHeat: number;
  boost: number;
  mouseCaptured: boolean;
  autopilot: boolean;
  assist: boolean;
  berthed: boolean;
  braking: boolean;
  towing: boolean;
  /** Early runs still show the controls line and tips. */
  newPilot: boolean;
}

export interface HudVisibility {
  integrity: boolean;
  orbitHealth: boolean;
  licence: boolean;
  balance: boolean;
  earned: boolean;
  league: boolean;
  position: boolean;
  stationRows: boolean;
  /** 'all' lists every site; 'alert' only threatened or damaged ones; 'none' hides the panel. */
  sites: 'all' | 'alert' | 'none';
  /** How many board rows to list before "+N more". */
  boardRows: number;
  heat: boolean;
  boost: boolean;
  steerChip: boolean;
  assistChip: boolean;
  motionChip: boolean;
  controlsLine: boolean;
  /** Station and satellite labels in the world: all of them, or only near ones and the job target. */
  allWorldLabels: boolean;
}

/** Seconds a change keeps a hidden reading on screen. */
export const FLASH_SECONDS = { money: 4, league: 6 } as const;

export function hudVisibility(situation: HudSituation): HudVisibility {
  const all = situation.density === 'full';
  const minimal = situation.density === 'minimal';
  const planning = situation.calm && !minimal;
  const sitesAlert = situation.threatenedSites + situation.damagedSites > 0;
  if (situation.tactical) {
    // The map shows the planning readings and leaves the flying ones out: the space belongs to the map.
    return {
      integrity: true,
      orbitHealth: true,
      licence: true,
      balance: true,
      earned: true,
      league: true,
      position: false,
      stationRows: false,
      sites: sitesAlert ? 'alert' : 'none',
      boardRows: 8,
      heat: false,
      boost: false,
      steerChip: false,
      assistChip: false,
      motionChip: false,
      controlsLine: false,
      allWorldLabels: true,
    };
  }
  return {
    integrity: all || situation.integrity < 100 || situation.calm,
    orbitHealth: all || situation.orbitHealth < 70 || planning,
    licence: all || !situation.licenceGood || planning,
    balance: all || planning || situation.moneySeconds < FLASH_SECONDS.money,
    earned: all || planning,
    league: all || planning || (!minimal && situation.leagueSeconds < FLASH_SECONDS.league),
    position: all || situation.altitudeMatters || situation.needsStation,
    stationRows: all || situation.needsStation,
    sites: all || (planning && sitesAlert) ? 'all' : situation.threatenedSites > 0 || (!minimal && sitesAlert) ? 'alert' : 'none',
    boardRows: all ? 8 : situation.calm ? (minimal ? 2 : 5) : minimal ? 1 : 2,
    heat: all || situation.laserHeat > 3,
    boost: all || situation.boost < 99,
    steerChip: all || !situation.mouseCaptured || situation.autopilot,
    assistChip: all || !situation.assist,
    motionChip: all || situation.berthed || situation.braking,
    controlsLine: all || situation.newPilot,
    allWorldLabels: all,
  };
}
