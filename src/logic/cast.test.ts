import { describe, expect, it } from 'vitest';
import { CAST, DEFAULT_CALL_SIGN, LINES, RADIO_NET, fillLine, radioClear, sanitizeCallSign } from './cast';

describe('call signs', () => {
  it('are upper case, plain and short', () => {
    expect(sanitizeCallSign('nova 7!')).toBe('NOVA 7');
    expect(sanitizeCallSign('  red   wolf  ')).toBe('RED WOLF');
    expect(sanitizeCallSign('a-very-long-call-sign')).toHaveLength(14);
  });

  it('fall back to the default when empty or unusable', () => {
    expect(sanitizeCallSign('')).toBe(DEFAULT_CALL_SIGN);
    expect(sanitizeCallSign('!')).toBe(DEFAULT_CALL_SIGN);
    expect(sanitizeCallSign(42)).toBe(DEFAULT_CALL_SIGN);
  });
});

describe('radio lines', () => {
  it('fill in the call sign and leave unknown keys alone', () => {
    expect(fillLine('{callsign}, go', { callsign: 'NOVA' })).toBe('NOVA, go');
    expect(fillLine('{nope}', {})).toBe('{nope}');
  });

  it('only use speakers from the cast', () => {
    for (const moment of Object.values(LINES)) {
      for (const speaker of Object.keys(moment)) {
        expect(CAST).toHaveProperty(speaker);
      }
    }
  });

  it('are spaced out overall and per speaker', () => {
    expect(radioClear(10, 10 - RADIO_NET.anySeconds, -Infinity)).toBe(true);
    expect(radioClear(10, 9, -Infinity)).toBe(false);
    expect(radioClear(10, 0, 5)).toBe(false);
  });
});
