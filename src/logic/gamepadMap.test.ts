import { describe, expect, it } from 'vitest';
import { DEAD_ZONE, readPad, stickValue } from './gamepadMap';

const idle = { buttons: new Array<number>(16).fill(0), axes: [0, 0, 0, 0] };
const withButton = (index: number, value = 1) => ({ ...idle, buttons: idle.buttons.map((b, i) => (i === index ? value : b)) });

describe('game controller mapping', () => {
  it('reads nothing from an idle controller', () => {
    expect(readPad(idle)).toEqual({ held: [], steer: { x: 0, y: 0 }, active: false });
  });

  it('ignores a stick resting slightly off centre', () => {
    expect(stickValue(DEAD_ZONE * 0.9)).toBe(0);
    expect(readPad({ ...idle, axes: [0.1, -0.12, 0, 0] }).active).toBe(false);
  });

  it('steers smoothly: gentle near the centre, full at the edge, with the right signs', () => {
    expect(stickValue(1)).toBe(1);
    expect(stickValue(-1)).toBe(-1);
    const half = readPad({ ...idle, axes: [0.58, 0, 0, 0] }).steer.x;
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(0.3);
    expect(readPad({ ...idle, axes: [1, -1, 0, 0] }).steer).toEqual({ x: 1, y: -1 });
  });

  it('maps the triggers to thrust and brake, and the face buttons to the weapons and tow line', () => {
    expect(readPad(withButton(7)).held).toEqual(['KeyW']);
    expect(readPad(withButton(6)).held).toEqual(['KeyS']);
    expect(readPad(withButton(0)).held).toEqual(['Space']);
    expect(readPad(withButton(1)).held).toEqual(['KeyF']);
    expect(readPad(withButton(2)).held).toEqual(['KeyT']);
  });

  it('needs a trigger pulled at least half way', () => {
    expect(readPad(withButton(7, 0.3)).held).toEqual([]);
    expect(readPad(withButton(7, 0.6)).held).toEqual(['KeyW']);
  });

  it('slides the ship with the right stick', () => {
    expect(readPad({ ...idle, axes: [0, 0, -0.9, 0] }).held).toEqual(['KeyA']);
    expect(readPad({ ...idle, axes: [0, 0, 0.9, 0.9] }).held).toEqual(['KeyD', 'KeyV']);
    expect(readPad({ ...idle, axes: [0, 0, 0, -0.9] }).held).toEqual(['KeyR']);
  });
});
