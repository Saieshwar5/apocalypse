import type { SoundEffects } from '../audio/soundEffects';
import type { Hud } from '../hud/hud';
import type { FlightInput, ShipController } from '../ship/shipController';
import type { InputState } from './inputState';

/**
 * The flying keys: W thrust, S brake, A/D and R/V slide, Q/E roll, Shift
 * boost; the arrow keys steer as well as the mouse.
 */
export function readFlightInput(input: InputState): FlightInput {
  const axis = (positive: string[], negative: string[]) =>
    (positive.some((code) => input.isDown(code)) ? 1 : 0) - (negative.some((code) => input.isDown(code)) ? 1 : 0);
  return {
    look: input.consumeLook(),
    pitch: axis(['ArrowUp'], ['ArrowDown']),
    yaw: axis(['ArrowRight'], ['ArrowLeft']),
    thrust: input.isDown('KeyW') ? 1 : 0,
    brake: input.isDown('KeyS') ? 1 : 0,
    strafe: axis(['KeyD'], ['KeyA']),
    lift: axis(['KeyR'], ['KeyV']),
    roll: axis(['KeyE'], ['KeyQ']),
    boost: input.isDown('ShiftLeft') || input.isDown('ShiftRight'),
  };
}

/** Z toggles flight assist (only while flying), M toggles sound. */
export function handleShipToggles(input: InputState, ship: ShipController, hud: Hud, sound: SoundEffects, flying: boolean): void {
  if (input.consumePress('KeyZ') && flying) {
    ship.assist = !ship.assist;
    hud.showMessage(
      ship.assist ? 'Flight assist on: the ship goes where it points' : 'Flight assist off: the ship drifts, and gravity pulls it',
      'info',
      3,
    );
  }
  if (input.consumePress('KeyM')) {
    hud.showMessage(sound.toggleMute() ? 'Sound off' : 'Sound on', 'info', 1.5);
  }
}
