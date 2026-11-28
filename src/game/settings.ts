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
}

export const DEFAULT_SETTINGS: Settings = { sensitivity: 1, quality: 'auto', callSign: DEFAULT_CALL_SIGN, hardcore: false };
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
  if (!slider || !quality || !callSign || !hardcore) {
    throw new Error('Settings controls are missing from index.html');
  }
  slider.value = String(settings.sensitivity);
  quality.value = settings.quality;
  callSign.value = settings.callSign;
  hardcore.checked = settings.hardcore;
  const update = (): void => {
    const next = sanitizeSettings({ sensitivity: Number(slider.value), quality: quality.value, callSign: callSign.value, hardcore: hardcore.checked });
    saveSettings(next);
    onChange(next);
  };
  slider.addEventListener('input', update);
  quality.addEventListener('change', update);
  hardcore.addEventListener('change', update);
  callSign.addEventListener('change', () => {
    update();
    callSign.value = sanitizeCallSign(callSign.value);
  });
}
