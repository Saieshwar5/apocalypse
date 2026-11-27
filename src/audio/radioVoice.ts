/**
 * Mission control's voice, using the browser's built-in speech synthesis.
 * Only urgent calls are spoken, a new call replaces one still being read,
 * and everything is skipped silently where the browser has no voices.
 */
export class RadioVoice {
  enabled = true;
  private lastSpoken = '';
  private lastTime = 0;

  speak(text: string): void {
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    if (!this.enabled || !synth || typeof SpeechSynthesisUtterance === 'undefined') {
      return;
    }
    const now = performance.now();
    // The same warning can be raised many times in a few seconds; say it once.
    if (text === this.lastSpoken && now - this.lastTime < 8000) {
      return;
    }
    this.lastSpoken = text;
    this.lastTime = now;
    const utterance = new SpeechSynthesisUtterance(text.replace(/[→·:]/g, ', '));
    utterance.rate = 1.08;
    utterance.pitch = 0.9;
    utterance.volume = 0.8;
    synth.cancel();
    synth.speak(utterance);
  }

  stop(): void {
    if (typeof window !== 'undefined') {
      window.speechSynthesis?.cancel();
    }
  }
}
