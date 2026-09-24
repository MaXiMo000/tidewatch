import { describe, expect, it } from "vitest";
import { initialTier, type DeviceInfo } from "./gpu";

const desktop: DeviceInfo = { renderer: "", cores: 8, memoryGb: 8, touchPrimary: false };

describe("initialTier", () => {
  it.each([
    ["ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)", "high"],
    ["ANGLE (AMD, AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0, D3D11)", "high"],
    ["Apple M2", "high"],
    ["ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)", "medium"],
    ["", "medium"],
    ["ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)", "low"],
    ["llvmpipe (LLVM 15.0.7, 256 bits)", "low"],
  ])("desktop renderer %s -> %s", (renderer, tier) => {
    expect(initialTier({ ...desktop, renderer })).toBe(tier);
  });

  it("drops weak desktops to low even with a discrete GPU", () => {
    expect(initialTier({ ...desktop, renderer: "NVIDIA GeForce GT 710", cores: 2 })).toBe("low");
  });

  it("starts phones at medium, weak ones at low, never high", () => {
    const phone = { ...desktop, touchPrimary: true };
    expect(initialTier({ ...phone, renderer: "Adreno (TM) 740" })).toBe("medium");
    expect(initialTier({ ...phone, renderer: "Mali-G52" })).toBe("low");
    expect(initialTier({ ...phone, renderer: "Adreno (TM) 506" })).toBe("low");
    expect(initialTier({ ...phone, renderer: "Apple GPU", memoryGb: 3 })).toBe("low");
    expect(initialTier({ ...phone, renderer: "Apple M2" })).toBe("medium");
  });
});
