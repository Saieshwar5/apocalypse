import { describe, expect, it } from 'vitest';
import { LOGBOOK_SIZE, addLogEntry, sanitizeLog } from './logbook';
import { LIVERIES, liveryById, sanitizeShipName } from './livery';

describe('logbook', () => {
  it('keeps newest first and caps the size', () => {
    let log = addLogEntry([], 'First flight', '2026-11-28');
    log = addLogEntry(log, '  Gold   medal: rescue ', '2026-11-29');
    expect(log[0]).toEqual({ date: '2026-11-29', text: 'Gold medal: rescue' });
    for (let index = 0; index < 60; index += 1) {
      log = addLogEntry(log, `Entry ${index}`, '2026-11-30');
    }
    expect(log).toHaveLength(LOGBOOK_SIZE);
    expect(addLogEntry([], '   ', '2026-11-30')).toEqual([]);
  });

  it('repairs stored logs', () => {
    expect(sanitizeLog('junk')).toEqual([]);
    expect(sanitizeLog([{ date: '2026-11-28T10:00', text: 'ok' }, { date: 5 }])).toEqual([{ date: '2026-11-28', text: 'ok' }]);
  });
});

describe('livery and name', () => {
  it('falls back to the factory finish', () => {
    expect(liveryById('nope')).toBe(LIVERIES[0]);
    expect(liveryById('gold').tint).not.toBeNull();
  });

  it('cleans ship names', () => {
    expect(sanitizeShipName('  Dawn <Treader>!  ')).toBe('DAWN TREADER');
    expect(sanitizeShipName(42)).toBe('');
    expect(sanitizeShipName('x'.repeat(40))).toHaveLength(18);
  });
});

