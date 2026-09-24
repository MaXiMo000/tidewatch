/**
 * The data -> weather rules, as pure functions (unit-tested), shared by the render paths:
 *   latency  -> fog density/colour and mist over the slow island
 *   failing  -> storm clouds, lightning, a camera shake when a service starts failing
 *   errors   -> boats that sink on their way into the erroring island
 * Everything here reads EASED model values, so weather builds and clears instead of popping.
 * Photosensitivity: lightning never more often than once per 2.5 s (limit: 3 flashes/s), and no
 * lightning or shake at all under prefers-reduced-motion.
 */

/** Fog density multiplier: 1 when healthy, up to ~3.4x when everything is slow and failing. */
export function fogDensityScale(latency: number, storm: number): number {
  return 1 + 1.6 * clamp01(latency) + 0.8 * clamp01(storm);
}

/** Mist opacity over one island from its eased p95 (0 below 120 ms, full at 900 ms). */
export function mistAmount(p95Ms: number): number {
  return clamp01((p95Ms - 120) / 780);
}

/** Share of the boats heading into an island that sink this lap, from its error rate. */
export function sinkShare(errorRate: number): number {
  // 1% errors -> 4% of boats, 5% -> 20%, capped so traffic never visually stops.
  return Math.min(0.6, Math.max(0, errorRate) * 4);
}

export const MIN_FLASH_GAP_S = 2.5;

/**
 * Lightning timing while a storm is on: a flash every 3-9 s, never within 2.5 s of the last one,
 * none under reduced motion, none without a storm. `rnd` is injectable for tests.
 */
export class LightningClock {
  /** 0..1 current flash intensity (decays over ~0.35 s). */
  flash = 0;
  private next = 4;
  private last = -Infinity;

  constructor(private readonly rnd: () => number = Math.random) {}

  tick(seconds: number, storm: number, reducedMotion: boolean): number {
    if (reducedMotion || storm < 0.05) {
      this.flash = 0;
      if (seconds > this.next) this.next = seconds + 3; // do not strike the instant a storm starts
      return 0;
    }
    if (seconds >= this.next && seconds - this.last >= MIN_FLASH_GAP_S) {
      this.last = seconds;
      this.next = seconds + 3 + this.rnd() * 6 * (1.2 - Math.min(1, storm));
    }
    const since = seconds - this.last;
    // A double flicker, like real lightning, inside 0.35 s.
    this.flash = since < 0.35 ? Math.min(1, storm * 1.5) * (since < 0.08 || (since > 0.16 && since < 0.24) ? 1 : 0.35) : 0;
    return this.flash;
  }
}

/** A short, decaying camera shake when a service newly fails. Off under reduced motion. */
export class Shake {
  private energy = 0;
  private last = -Infinity;

  /** Kick it (at most once per 2.5 s, so a flapping service cannot make the view judder). */
  kick(seconds: number, strength: number, reducedMotion: boolean): void {
    if (reducedMotion || seconds - this.last < MIN_FLASH_GAP_S) return;
    this.last = seconds;
    this.energy = Math.min(1, this.energy + strength);
  }

  /** Offset for this frame (world units), written into `out`. */
  offset(seconds: number, dt: number, out: { x: number; y: number; z: number }): void {
    this.energy *= Math.exp(-4 * dt);
    if (this.energy < 1e-3) {
      this.energy = 0;
      out.x = out.y = out.z = 0;
      return;
    }
    const a = this.energy * 0.3;
    out.x = a * Math.sin(seconds * 43.0);
    out.y = a * 0.6 * Math.sin(seconds * 37.0 + 1.3);
    out.z = a * Math.sin(seconds * 31.0 + 2.1);
  }

  get active(): boolean {
    return this.energy > 0;
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
