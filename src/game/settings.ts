import { LIVERIES, liveryById, sanitizeShipName } from '../logic/livery';
import type { QualityPreference } from '../logic/qualityTier';
import { DEFAULT_CALL_SIGN, sanitizeCallSign } from '../logic/cast';

export type { QualityPreference };

export interface Settings {
  /** Mouse steering multiplier, 0.4 to 2. */
  sensitivity: number;
  /** 'auto' measures the frame rate and lowers quality if the computer struggles. */
  quality: QualityPreference;
  /** What everyone on the radio calls the pilot. */
  callSign: string;
  /** Hardcore licence: one ship, no loan, better pay. */
  hardcore: boolean;
  /** Paint scheme id (see logic/livery) and the ship's name. */
  livery: string;
  shipName: string;
}

export const DEFAULT_SETTINGS: Settings = { sensitivity: 1, quality: 'auto', callSign: DEFAULT_CALL_SIGN, hardcore: false, livery: 'factory', shipName: '' };
const STORAGE_KEY = 'singularity.settings.v1';

/** Clamps and repairs stored settings, which may be missing or edited by hand. */
export function sanitizeSettings(value: unknown): Settings {
  const candidate = (typeof value === 'object' && value !== null ? value : {}) as Partial<Settings>;
  const sensitivity = typeof candidate.sensitivity === 'number' && Number.isFinite(candidate.sensitivity) ? candidate.sensitivity : 1;
  return {
    sensitivity: Math.min(2, Math.max(0.4, sensitivity)),
    quality: candidate.quality === 'low' || candidate.quality === 'high' ? candidate.quality : 'auto',
    callSign: sanitizeCallSign(candidate.callSign),
    hardcore: candidate.hardcore === true,
    livery: liveryById(typeof candidate.livery === 'string' ? candidate.livery : '').id,
    shipName: sanitizeShipName(candidate.shipName),
  };
}

export function loadSettings(): Settings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? sanitizeSettings(JSON.parse(raw)) : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable: the settings still apply for this session.
  }
}

/** Wires the settings controls on the pause screen. */
export function bindSettingsControls(settings: Settings, onChange: (settings: Settings) => void): void {
  const slider = document.querySelector<HTMLInputElement>('#sensitivity-input');
  const quality = document.querySelector<HTMLSelectElement>('#quality-input');
  const callSign = document.querySelector<HTMLInputElement>('#callsign-input');
  const hardcore = document.querySelector<HTMLInputElement>('#hardcore-input');
  const livery = document.querySelector<HTMLSelectElement>('#livery-input');
  const shipName = document.querySelector<HTMLInputElement>('#shipname-input');
  if (!slider || !quality || !callSign || !hardcore || !livery || !shipName) {
    throw new Error('Settings controls are missing from index.html');
  }
  slider.value = String(settings.sensitivity);
  quality.value = settings.quality;
  callSign.value = settings.callSign;
  hardcore.checked = settings.hardcore;
  livery.replaceChildren(...LIVERIES.map((option) => new Option(option.name, option.id)));
  livery.value = settings.livery;
  shipName.value = settings.shipName;
  const update = (): void => {
    const next = sanitizeSettings({ sensitivity: Number(slider.value), quality: quality.value, callSign: callSign.value, hardcore: hardcore.checked, livery: livery.value, shipName: shipName.value });
    saveSettings(next);
    onChange(next);
  };
  slider.addEventListener('input', update);
  quality.addEventListener('change', update);
  hardcore.addEventListener('change', update);
  livery.addEventListener('change', update);
  shipName.addEventListener('change', () => {
    update();
    shipName.value = sanitizeShipName(shipName.value);
  });
  callSign.addEventListener('change', () => {
    update();
    callSign.value = sanitizeCallSign(callSign.value);
  });
}
