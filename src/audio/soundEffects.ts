/**
 * Sound effects synthesised with the Web Audio API, so the prototype needs no
 * audio files. Recorded sounds and radio voice lines can replace these later
 * (Howler.js is the planned library for that). The context starts only after
 * a user gesture, as browsers require.
 */
export class SoundEffects {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private muted = false;

  /** Call from a click or key handler. Safe to call more than once. */
  unlock(): void {
    if (this.context) {
      void this.context.resume();
      return;
    }
    const AudioContextClass = window.AudioContext;
    if (!AudioContextClass) {
      return;
    }
    this.context = new AudioContextClass();
    this.master = this.context.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.context.destination);
    this.noise = this.createNoiseBuffer(this.context);
    this.startEngine(this.context, this.master);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.55, this.context.currentTime, 0.05);
    }
    return this.muted;
  }

  /** Engine hum follows throttle (0..1). */
  setEngine(throttle: number, boosting: boolean): void {
    if (!this.context || !this.engineGain || !this.engineFilter) {
      return;
    }
    const now = this.context.currentTime;
    this.engineGain.gain.setTargetAtTime(0.03 + throttle * (boosting ? 0.12 : 0.07), now, 0.1);
    this.engineFilter.frequency.setTargetAtTime(220 + throttle * (boosting ? 900 : 500), now, 0.1);
  }

  laser(): void {
    this.tone({ type: 'square', from: 1400, to: 240, duration: 0.09, volume: 0.05 });
  }

  missile(): void {
    this.noiseBurst({ duration: 0.7, volume: 0.22, filterFrom: 3000, filterTo: 500 });
    this.tone({ type: 'sawtooth', from: 180, to: 520, duration: 0.5, volume: 0.04 });
  }

  hit(): void {
    this.noiseBurst({ duration: 0.06, volume: 0.08, filterFrom: 4000, filterTo: 2000 });
  }

  /** `size` from 0 (small) to 1 (giant). */
  explosion(size: number): void {
    this.noiseBurst({ duration: 0.5 + size * 1.6, volume: 0.25 + size * 0.35, filterFrom: 2200, filterTo: 120 });
    this.tone({ type: 'sine', from: 110, to: 35, duration: 0.4 + size, volume: 0.25 + size * 0.3 });
  }

  planetImpact(size: number): void {
    this.tone({ type: 'sine', from: 70, to: 22, duration: 1.4 + size * 2, volume: 0.5 + size * 0.4 });
    this.noiseBurst({ duration: 1.2 + size * 2, volume: 0.3 + size * 0.3, filterFrom: 700, filterTo: 60 });
  }

  alarm(): void {
    for (let index = 0; index < 3; index += 1) {
      this.tone({ type: 'square', from: 880, to: 880, duration: 0.16, volume: 0.05, delay: index * 0.4 });
      this.tone({ type: 'square', from: 660, to: 660, duration: 0.16, volume: 0.05, delay: index * 0.4 + 0.2 });
    }
  }

  chime(): void {
    this.tone({ type: 'triangle', from: 660, to: 660, duration: 0.25, volume: 0.06 });
    this.tone({ type: 'triangle', from: 990, to: 990, duration: 0.35, volume: 0.06, delay: 0.15 });
  }

  private tone(options: {
    type: OscillatorType;
    from: number;
    to: number;
    duration: number;
    volume: number;
    delay?: number;
  }): void {
    if (!this.context || !this.master) {
      return;
    }
    const start = this.context.currentTime + (options.delay ?? 0);
    const oscillator = this.context.createOscillator();
    oscillator.type = options.type;
    oscillator.frequency.setValueAtTime(options.from, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(options.to, 1), start + options.duration);
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(options.volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + options.duration);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(start);
    oscillator.stop(start + options.duration + 0.05);
  }

  private noiseBurst(options: { duration: number; volume: number; filterFrom: number; filterTo: number }): void {
    if (!this.context || !this.master || !this.noise) {
      return;
    }
    const start = this.context.currentTime;
    const source = this.context.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    const filter = this.context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(options.filterFrom, start);
    filter.frequency.exponentialRampToValueAtTime(options.filterTo, start + options.duration);
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(options.volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + options.duration);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(start);
    source.stop(start + options.duration + 0.05);
  }

  private startEngine(context: AudioContext, destination: AudioNode): void {
    const oscillator = context.createOscillator();
    oscillator.type = 'sawtooth';
    oscillator.frequency.value = 52;
    const rumble = context.createBufferSource();
    rumble.buffer = this.noise;
    rumble.loop = true;
    this.engineFilter = context.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 250;
    this.engineGain = context.createGain();
    this.engineGain.gain.value = 0;
    oscillator.connect(this.engineFilter);
    rumble.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain).connect(destination);
    oscillator.start();
    rumble.start();
  }

  private createNoiseBuffer(context: AudioContext): AudioBuffer {
    const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) {
      data[index] = Math.random() * 2 - 1;
    }
    return buffer;
  }
}
