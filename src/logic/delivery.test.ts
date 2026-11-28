import { describe, expect, it } from 'vitest';
import { deliveryStep, deliveryTitle } from './delivery';

describe('delivering a towed load', () => {
  const zone = { radius: 10, maxSpeed: 2.5 };

  it('walks through travel, slow down and release', () => {
    expect(deliveryStep({ ...zone, distance: 60, speed: 12 }).state).toBe('travel');
    const slow = deliveryStep({ ...zone, distance: 6, speed: 9 });
    expect(slow.state).toBe('slow');
    expect(slow.text).toContain('slow below');
    expect(deliveryStep({ ...zone, distance: 6, speed: 1 })).toEqual({ state: 'release', text: 'In the drop zone: release now (T)' });
  });

  it('holds a satellite out of a rock path until the rock has gone', () => {
    expect(deliveryStep({ ...zone, distance: 0, speed: 0, dodge: { strikeSeconds: 23 } }).text).toContain('Rock arrives in 0:23');
    expect(deliveryStep({ ...zone, distance: 0, speed: 0, dodge: { strikeSeconds: null } }).state).toBe('safe');
  });

  it('names the load and where it goes', () => {
    expect(deliveryTitle('WX-2 CIRRUS', 'Vulcan Yard cradle', 87.4)).toBe('Towing WX-2 CIRRUS (87%) → Vulcan Yard cradle');
    expect(deliveryTitle('9.6 t rock', 'Ceres Works intake', null)).toBe('Towing 9.6 t rock → Ceres Works intake');
  });
});
