/**
 * Optional ambience, OFF by default and started only by a click on the Sound button (browsers
 * require a user gesture, and nobody should be surprised by sound). Entirely procedural - one
 * generated noise buffer, filters and gains; no audio files, no network:
 *   - water: low-passed noise, always on while sound is on
 *   - wind:  band-passed noise, louder with the storm share
 *   - thunder: a low rumble a moment after each lightning flash
 * Suspended while the tab is hidden. Gains change with setTargetAtTime (no clicks, no per-frame
 * node churn). Lazily imported by main.ts on the first click of the Sound button.
 */

export class Ambience {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private wind: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private lastStorm = -1;
  private lastFlash = 0;
  private enabled = false;

  constructor(private readonly button: HTMLButtonElement) {
    document.addEventListener("visibilitychange", () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else if (this.enabled) void this.ctx.resume();
    });
    this.render();
  }

  get on(): boolean {
    return this.enabled;
  }

  async toggle(): Promise<void> {
    this.enabled = !this.enabled;
    this.render();
    if (this.enabled) {
      if (!this.ctx) this.build();
      await this.ctx?.resume();
      this.master?.gain.setTargetAtTime(0.9, this.ctx?.currentTime ?? 0, 0.4);
    } else if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
      window.setTimeout(() => {
        if (!this.enabled) void this.ctx?.suspend();
      }, 800);
    }
  }

  /** Per frame (cheap: compares two numbers unless something changed). */
  update(storm: number, flash: number): void {
    if (!this.enabled || !this.ctx || !this.wind) return;
    if (Math.abs(storm - this.lastStorm) > 0.02) {
      this.lastStorm = storm;
      this.wind.gain.setTargetAtTime(0.015 + storm * 0.12, this.ctx.currentTime, 1.5);
    }
    if (flash > 0.5 && this.lastFlash <= 0.5) this.thunder(0.35 + Math.random() * 0.9);
    this.lastFlash = flash;
  }

  private render(): void {
    this.button.setAttribute("aria-pressed", String(this.enabled));
    this.button.textContent = this.enabled ? "Sound on" : "Sound off";
  }

  private build(): void {
    const ctx = new AudioContext();
    this.ctx = ctx;
    // Two seconds of brown-ish noise, looped by every voice (tiny: ~350 KB of float samples).
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      data[i] = last * 3.5;
    }
    this.noise = buffer;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    const water = this.voice(ctx, "lowpass", 480, 0.7, 0.35);
    water.connect(this.master);
    this.wind = this.voice(ctx, "bandpass", 380, 0.6, 0.015);
    this.wind.connect(this.master);
  }

  private voice(ctx: AudioContext, type: BiquadFilterType, freq: number, q: number, gain: number): GainNode {
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(filter).connect(g);
    src.start();
    return g;
  }

  private thunder(delay: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 140;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.9, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.001, t + 2.6);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 2.7);
  }
}
