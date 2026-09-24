import { describe, expect, it } from "vitest";
import { mapGpuTier } from "./detect";

describe("mapGpuTier", () => {
  it("maps detect-gpu tiers 0-3 onto Simple/Balanced/Cinematic", () => {
    expect(mapGpuTier({ tier: 3, isMobile: false })).toBe("high");
    expect(mapGpuTier({ tier: 2, isMobile: false })).toBe("medium");
    expect(mapGpuTier({ tier: 1, isMobile: false })).toBe("low");
    expect(mapGpuTier({ tier: 0, isMobile: false })).toBe("low");
  });

  it("never starts a phone on Cinematic", () => {
    expect(mapGpuTier({ tier: 3, isMobile: true })).toBe("medium");
  });
});
