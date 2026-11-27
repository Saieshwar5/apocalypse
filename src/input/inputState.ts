/**
 * Keyboard and mouse state for one canvas. Mouse movement is accumulated
 * between frames and read once per frame with `consumeLook`. Single-press
 * actions (switch camera, fire missile) are read with `consumePress` so a
 * held key does not repeat them.
 */
export class InputState {
  private readonly held = new Set<string>();
  private readonly pressed = new Set<string>();
  private lookX = 0;
  private lookY = 0;
  private primaryHeld = false;

  constructor(private readonly target: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    target.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    target.addEventListener('contextmenu', this.onContextMenu);
  }

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.target;
  }

  requestPointerLock(): void {
    if (!this.pointerLocked) {
      // Some browsers return a promise that rejects when the request is refused.
      const result = this.target.requestPointerLock() as unknown;
      if (result instanceof Promise) {
        result.catch(() => undefined);
      }
    }
  }

  releasePointerLock(): void {
    if (this.pointerLocked) {
      document.exitPointerLock();
    }
  }

  isDown(code: string): boolean {
    return this.held.has(code);
  }

  /** True once per key press (or right click for 'MouseRight'). */
  consumePress(code: string): boolean {
    const wasPressed = this.pressed.has(code);
    this.pressed.delete(code);
    return wasPressed;
  }

  get firingPrimary(): boolean {
    return this.primaryHeld || this.held.has('Space');
  }

  consumeLook(): { x: number; y: number } {
    const look = { x: this.lookX, y: this.lookY };
    this.lookX = 0;
    this.lookY = 0;
    return look;
  }

  /** Forget everything, for example when the game pauses. */
  clear(): void {
    this.held.clear();
    this.pressed.clear();
    this.primaryHeld = false;
    this.lookX = 0;
    this.lookY = 0;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.target.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    this.target.removeEventListener('contextmenu', this.onContextMenu);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    // In flight Tab opens the tactical map, so it must not move focus; in
    // menus (mouse not captured) Tab keeps its normal keyboard navigation.
    const flightTab = event.code === 'Tab' && this.pointerLocked;
    if (event.code === 'Space' || flightTab || event.code.startsWith('Arrow')) {
      event.preventDefault();
    }
    if (!event.repeat) {
      this.pressed.add(event.code);
    }
    this.held.add(event.code);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.held.delete(event.code);
  };

  private readonly onBlur = (): void => {
    this.clear();
  };

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (event.button === 0) {
      this.primaryHeld = true;
    } else if (event.button === 2) {
      this.pressed.add('MouseRight');
    }
  };

  private readonly onMouseUp = (event: MouseEvent): void => {
    if (event.button === 0) {
      this.primaryHeld = false;
    }
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (this.pointerLocked) {
      this.lookX += event.movementX;
      this.lookY += event.movementY;
    }
  };

  private readonly onContextMenu = (event: Event): void => {
    event.preventDefault();
  };
}
