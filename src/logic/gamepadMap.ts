/**
 * A standard game controller mapped onto the flight controls. Buttons act
 * as the keys they stand for, so everything a key does a button does too;
 * the left stick steers smoothly, like the mouse.
 */
export interface PadState {
  /** Button values 0..1 in the standard layout (0 = A/Cross ... 15 = D-pad right). */
  buttons: readonly number[];
  /** Stick axes -1..1: left x, left y, right x, right y. */
  axes: readonly number[];
}

export interface PadReading {
  /** Key codes held down by the controller this frame. */
  held: string[];
  /** Steering from the left stick, -1..1 each way (x right, y down), after the dead zone. */
  steer: { x: number; y: number };
  /** True when anything on the controller is in use. */
  active: boolean;
}

/** Stick movement below this is treated as none: worn sticks never rest at exactly zero. */
export const DEAD_ZONE = 0.16;
const PRESSED = 0.5;

/** Standard-layout button index → the key it stands for. */
export const PAD_BUTTONS: Readonly<Record<number, string>> = {
  0: 'Space', // A / Cross: laser
  1: 'KeyF', // B / Circle: missile
  2: 'KeyT', // X / Square: tow line
  3: 'Tab', // Y / Triangle: map
  4: 'KeyQ', // LB: roll left
  5: 'KeyE', // RB: roll right
  6: 'KeyS', // LT: brake
  7: 'KeyW', // RT: thrust
  8: 'KeyB', // Back / Share: scanner range
  9: 'Enter', // Start / Options: skip, leave a calm zone
  10: 'ShiftLeft', // left stick click: boost
  11: 'KeyC', // right stick click: camera
  12: 'KeyU', // D-pad up: autopilot
  13: 'KeyX', // D-pad down (hold): turn the nose to the objective
  14: 'KeyG', // D-pad left: what the compass points at
  15: 'KeyZ', // D-pad right: flight assist
};

/** The right stick slides the ship: left/right and up/down. */
const SLIDE: readonly { axis: number; negative: string; positive: string }[] = [
  { axis: 2, negative: 'KeyA', positive: 'KeyD' },
  { axis: 3, negative: 'KeyR', positive: 'KeyV' },
];

/** Removes the dead zone and rescales so movement starts smoothly from its edge. */
export function stickValue(raw: number): number {
  const size = Math.abs(raw);
  if (!(size > DEAD_ZONE)) {
    return 0;
  }
  return Math.sign(raw) * Math.min(1, (size - DEAD_ZONE) / (1 - DEAD_ZONE));
}

export function readPad(pad: PadState): PadReading {
  const held: string[] = [];
  pad.buttons.forEach((value, index) => {
    const code = PAD_BUTTONS[index];
    if (code && value >= PRESSED) {
      held.push(code);
    }
  });
  for (const { axis, negative, positive } of SLIDE) {
    const value = pad.axes[axis] ?? 0;
    if (value <= -PRESSED) {
      held.push(negative);
    } else if (value >= PRESSED) {
      held.push(positive);
    }
  }
  const x = stickValue(pad.axes[0] ?? 0);
  const y = stickValue(pad.axes[1] ?? 0);
  // Gentle near the centre for fine aim, full rate at the edge.
  const curve = (value: number) => Math.sign(value) * value * value;
  const steer = { x: curve(x), y: curve(y) };
  return { held, steer, active: held.length > 0 || steer.x !== 0 || steer.y !== 0 };
}
