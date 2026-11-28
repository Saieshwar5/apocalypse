import { describe, expect, it } from 'vitest';
import { sanitizeSettings } from './settings';

describe('settings', () => {
  it('falls back to defaults for missing or malformed data', () => {
    expect(sanitizeSettings(null)).toEqual({ sensitivity: 1, quality: 'auto', callSign: 'VEGA' });
    expect(sanitizeSettings({ sensitivity: 'fast', quality: 'ultra' })).toEqual({ sensitivity: 1, quality: 'auto', callSign: 'VEGA' });
  });

  it('clamps sensitivity and keeps a valid quality', () => {
    expect(sanitizeSettings({ sensitivity: 9, quality: 'low' })).toEqual({ sensitivity: 2, quality: 'low', callSign: 'VEGA' });
    expect(sanitizeSettings({ sensitivity: 0.1 })).toEqual({ sensitivity: 0.4, quality: 'auto', callSign: 'VEGA' });
  });
});
