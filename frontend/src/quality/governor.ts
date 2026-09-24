/**
 * FPS governor: steps the quality tier DOWN on sustained slow frames and back UP only after a long
 * stretch of good frames (hysteresis), with an exponential back-off so a tier that failed is not
 * retried in a loop. Pure logic with no DOM or timers, so it is unit-tested with synthetic frames.
 *
 * It samples the interval between requestAnimationFrame callbacks, not only rendered frames: when
 * Low renders every other vsync, a steady 60 Hz callback cadence still shows spare headroom.
 * No allocation per sample (fixed-size typed array ring).
 */
import { higherTier, lowerTier, type Tier } from "./tiers";

export interface GovernorOptions {
  /** Length of one averaging bucket. */
  bucketMs: number;
  /** Buckets averaged per decision: bucketMs * buckets = the "sustained" window. */
  buckets: number;
  /** Step down when the windowed mean frame interval exceeds this (default ~48 fps). */
  slowIntervalMs: number;
  /** Frames at or under this interval count as good (default ~55 fps). */
  goodIntervalMs: number;
  /** Continuous good time required before stepping up. */
  upHoldMs: number;
  /** After a change, ignore samples for this long (shader compile, resize, GC settle). */
  settleMs: number;
  /** First block on retrying a tier we fell from; doubles on every repeat, capped. */
  retryBackoffMs: number;
  maxRetryBackoffMs: number;
}

export const DEFAULT_GOVERNOR: GovernorOptions = {
  bucketMs: 500,
  buckets: 4,
  slowIntervalMs: 1000 / 48,
  goodIntervalMs: 1000 / 55,
  upHoldMs: 15_000,
  settleMs: 2_000,
  retryBackoffMs: 30_000,
  maxRetryBackoffMs: 300_000,
};

/** Samples above this are pauses (hidden tab, debugger, sleep), not rendering cost. */
const PAUSE_MS = 1_000;
/** A single stall counts, but is capped so one hitch cannot trip a downgrade by itself. */
const MAX_SAMPLE_MS = 250;

export class FpsGovernor {
  private tier: Tier;
  private enabled = true;
  private readonly means: Float64Array;
  private filled = 0;
  private head = 0;
  private bucketStart = -1;
  private bucketSum = 0;
  private bucketCount = 0;
  private settleUntil: number;
  private goodSince: number | null = null;
  private readonly blockedUntil: Record<Tier, number> = { high: 0, medium: 0, low: 0 };
  private readonly backoff: Record<Tier, number>;
  private ceiling: Tier = "high";

  constructor(
    initial: Tier,
    now: number,
    private readonly opts: GovernorOptions = DEFAULT_GOVERNOR,
  ) {
    this.tier = initial;
    this.means = new Float64Array(opts.buckets);
    this.settleUntil = now + opts.settleMs;
    this.backoff = { high: opts.retryBackoffMs, medium: opts.retryBackoffMs, low: opts.retryBackoffMs };
  }

  /** Highest tier auto mode may step UP to (phones: medium). Never forces a step down. */
  setCeiling(tier: Tier): void {
    this.ceiling = tier;
  }

  get current(): Tier {
    return this.tier;
  }

  /** Auto mode on/off. Off = the user picked a tier; the governor only watches. */
  setEnabled(enabled: boolean, now: number): void {
    this.enabled = enabled;
    this.reset(now);
  }

  /** External tier change (user override or initial detection). */
  setTier(tier: Tier, now: number): void {
    this.tier = tier;
    this.reset(now);
  }

  /** Feed one rAF interval. Returns the new tier when the governor changes it, else null. */
  sample(intervalMs: number, now: number): Tier | null {
    if (intervalMs <= 0 || intervalMs > PAUSE_MS) {
      this.bucketStart = now; // a pause breaks continuity; start a fresh bucket
      this.bucketSum = 0;
      this.bucketCount = 0;
      return null;
    }
    if (now < this.settleUntil) return null;
    if (this.bucketStart < 0) this.bucketStart = now;

    this.bucketSum += Math.min(intervalMs, MAX_SAMPLE_MS);
    this.bucketCount += 1;
    if (now - this.bucketStart < this.opts.bucketMs) return null;

    this.means[this.head] = this.bucketSum / this.bucketCount;
    this.head = (this.head + 1) % this.means.length;
    this.filled = Math.min(this.filled + 1, this.means.length);
    this.bucketStart = now;
    this.bucketSum = 0;
    this.bucketCount = 0;
    return this.enabled ? this.decide(now) : null;
  }

  private decide(now: number): Tier | null {
    if (this.filled < this.means.length) return null;
    let sum = 0;
    for (let i = 0; i < this.means.length; i++) sum += this.means[i] ?? 0;
    const mean = sum / this.means.length;

    if (mean > this.opts.slowIntervalMs) {
      this.goodSince = null;
      const lower = lowerTier(this.tier);
      if (!lower) return null;
      this.blockedUntil[this.tier] = now + this.backoff[this.tier];
      this.backoff[this.tier] = Math.min(this.backoff[this.tier] * 2, this.opts.maxRetryBackoffMs);
      return this.change(lower, now);
    }

    if (mean > this.opts.goodIntervalMs) {
      this.goodSince = null;
      return null;
    }
    const window = this.opts.bucketMs * this.opts.buckets;
    this.goodSince ??= now - window;
    const higher = this.tier === this.ceiling ? null : higherTier(this.tier);
    if (higher && now - this.goodSince >= this.opts.upHoldMs && now >= this.blockedUntil[higher]) {
      return this.change(higher, now);
    }
    return null;
  }

  private change(tier: Tier, now: number): Tier {
    this.tier = tier;
    this.reset(now);
    return tier;
  }

  private reset(now: number): void {
    this.filled = 0;
    this.head = 0;
    this.bucketStart = -1;
    this.bucketSum = 0;
    this.bucketCount = 0;
    this.goodSince = null;
    this.settleUntil = now + this.opts.settleMs;
  }
}
