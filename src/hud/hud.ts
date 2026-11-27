import type { Asteroid } from '../asteroids/asteroidField';
import { MATERIAL_TRAITS, type AsteroidSize } from '../logic/asteroidClasses';
import { integrityLevel } from '../logic/planetDamage';
import { MISSILE_CAPACITY } from '../weapons/missileLauncher';

export interface HudSnapshot {
  integrity: number;
  wave: number;
  score: number;
  threats: readonly Asteroid[];
  laserHeat: number;
  overheated: boolean;
  missiles: number;
  boost: number;
  hull: number;
  speed: number;
}

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
  private readonly speedValue = element<HTMLElement>('#speed-value');
  private readonly message = element<HTMLDivElement>('#hud-message');
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
    this.hullBar.style.width = `${snapshot.hull}%`;
    this.hullBar.dataset.level = integrityLevel(snapshot.hull);
    this.speedValue.textContent = snapshot.speed.toFixed(0);

    this.renderThreats(snapshot.threats);

    if (this.messageTimer > 0) {
      this.messageTimer -= deltaSeconds;
      if (this.messageTimer <= 0) {
        this.message.classList.remove('visible');
      }
    }
  }

  showMessage(text: string, tone: MessageTone = 'info', seconds = 3): void {
    this.message.textContent = text;
    this.message.dataset.tone = tone;
    this.message.classList.add('visible');
    this.messageTimer = seconds;
  }

  private renderThreats(threats: readonly Asteroid[]): void {
    const rows = threats.slice(0, VISIBLE_THREATS).map((asteroid) => {
      const eta = asteroid.timeToImpact === null ? 'miss' : `${Math.ceil(asteroid.timeToImpact)} s`;
      const urgent = asteroid.timeToImpact !== null && asteroid.timeToImpact < 20;
      return `<li class="${urgent ? 'urgent' : ''}"><span>${SIZE_NAME[asteroid.size]} ${MATERIAL_TRAITS[asteroid.material].label.toLowerCase()}</span><span>-${asteroid.planetDamage.toFixed(0)}%</span><span>${eta}</span></li>`;
    });
    const markup = rows.length > 0 ? rows.join('') : '<li class="empty">No contacts</li>';
    // Rewriting identical markup every frame would waste layout work.
    if (markup !== this.lastThreatMarkup) {
      this.threatList.innerHTML = markup;
      this.lastThreatMarkup = markup;
    }
  }
}
