import { FLASH_SECONDS, hudVisibility, type HudDensity, type HudVisibility } from '../logic/hudFocus';
import { MessageQueue, type MessageTone } from '../logic/messageQueue';
import type * as THREE from 'three';
import { MATERIAL_TRAITS, type AsteroidSize } from '../logic/asteroidClasses';
import { DEFENCE_ZONE, type AltitudeReadout, type AtmosphereZone } from '../logic/atmosphere';
import { integrityLevel, threatRating } from '../logic/planetDamage';
import { formatCredits } from '../logic/contracts';
import { CASCADE } from '../logic/cascade';
import { formatCountdown, formatDistance, formatSpeed } from '../logic/units';
import type { ContractListing } from '../game/contractBook';
import type { JobRow } from '../game/satelliteWork';
import type { SiteState } from '../sites/siteDefence';
import { SitePanel } from './sitePanel';

export interface HudSnapshot {
  integrity: number;
  /** Orbit Health: 100 is clean orbit, 0 means the cascade has closed it. */
  orbitHealth: number;
  licence: { summary: string; stage: string };
  wave: number;
  balance: number;
  earned: number;
  /** Earnings of every pilot, best first. */
  league: readonly { name: string; earned: number; color: string; you: boolean }[];
  /** Open defence contracts, most urgent first. */
  contracts: readonly ContractListing[];
  /** Line under the board: this field's earnings, or what comes next. */
  contractSummary: string;
  laserHeat: number;
  overheated: boolean;
  missiles: number;
  missileCapacity: number;
  fuelCapacity: number;
  shieldCapacity: number;
  boost: number;
  shield: number;
  hull: number;
  speed: number;
  shipPosition: THREE.Vector3;
  fuel: number;
  station: {
    distance: number | null;
    docked: boolean;
    destroyed: boolean;
    stock: { fuel: number; missiles: number };
    shield: number;
    health: number;
    threatenedIn: number | null;
  };
  altitude: AltitudeReadout;
  zone: AtmosphereZone;
  sites: readonly SiteState[];
  controls: {
    mouseCaptured: boolean;
    assist: boolean;
    /** Name of the autopilot flying the ship, if any. */
    autopilot: string | null;
    thrusting: boolean;
    braking: boolean;
    /** Held at a station berth or docked. */
    berthed: boolean;
    /** What is on the tow line, or null. */
    towing: string | null;
  };
  /** Satellite contracts, shown above the defence contracts. */
  jobs: readonly JobRow[];
  /** For deciding what to show: calm zone or field, and whether the tactical map is open. */
  focus: { calm: boolean; tactical: boolean };
}

const ZONE_LABEL: Record<AtmosphereZone, string> = {
  space: 'Space',
  warning: 'Low orbit',
  atmosphere: 'IN ATMOSPHERE',
  breakup: 'BREAK-UP',
};

export type { MessageTone };

const SIZE_NAME: Record<AsteroidSize, string> = { small: 'Small', medium: 'Medium', large: 'Large', giant: 'Giant' };

function setText(target: HTMLElement, text: string): void {
  if (target.textContent !== text) {
    target.textContent = text;
  }
}

function setStatus(target: HTMLElement, state: string, text: string): void {
  if (target.dataset.state !== state) {
    target.dataset.state = state;
  }
  if (target.textContent !== text) {
    target.textContent = text;
  }
}

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) {
    throw new Error(`HUD element ${selector} is missing from index.html`);
  }
  return found;
}

/** The DOM part of the HUD: status panels, threat list and messages. */
export class Hud {
  private readonly root = element<HTMLDivElement>('#hud');
  private readonly integrityBar = element<HTMLDivElement>('#integrity-bar');
  private readonly integrityValue = element<HTMLSpanElement>('#integrity-value');
  private readonly orbitBar = element<HTMLDivElement>('#orbit-health-bar');
  private readonly licenceValue = element<HTMLElement>('#licence-value');
  private readonly orbitValue = element<HTMLSpanElement>('#orbit-health-value');
  private readonly waveValue = element<HTMLElement>('#wave-value');
  private readonly balanceValue = element<HTMLElement>('#balance-value');
  private readonly earnedValue = element<HTMLElement>('#earned-value');
  private readonly leagueValue = element<HTMLElement>('#league-value');
  private lastLeague = '';
  private readonly contractSummary = element<HTMLElement>('#contract-summary');
  private readonly threatList = element<HTMLOListElement>('#threat-list');
  private readonly heatBar = element<HTMLDivElement>('#heat-bar');
  private readonly missileValue = element<HTMLElement>('#missile-value');
  private readonly boostBar = element<HTMLDivElement>('#boost-bar');
  private readonly hullBar = element<HTMLDivElement>('#hull-bar');
  private readonly shieldBar = element<HTMLDivElement>('#shield-bar');
  private readonly speedValue = element<HTMLElement>('#speed-value');
  private readonly message = element<HTMLDivElement>('#hud-message');
  private readonly fuelBar = element<HTMLDivElement>('#fuel-bar');
  private readonly stationValue = element<HTMLElement>('#station-value');
  private readonly stockValue = element<HTMLElement>('#stock-value');
  private readonly stationHealthValue = element<HTMLElement>('#station-health-value');
  private readonly centreValue = element<HTMLElement>('#centre-value');
  private readonly surfaceValue = element<HTMLElement>('#surface-value');
  private readonly atmosphereValue = element<HTMLElement>('#atmosphere-value');
  private readonly zoneValue = element<HTMLElement>('#zone-value');
  private readonly hint = element<HTMLDivElement>('#hud-hint');
  private readonly radio = element<HTMLDivElement>('#radio-line');
  private radioTimer = 0;
  private readonly steerStatus = element<HTMLElement>('#steer-status');
  private readonly assistStatus = element<HTMLElement>('#assist-status');
  private readonly motionStatus = element<HTMLElement>('#motion-status');
  private readonly towStatus = element<HTMLElement>('#tow-status');
  private readonly damageFlash = element<HTMLDivElement>('#damage-flash');
  private readonly defaultHint = this.hint.textContent ?? '';
  private sitePanel: SitePanel | null = null;
  private sitePanelSites: readonly SiteState[] | null = null;
  private flash = 0;
  private readonly messages = new MessageQueue();
  private lastThreatMarkup = '';
  /** HUD density from the settings, and whether the controls line still helps (early runs). */
  density: HudDensity = 'standard';
  newPilot = true;
  /** What the HUD decided to show this frame; the overlay reads it for world labels. */
  visibility: HudVisibility | null = null;
  private lastBalance = Number.NaN;
  private moneyDelta = 0;
  private moneySeconds = Infinity;
  private lastLeagueOrder = '';
  private leagueSeconds = Infinity;
  private readonly show = {
    status: element<HTMLElement>('#status-panel'),
    integrity: element<HTMLElement>('#integrity-group'),
    orbit: element<HTMLElement>('#orbit-group'),
    licence: element<HTMLElement>('#licence-row'),
    balance: element<HTMLElement>('#balance-row'),
    earned: element<HTMLElement>('#earned-row'),
    position: element<HTMLElement>('#position-panel'),
    stationRows: element<HTMLElement>('#station-rows'),
    sites: element<HTMLElement>('#sites-panel'),
    heat: element<HTMLElement>('#heat-group'),
    boost: element<HTMLElement>('#boost-group'),
  };

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  update(deltaSeconds: number, snapshot: HudSnapshot): void {
    this.applyFocus(deltaSeconds, snapshot);
    const integrity = Math.max(0, snapshot.integrity);
    this.integrityBar.style.width = `${integrity}%`;
    this.integrityBar.dataset.level = integrityLevel(integrity);
    this.integrityValue.textContent = `${integrity.toFixed(0)}%`;
    const orbit = Math.max(0, snapshot.orbitHealth);
    this.orbitBar.style.width = `${orbit}%`;
    this.orbitBar.dataset.level = orbit > 60 ? 'stable' : orbit > CASCADE.tippingHealth ? 'damaged' : 'critical';
    setText(this.orbitValue, `${orbit.toFixed(0)}%`);
    setText(this.licenceValue, snapshot.licence.summary);
    if (this.licenceValue.dataset.stage !== snapshot.licence.stage) {
      this.licenceValue.dataset.stage = snapshot.licence.stage;
    }
    this.waveValue.textContent = String(snapshot.wave);
    const delta = Math.round(this.moneyDelta);
    const flashing = this.moneySeconds < FLASH_SECONDS.money && delta !== 0;
    setText(this.balanceValue, flashing ? `${delta > 0 ? '+' : '−'}${formatCredits(Math.abs(delta))} → ${formatCredits(snapshot.balance)}` : formatCredits(snapshot.balance));
    setText(this.earnedValue, formatCredits(snapshot.earned));
    setText(this.contractSummary, snapshot.contractSummary);
    this.renderLeague(snapshot.league);

    this.heatBar.style.width = `${snapshot.laserHeat}%`;
    this.heatBar.dataset.level = snapshot.overheated ? 'critical' : snapshot.laserHeat > 70 ? 'damaged' : 'stable';
    this.missileValue.textContent = `${snapshot.missiles} / ${snapshot.missileCapacity}`;
    this.boostBar.style.width = `${snapshot.boost}%`;
    this.fuelBar.style.width = `${(snapshot.fuel / snapshot.fuelCapacity) * 100}%`;
    this.fuelBar.dataset.level = snapshot.fuel <= 0 ? 'critical' : snapshot.fuel < snapshot.fuelCapacity * 0.25 ? 'damaged' : 'stable';
    const { station } = snapshot;
    this.stationValue.textContent = station.destroyed
      ? 'DESTROYED'
      : station.docked
        ? 'DOCKED'
        : station.distance === null
          ? '—'
          : formatDistance(station.distance);
    this.stockValue.textContent = station.destroyed ? '—' : `${Math.round(station.stock.fuel)} fuel · ${Math.floor(station.stock.missiles)} missiles`;
    const threat = station.threatenedIn !== null ? ` · HIT IN ${formatCountdown(station.threatenedIn)}` : '';
    this.stationHealthValue.textContent = station.destroyed ? '—' : `shield ${Math.round(station.shield)} hull ${Math.round(station.health)}${threat}`;
    this.stationHealthValue.dataset.alert = String(station.threatenedIn !== null || station.health < 60);
    this.shieldBar.style.width = `${(snapshot.shield / snapshot.shieldCapacity) * 100}%`;
    this.hullBar.style.width = `${snapshot.hull}%`;
    this.hullBar.dataset.level = integrityLevel(snapshot.hull);
    this.speedValue.textContent = formatSpeed(snapshot.speed);

    this.renderThreats(snapshot, this.visibility?.boardRows ?? 8);
    this.renderPosition(snapshot);
    this.renderControls(snapshot);
    if (!this.sitePanel || this.sitePanelSites !== snapshot.sites) {
      // The site list is replaced when the star system changes.
      this.sitePanel = new SitePanel(element<HTMLOListElement>('#site-list'), snapshot.sites);
      this.sitePanelSites = snapshot.sites;
    }
    this.sitePanel.update(snapshot.sites);
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - deltaSeconds * 1.8);
      this.damageFlash.style.opacity = String(this.flash);
    }

    if (this.radioTimer > 0) {
      this.radioTimer -= deltaSeconds;
      if (this.radioTimer <= 0) {
        this.radio.classList.remove('visible');
      }
    }

    const next = this.messages.update(deltaSeconds);
    if (next === 'clear') {
      this.message.classList.remove('visible');
    } else if (next) {
      this.display(next.text, next.tone);
    }
  }

  /** Decides what is worth showing now and hides the rest. */
  private applyFocus(deltaSeconds: number, snapshot: HudSnapshot): void {
    if (Math.abs(snapshot.balance - this.lastBalance) >= 1 || Number.isNaN(this.lastBalance)) {
      // Small trickles (sweeping pays by the tonne) add up into one change on screen.
      const fresh = this.moneySeconds > FLASH_SECONDS.money;
      this.moneyDelta = (fresh ? 0 : this.moneyDelta) + (Number.isNaN(this.lastBalance) ? 0 : snapshot.balance - this.lastBalance);
      this.moneySeconds = Number.isNaN(this.lastBalance) ? Infinity : 0;
      this.lastBalance = snapshot.balance;
    }
    this.moneySeconds += deltaSeconds;
    const order = snapshot.league.map((row) => row.name).join('|');
    if (order !== this.lastLeagueOrder) {
      this.leagueSeconds = this.lastLeagueOrder === '' ? Infinity : 0;
      this.lastLeagueOrder = order;
    }
    this.leagueSeconds += deltaSeconds;
    const { controls, station } = snapshot;
    const damagedSites = snapshot.sites.filter((site) => site.health < 100).length;
    const threatenedSites = snapshot.sites.filter((site) => site.threatenedIn !== null && site.health > 0).length;
    const visibility = hudVisibility({
      density: this.density,
      calm: snapshot.focus.calm,
      tactical: snapshot.focus.tactical,
      integrity: snapshot.integrity,
      orbitHealth: snapshot.orbitHealth,
      licenceGood: snapshot.licence.stage === 'good',
      moneySeconds: this.moneySeconds,
      leagueSeconds: this.leagueSeconds,
      threatenedSites,
      damagedSites,
      needsStation:
        snapshot.fuel < snapshot.fuelCapacity * 0.3 || snapshot.hull < 45 || snapshot.missiles === 0 || station.threatenedIn !== null || station.docked,
      altitudeMatters: snapshot.zone !== 'space' || snapshot.shipPosition.length() > DEFENCE_ZONE.warning * 0.9,
      laserHeat: snapshot.laserHeat,
      boost: snapshot.boost,
      mouseCaptured: controls.mouseCaptured,
      autopilot: controls.autopilot !== null,
      assist: controls.assist,
      berthed: controls.berthed,
      braking: controls.braking,
      towing: controls.towing !== null,
      newPilot: this.newPilot,
    });
    this.visibility = visibility;
    const set = (target: HTMLElement, visible: boolean) => {
      const value = String(visible);
      if (target.dataset.show !== value) {
        target.dataset.show = value;
      }
    };
    set(this.show.integrity, visibility.integrity);
    set(this.show.orbit, visibility.orbitHealth);
    set(this.show.licence, visibility.licence);
    set(this.show.balance, visibility.balance);
    set(this.show.earned, visibility.earned);
    set(this.leagueValue, visibility.league);
    set(
      this.show.status,
      visibility.integrity || visibility.orbitHealth || visibility.licence || visibility.balance || visibility.earned || visibility.league,
    );
    set(this.show.position, visibility.position);
    set(this.show.stationRows, visibility.stationRows);
    set(this.show.sites, visibility.sites !== 'none');
    if (this.show.sites.dataset.mode !== visibility.sites) {
      this.show.sites.dataset.mode = visibility.sites;
    }
    set(this.show.heat, visibility.heat);
    set(this.show.boost, visibility.boost);
    set(this.steerStatus, visibility.steerChip);
    set(this.assistStatus, visibility.assistChip);
    set(this.motionStatus, visibility.motionChip);
    set(this.hint, visibility.controlsLine || this.hint.classList.contains('tip'));
  }

  /**
   * Red flash on the side of the screen a hit came from. `localDirection` is
   * the source in the ship's frame (x right, y up, z backwards).
   */
  flashDamage(localDirection: THREE.Vector3, strength: number): void {
    const flat = Math.hypot(localDirection.x, localDirection.y);
    // Hits from straight ahead or behind have no screen side: flash the whole rim.
    const sideways = flat > Math.abs(localDirection.z) * 0.35 && flat > 0;
    const x = sideways ? 50 + (localDirection.x / flat) * 50 : 50;
    const y = sideways ? 50 - (localDirection.y / flat) * 50 : 50;
    this.damageFlash.style.background = sideways
      ? `radial-gradient(circle at ${x}% ${y}%, rgba(255, 40, 20, 0.75), transparent 60%)`
      : 'radial-gradient(ellipse at center, transparent 45%, rgba(255, 40, 20, 0.7) 100%)';
    this.flash = Math.max(this.flash, Math.min(1, strength));
    this.damageFlash.style.opacity = String(this.flash);
  }

  /** Replaces the bottom hint line; pass null to restore the controls list. */
  setHint(text: string | null): void {
    const next = text ?? this.defaultHint;
    if (this.hint.textContent !== next) {
      this.hint.textContent = next;
      this.hint.classList.toggle('tip', text !== null);
    }
  }

  private renderLeague(league: HudSnapshot['league']): void {
    const key = league.map((row) => `${row.name}:${Math.round(row.earned)}`).join('|');
    if (key === this.lastLeague) {
      return;
    }
    this.lastLeague = key;
    this.leagueValue.replaceChildren(
      ...league.map((row, index) => {
        const entry = document.createElement('span');
        entry.textContent = `${index + 1}. ${row.you ? 'YOU' : row.name} ${Math.round(row.earned).toLocaleString('en-US')}`;
        entry.style.color = row.color;
        return entry;
      }),
    );
  }

  /** Says plainly who is steering and what the engines are doing. */
  private renderControls(snapshot: HudSnapshot): void {
    const { controls, speed } = snapshot;
    setStatus(
      this.steerStatus,
      controls.autopilot ? 'alert' : controls.mouseCaptured ? 'on' : 'off',
      controls.autopilot ?? (controls.mouseCaptured ? 'MOUSE STEERING' : 'CLICK FOR MOUSE STEERING'),
    );
    setStatus(this.assistStatus, controls.assist ? 'on' : 'off', controls.assist ? 'FLIGHT ASSIST ON' : 'FLIGHT ASSIST OFF: DRIFTING');
    const motion = controls.berthed ? 'BERTHED' : controls.braking ? 'BRAKING' : controls.thrusting ? 'THRUST' : speed < 0.3 ? 'STOPPED' : 'COASTING';
    setStatus(this.motionStatus, controls.braking ? 'off' : 'on', motion);
    this.towStatus.hidden = controls.towing === null;
    setStatus(this.towStatus, 'off', controls.towing ?? '');
  }

  private renderPosition(snapshot: HudSnapshot): void {
    const { altitude, zone } = snapshot;
    this.centreValue.textContent = formatDistance(altitude.fromCentre);
    this.surfaceValue.textContent = formatDistance(altitude.aboveSurface);
    const inside = altitude.aboveAtmosphere < 0;
    this.atmosphereValue.textContent = `${inside ? '-' : ''}${formatDistance(Math.abs(altitude.aboveAtmosphere))}`;
    if (this.zoneValue.dataset.zone !== zone) {
      this.zoneValue.dataset.zone = zone;
      this.zoneValue.textContent = ZONE_LABEL[zone];
      this.atmosphereValue.dataset.zone = zone;
    }
  }

  /** A radio transmission, under the main message: channel, speaker, a live waveform and the words. */
  showRadio(line: { name: string; channel: string; color: string; text: string; seconds: number; self?: boolean }): void {
    const channel = document.createElement('span');
    channel.className = 'radio-channel';
    channel.textContent = line.channel;
    const wave = document.createElement('span');
    wave.className = 'radio-wave';
    wave.replaceChildren(...Array.from({ length: 5 }, () => document.createElement('i')));
    const label = document.createElement('strong');
    label.textContent = line.name;
    label.style.color = line.color;
    const words = document.createElement('span');
    words.className = 'radio-words';
    words.textContent = line.text;
    this.radio.replaceChildren(channel, wave, label, words);
    this.radio.classList.toggle('self', line.self === true);
    this.radio.classList.add('visible');
    this.radioTimer = line.seconds;
  }

  /** Called for urgent messages so mission control can read them aloud. */
  onUrgent: ((text: string) => void) | null = null;

  /** Messages take turns on one line: dangers interrupt, news waits (see logic/messageQueue). */
  showMessage(text: string, tone: MessageTone = 'info', seconds = 3): void {
    const shown = this.messages.push({ text, tone, seconds });
    if (shown) {
      this.display(shown.text, shown.tone);
    }
  }

  private display(text: string, tone: MessageTone): void {
    if (tone === 'danger') {
      this.onUrgent?.(text);
    }
    this.message.textContent = text;
    this.message.dataset.tone = tone;
    this.message.classList.add('visible');
  }

  private renderThreats(snapshot: HudSnapshot, limit: number): void {
    const jobRow = (job: JobRow) =>
      `<li class="job ${job.urgent ? 'urgent' : ''}"><span>${job.title}</span><span class="threat-pay">${formatCredits(job.pay)}</span><span class="threat-detail">${job.detail}</span></li>`;
    const contracts = snapshot.contracts.map(({ asteroid, pay, estimate }) => {
      const eta = asteroid.timeToImpact === null ? 'off course' : formatCountdown(asteroid.timeToImpact);
      const urgent = asteroid.timeToImpact !== null && (asteroid.timeToImpact < 20 || asteroid.threatensSite);
      const distance = formatDistance(snapshot.shipPosition.distanceTo(asteroid.mesh.position) - asteroid.radius);
      const rating = threatRating(asteroid.size, asteroid.material, asteroid.timeToImpact === null);
      const what = asteroid.identified
        ? `${SIZE_NAME[asteroid.size]} ${MATERIAL_TRAITS[asteroid.material].label.toLowerCase()} · ${rating}`
        : `${SIZE_NAME[asteroid.size]} unidentified`;
      const name = `${what}${asteroid.targetSite ? ` → ${asteroid.targetSite.toUpperCase()}` : ''}`;
      const offer = `<span class="threat-pay${estimate ? ' estimate' : ''}">${estimate ? '~' : ''}${formatCredits(pay)}</span>`;
      const detail = `${offer} · ${distance} away · ${formatSpeed(asteroid.velocity.length())}`;
      return `<li class="${urgent ? 'urgent' : ''}"><span>${name}</span><span class="threat-eta">${eta}</span><span class="threat-detail">${detail}</span></li>`;
    });
    // In a field the rocks come first, after anything with a deadline; in a calm zone the jobs lead.
    const urgentJobs = snapshot.jobs.filter((job) => job.urgent).map(jobRow);
    const otherJobs = snapshot.jobs.filter((job) => !job.urgent).map(jobRow);
    const ordered = snapshot.focus.calm ? [...urgentJobs, ...otherJobs, ...contracts] : [...urgentJobs, ...contracts, ...otherJobs];
    const rows = ordered.slice(0, limit);
    const hidden = ordered.length - rows.length;
    if (hidden > 0) {
      rows.push(`<li class="empty">+${hidden} more · Tab shows all</li>`);
    }
    const markup = rows.length > 0 ? rows.join('') : '<li class="empty">No open contracts</li>';
    // Rewriting identical markup every frame would waste layout work.
    if (markup !== this.lastThreatMarkup) {
      this.threatList.innerHTML = markup;
      this.lastThreatMarkup = markup;
    }
  }
}
