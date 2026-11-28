/**
 * Automatic graphics quality. The game starts on high and measures how long
 * frames take while flying. If the computer cannot keep up, it drops to low
 * once and says so; the player can always choose in the pause menu.
 */
export type GraphicsQuality = 'low' | 'high';
export type QualityPreference = GraphicsQuality | 'auto';

export const AUTO_QUALITY = {
  /** Ignore the first seconds: loading and shader compilation make them slow. */
  warmUpSeconds: 3,
  /** Average over this long before deciding. */
  sampleSeconds: 4,
  /** Slower than this on average (about 33 frames a second) means drop to low. */
  slowFrameSeconds: 1 / 33,
} as const;

export interface FrameSampler {
  elapsed: number;
  measured: number;
  frames: number;
  decided: boolean;
}

export function createSampler(): FrameSampler {
  return { elapsed: 0, measured: 0, frames: 0, decided: false };
}

/**
 * Feeds one frame's real duration. Returns 'low' once, when the average after
 * warm-up is too slow; otherwise null.
 */
export function sampleFrame(sampler: FrameSampler, frameSeconds: number): GraphicsQuality | null {
  if (sampler.decided) {
    return null;
  }
  sampler.elapsed += frameSeconds;
  if (sampler.elapsed < AUTO_QUALITY.warmUpSeconds) {
    return null;
  }
  sampler.measured += frameSeconds;
  sampler.frames += 1;
  if (sampler.measured < AUTO_QUALITY.sampleSeconds) {
    return null;
  }
  sampler.decided = true;
  return sampler.measured / sampler.frames > AUTO_QUALITY.slowFrameSeconds ? 'low' : null;
}

/** The quality to render with for a preference and what auto has decided. */
export function effectiveQuality(preference: QualityPreference, autoChoice: GraphicsQuality): GraphicsQuality {
  return preference === 'auto' ? autoChoice : preference;
}
