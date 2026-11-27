import { SECTOR_LABEL, type Sector, type SectorKind } from '../logic/orbitPlan';
import { formatCountdown } from '../logic/units';

const SECTOR_COLOR: Record<SectorKind, string> = {
  calm: '#2f8f7a',
  light: '#c9b458',
  dense: '#d9822b',
  giant: '#d6453a',
};

export interface OrbitStatus {
  sectors: readonly Sector[];
  index: number;
  progress: number;
  phase: 'calm' | 'field' | 'gap' | 'complete';
  remaining: number;
}

/**
 * The orbit forecast: one strip for the whole orbit, coloured by what each
 * stretch holds, with a marker for the planet. The line below says what the
 * current stretch is and what comes next, so the pilot can plan refuelling.
 */
export class OrbitMap {
  private readonly context: CanvasRenderingContext2D;
  private lastText = '';

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly label: HTMLElement,
  ) {
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Orbit map needs a 2D canvas context');
    }
    this.context = context;
    const ratio = Math.min(window.devicePixelRatio, 2);
    canvas.width = (canvas.clientWidth || 380) * ratio;
    canvas.height = (canvas.clientHeight || 18) * ratio;
    context.scale(ratio, ratio);
  }

  draw(status: OrbitStatus): void {
    const width = this.canvas.clientWidth || 380;
    const height = this.canvas.clientHeight || 18;
    const context = this.context;
    const count = status.sectors.length;
    const cell = width / count;
    context.clearRect(0, 0, width, height);
    status.sectors.forEach((sector, index) => {
      context.globalAlpha = index < status.index ? 0.3 : 1;
      context.fillStyle = SECTOR_COLOR[sector.kind];
      context.fillRect(index * cell + 1, 5, cell - 2, height - 10);
    });
    context.globalAlpha = 1;
    const x = Math.min(width - 2, Math.max(2, status.progress * width));
    context.fillStyle = '#ffffff';
    context.fillRect(x - 1, 0, 2, height);
    context.beginPath();
    context.arc(x, height / 2, 4, 0, Math.PI * 2);
    context.fillStyle = '#7db8ff';
    context.fill();

    const text = this.describe(status);
    if (text !== this.lastText) {
      this.label.textContent = text;
      this.lastText = text;
    }
  }

  private describe(status: OrbitStatus): string {
    if (status.phase === 'complete') {
      return 'Orbit complete';
    }
    const current = status.sectors[status.index];
    const next = status.sectors[status.index + 1];
    const here = current ? SECTOR_LABEL[current.kind] : 'Entering orbit';
    const position = `${Math.max(status.index, 0) + 1}/${status.sectors.length}`;
    if (status.phase === 'calm' && next) {
      return `Orbit ${position} · ${here} · ${SECTOR_LABEL[next.kind]} in ${formatCountdown(status.remaining)}`;
    }
    return `Orbit ${position} · ${here}${next ? ` · next: ${SECTOR_LABEL[next.kind]}` : ' · final field'}`;
  }
}
