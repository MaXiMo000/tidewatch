/**
 * Quality tiers (docs/ARCHITECTURE.md section 5). Everything tier-dependent reads from here so a
 * tier change is one lookup, never scattered `if (tier === ...)` checks.
 */

export type Tier = "high" | "medium" | "low";

export const TIERS: readonly Tier[] = ["high", "medium", "low"];

export interface TierSettings {
  /** Upper bound for renderer.setPixelRatio - the single biggest win on weak GPUs. */
  readonly pixelRatioCap: number;
  /** Frames per second the loop renders at most (Low renders every other vsync). */
  readonly maxFps: number;
  /** Water: animated normals + sun glint (High/Medium) or flat gradient + Fresnel (Low). */
  readonly waterDetail: boolean;
  /** Number of layered cloud/fog bands in the sky (M3 weather reuses this). */
  readonly skyBands: number;
  /** Additive glow sprites over islands. */
  readonly glowSprites: boolean;
  /** Request particles (M3). Kept here so the whole budget lives in one table. */
  readonly particles: number;
  /** Antialiasing is requested at context creation; changing it needs a new context. */
  readonly antialias: boolean;
}

export const TIER_SETTINGS: Readonly<Record<Tier, TierSettings>> = {
  high: {
    pixelRatioCap: 2,
    maxFps: 60,
    waterDetail: true,
    skyBands: 3,
    glowSprites: true,
    particles: 2000,
    antialias: true,
  },
  medium: {
    pixelRatioCap: 1.5,
    maxFps: 60,
    waterDetail: true,
    skyBands: 1,
    glowSprites: true,
    particles: 800,
    antialias: false,
  },
  low: {
    pixelRatioCap: 1,
    maxFps: 30,
    waterDetail: false,
    skyBands: 1,
    glowSprites: false,
    particles: 250,
    antialias: false,
  },
};

export function isTier(value: unknown): value is Tier {
  return value === "high" || value === "medium" || value === "low";
}

export function lowerTier(tier: Tier): Tier | null {
  return tier === "high" ? "medium" : tier === "medium" ? "low" : null;
}

export function higherTier(tier: Tier): Tier | null {
  return tier === "low" ? "medium" : tier === "medium" ? "high" : null;
}
