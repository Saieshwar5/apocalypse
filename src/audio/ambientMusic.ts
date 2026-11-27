/**
 * Generated background score: a low drone that is always present and a
 * tense pulse that rises with danger. It is synthesised so the game needs
 * no music files; recorded music can replace it later.
 */
export class AmbientMusic {
  private readonly tensionGain: GainNode;
  private readonly filter: BiquadFilterNode;

  constructor(
    private readonly context: AudioContext,
    destination: AudioNode,
  ) {
    const drone = context.createGain();
    drone.gain.value = 0.05;
    this.filter = context.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 320;
    // Two slightly detuned voices a fifth apart beat slowly against each other.
    for (const frequency of [55, 55.4, 82.4, 110.3]) {
      const oscillator = context.createOscillator();
      oscillator.type = 'sawtooth';
      oscillator.frequency.value = frequency;
      oscillator.connect(this.filter);
      oscillator.start();
    }
    this.filter.connect(drone).connect(destination);

    // Tension layer: a higher, pulsing minor second.
    this.tensionGain = context.createGain();
    this.tensionGain.gain.value = 0;
    const pulse = context.createGain();
    const lfo = context.createOscillator();
    lfo.frequency.value = 2.2;
    const lfoDepth = context.createGain();
    lfoDepth.gain.value = 0.5;
    pulse.gain.value = 0.5;
    lfo.connect(lfoDepth).connect(pulse.gain);
    lfo.start();
    for (const frequency of [220, 233.1]) {
      const oscillator = context.createOscillator();
      oscillator.type = 'triangle';
      oscillator.frequency.value = frequency;
      oscillator.connect(pulse);
      oscillator.start();
    }
    pulse.connect(this.tensionGain).connect(destination);
  }

  /** 0 in a calm zone, 1 when a severe threat is close. */
  setTension(level: number): void {
    const now = this.context.currentTime;
    const clamped = Math.min(1, Math.max(0, level));
    this.tensionGain.gain.setTargetAtTime(clamped * 0.05, now, 1.5);
    this.filter.frequency.setTargetAtTime(320 + clamped * 700, now, 1.5);
  }
}
