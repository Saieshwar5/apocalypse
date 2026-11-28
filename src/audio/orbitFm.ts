/**
 * Orbit FM: calm music made live in the browser, so nothing needs licensing.
 * A slow progression in A minor (Am9, Fmaj7, Cmaj7, G6, two bars each) with a
 * soft pad, a plucked arpeggio through an echo, and a round bass. Tension
 * brightens the filter and adds a light hi-hat; calm keeps it mellow.
 */
const BPM = 76;
const STEP = 60 / BPM / 2;
const STEPS_PER_CHORD = 16;
const LOOKAHEAD = 0.35;

/** MIDI notes: pad voicing, arpeggio tones (an octave up), bass root. */
const CHORDS: readonly { pad: number[]; arp: number[]; bass: number }[] = [
  { pad: [57, 60, 64, 67, 71], arp: [69, 72, 76, 79, 83], bass: 45 },
  { pad: [53, 57, 60, 64], arp: [65, 69, 72, 76, 81], bass: 41 },
  { pad: [48, 55, 59, 64], arp: [67, 72, 76, 79, 84], bass: 48 },
  { pad: [55, 59, 62, 64], arp: [67, 71, 74, 76, 83], bass: 43 },
];
const ARP_PATTERN = [0, 2, 1, 3, 2, 4, 1, 3, 0, 2, 3, 4, 2, 3, 1, 2];
/** Steps that rest, so the line breathes. */
const ARP_RESTS = new Set([7, 15]);

function frequency(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}

export class OrbitFm {
  private readonly output: GainNode;
  private readonly arpFilter: BiquadFilterNode;
  private readonly echoSend: GainNode;
  private timer: number | null = null;
  private nextTime = 0;
  private step = 0;
  private tension = 0;

  constructor(
    private readonly context: AudioContext,
    destination: AudioNode,
    private readonly noise: AudioBuffer | null,
  ) {
    this.output = context.createGain();
    this.output.gain.value = 0;
    this.output.connect(destination);
    this.arpFilter = context.createBiquadFilter();
    this.arpFilter.type = 'lowpass';
    this.arpFilter.frequency.value = 1800;
    this.arpFilter.connect(this.output);
    // A dotted-eighth echo gives the arpeggio space.
    const delay = context.createDelay(1);
    delay.delayTime.value = STEP * 1.5;
    const feedback = context.createGain();
    feedback.gain.value = 0.38;
    const wet = context.createGain();
    wet.gain.value = 0.45;
    this.echoSend = context.createGain();
    this.echoSend.gain.value = 1;
    this.arpFilter.connect(this.echoSend).connect(delay);
    delay.connect(feedback).connect(delay);
    delay.connect(wet).connect(this.output);
  }

  get playing(): boolean {
    return this.timer !== null;
  }

  start(): void {
    if (this.timer !== null) {
      return;
    }
    const now = this.context.currentTime;
    this.output.gain.cancelScheduledValues(now);
    this.output.gain.setTargetAtTime(0.9, now, 1.2);
    this.nextTime = now + 0.1;
    this.step = 0;
    this.timer = window.setInterval(() => this.schedule(), 100);
  }

  stop(): void {
    if (this.timer === null) {
      return;
    }
    window.clearInterval(this.timer);
    this.timer = null;
    this.output.gain.setTargetAtTime(0, this.context.currentTime, 0.6);
  }

  /** 0 calm to 1 tense. */
  setTension(level: number): void {
    this.tension = Math.min(1, Math.max(0, level));
    this.arpFilter.frequency.setTargetAtTime(1400 + this.tension * 2400, this.context.currentTime, 2);
  }

  private schedule(): void {
    while (this.nextTime < this.context.currentTime + LOOKAHEAD) {
      this.playStep(this.step, this.nextTime);
      this.step = (this.step + 1) % (STEPS_PER_CHORD * CHORDS.length);
      this.nextTime += STEP;
    }
  }

  private playStep(step: number, time: number): void {
    const chord = CHORDS[Math.floor(step / STEPS_PER_CHORD)];
    const inChord = step % STEPS_PER_CHORD;
    if (inChord === 0) {
      this.pad(chord.pad, time, STEP * STEPS_PER_CHORD);
    }
    if (inChord % 8 === 0 || inChord % 8 === 5) {
      this.bass(chord.bass, time);
    }
    if (!ARP_RESTS.has(inChord)) {
      this.pluck(chord.arp[ARP_PATTERN[inChord] % chord.arp.length], time, inChord % 4 === 0 ? 0.05 : 0.035);
    }
    if (this.tension > 0.35 && inChord % 2 === 1) {
      this.hat(time, 0.012 + this.tension * 0.015);
    }
  }

  private pad(notes: readonly number[], time: number, length: number): void {
    const filter = this.context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.022, time + 1.6);
    gain.gain.setValueAtTime(0.022, time + length - 1.2);
    gain.gain.linearRampToValueAtTime(0, time + length + 0.8);
    filter.connect(gain).connect(this.output);
    for (const note of notes) {
      for (const detune of [-6, 6]) {
        const oscillator = this.context.createOscillator();
        oscillator.type = 'triangle';
        oscillator.frequency.value = frequency(note);
        oscillator.detune.value = detune;
        oscillator.connect(filter);
        oscillator.start(time);
        oscillator.stop(time + length + 1);
      }
    }
  }

  private pluck(note: number, time: number, volume: number): void {
    const oscillator = this.context.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency(note);
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(volume, time + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.9);
    oscillator.connect(gain).connect(this.arpFilter);
    oscillator.start(time);
    oscillator.stop(time + 1);
  }

  private bass(note: number, time: number): void {
    const oscillator = this.context.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency(note);
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.07, time + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + STEP * 3);
    oscillator.connect(gain).connect(this.output);
    oscillator.start(time);
    oscillator.stop(time + STEP * 3 + 0.05);
  }

  private hat(time: number, volume: number): void {
    if (!this.noise) {
      return;
    }
    const source = this.context.createBufferSource();
    source.buffer = this.noise;
    const filter = this.context.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 7000;
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    source.connect(filter).connect(gain).connect(this.output);
    source.start(time, Math.random() * 0.5, 0.06);
  }
}
