import type * as THREE from 'three';
import type { Asteroid } from '../asteroids/asteroidField';
import { MATERIAL_TRAITS, type AsteroidSize } from '../logic/asteroidClasses';
import type { AltitudeReadout, AtmosphereZone } from '../logic/atmosphere';
import { integrityLevel } from '../logic/planetDamage';
import { formatCountdown, formatDistance, formatSpeed } from '../logic/units';
import type { SiteState } from '../sites/siteDefence';
import { MISSILE_CAPACITY } from '../weapons/missileLauncher';
import { SitePanel } from './sitePanel';

export interface HudSnapshot {
  integrity: number;
  wave: number;
  score: number;
  threats: readonly Asteroid[];
  laserHeat: number;
  overheated: boolean;
  missiles: number;
  boost: number;
  shield: number;
  hull: number;
  speed: number;
  shipPosition: THREE.Vector3;
  fuel: number;
  station: { distance: number | null; docked: boolean; stock: { fuel: number; missiles: number } };
  altitude: AltitudeReadout;
  zone: AtmosphereZone;
  sites: readonly SiteState[];
}

const ZONE_LABEL: Record<AtmosphereZone, string> = {
  space: 'Space',
  warning: 'Low: pull up',
  atmosphere: 'IN ATMOSPHERE',
  breakup: 'BREAK-UP',
};

export type MessageTone = 'info' | 'warning' | 'danger' | 'success';

const SIZE_NAME: Record<AsteroidSize, string> = { small: 'Small', medium: 'Medium', large: 'Large', giant: 'Giant' };
const VISIBLE_THREATS = 5;

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
  private readonly waveValue = element<HTMLElement>('#wave-value');
  private readonly scoreValue = element<HTMLElement>('#score-value');
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
  private readonly centreValue = element<HTMLElement>('#centre-value');
  private readonly surfaceValue = element<HTMLElement>('#surface-value');
  private readonly atmosphereValue = element<HTMLElement>('#atmosphere-value');
  private readonly zoneValue = element<HTMLElement>('#zone-value');
  private readonly hint = element<HTMLDivElement>('#hud-hint');
  private readonly damageFlash = element<HTMLDivElement>('#damage-flash');
  private readonly defaultHint = this.hint.textContent ?? '';
  private sitePanel: SitePanel | null = null;
  private flash = 0;
  private messageTimer = 0;
  private lastThreatMarkup = '';

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  update(deltaSeconds: number, snapshot: HudSnapshot): void {
    const integrity = Math.max(0, snapshot.integrity);
    this.integrityBar.style.width = `${integrity}%`;
    this.integrityBar.dataset.level = integrityLevel(integrity);
    this.integrityValue.textContent = `${integrity.toFixed(0)}%`;
    this.waveValue.textContent = String(snapshot.wave);
    this.scoreValue.textContent = snapshot.score.toLocaleString();

    this.heatBar.style.width = `${snapshot.laserHeat}%`;
    this.heatBar.dataset.level = snapshot.overheated ? 'critical' : snapshot.laserHeat > 70 ? 'damaged' : 'stable';
    this.missileValue.textContent = `${snapshot.missiles} / ${MISSILE_CAPACITY}`;
    this.boostBar.style.width = `${snapshot.boost}%`;
    this.fuelBar.style.width = `${snapshot.fuel}%`;
    this.fuelBar.dataset.level = snapshot.fuel <= 0 ? 'critical' : snapshot.fuel < 25 ? 'damaged' : 'stable';
    const { station } = snapshot;
    this.stationValue.textContent = station.docked ? 'DOCKED' : station.distance === null ? '—' : formatDistance(station.distance);
    this.stockValue.textContent = `${Math.round(station.stock.fuel)} fuel · ${Math.floor(station.stock.missiles)} missiles`;
    this.shieldBar.style.width = `${snapshot.shield}%`;
    this.hullBar.style.width = `${snapshot.hull}%`;
    this.hullBar.dataset.level = integrityLevel(snapshot.hull);
    this.speedValue.textContent = formatSpeed(snapshot.speed);

    this.renderThreats(snapshot);
    this.renderPosition(snapshot);
    this.sitePanel ??= new SitePanel(element<HTMLOListElement>('#site-list'), snapshot.sites);
    this.sitePanel.update(snapshot.sites);
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - deltaSeconds * 1.8);
      this.damageFlash.style.opacity = String(this.flash);
    }

    if (this.messageTimer > 0) {
      this.messageTimer -= deltaSeconds;
      if (this.messageTimer <= 0) {
        this.message.classList.remove('visible');
      }
    }
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

  showMessage(text: string, tone: MessageTone = 'info', seconds = 3): void {
    this.message.textContent = text;
    this.message.dataset.tone = tone;
    this.message.classList.add('visible');
    this.messageTimer = seconds;
  }

  private renderThreats(snapshot: HudSnapshot): void {
    const rows = snapshot.threats.slice(0, VISIBLE_THREATS).map((asteroid) => {
      const eta = asteroid.timeToImpact === null ? 'misses' : formatCountdown(asteroid.timeToImpact);
      const urgent = asteroid.timeToImpact !== null && (asteroid.timeToImpact < 20 || asteroid.threatensSite);
      const distance = formatDistance(snapshot.shipPosition.distanceTo(asteroid.mesh.position) - asteroid.radius);
      const target = asteroid.targetSite ? ` → ${asteroid.targetSite.toUpperCase()}` : ` · -${asteroid.planetDamage.toFixed(0)}%`;
      const name = `${SIZE_NAME[asteroid.size]} ${MATERIAL_TRAITS[asteroid.material].label.toLowerCase()}${target}`;
      const detail = `${distance} away · ${formatSpeed(asteroid.velocity.length())}`;
      return `<li class="${urgent ? 'urgent' : ''}"><span>${name}</span><span class="threat-eta">${eta}</span><span class="threat-detail">${detail}</span></li>`;
    });
    const markup = rows.length > 0 ? rows.join('') : '<li class="empty">No contacts</li>';
    // Rewriting identical markup every frame would waste layout work.
    if (markup !== this.lastThreatMarkup) {
      this.threatList.innerHTML = markup;
      this.lastThreatMarkup = markup;
    }
  }
}
