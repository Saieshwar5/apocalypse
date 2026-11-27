/**
 * Frame timing for testing on real computers: with ?fps in the address a
 * small readout shows frames per second and the slowest recent frame. The
 * numbers are also available to browser automation as `frameStats`.
 */
export class FrameStats {
  fps = 0;
  /** Slowest frame in the last second, in milliseconds. */
  worstMs = 0;
  private frames = 0;
  private elapsed = 0;
  private worst = 0;
  private readonly element: HTMLDivElement | null = null;

  constructor(visible: boolean) {
    if (visible) {
      this.element = document.createElement('div');
      this.element.className = 'frame-stats';
      document.body.append(this.element);
    }
  }

  record(frameSeconds: number): void {
    this.frames += 1;
    this.elapsed += frameSeconds;
    this.worst = Math.max(this.worst, frameSeconds);
    if (this.elapsed < 1) {
      return;
    }
    this.fps = this.frames / this.elapsed;
    this.worstMs = this.worst * 1000;
    this.frames = 0;
    this.elapsed = 0;
    this.worst = 0;
    if (this.element) {
      this.element.textContent = `${this.fps.toFixed(0)} fps · worst ${this.worstMs.toFixed(0)} ms`;
    }
  }
}
