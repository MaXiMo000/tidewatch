/**
 * Initial quality tier from what the browser reports about the device.
 *
 * Deliberately NOT `detect-gpu` (named in the original M1 plan): it fetches benchmark data from a
 * CDN at runtime (a third-party origin, forbidden by CLAUDE.md rule 5) unless its ~1 MB of JSON
 * is self-hosted, and it adds a dependency. A coarse guess is enough because the FPS governor
 * (governor.ts) corrects the tier within seconds on real hardware. Nothing read here leaves the
 * device.
 */
import type { Tier } from "./tiers";

export interface DeviceInfo {
  /** Unmasked renderer string if the browser exposes one (Chrome/Edge/Safari), else "". */
  renderer: string;
  /** navigator.hardwareConcurrency, 0 if unknown. */
  cores: number;
  /** navigator.deviceMemory in GB (Chromium only), 0 if unknown. */
  memoryGb: number;
  /** Coarse pointer and no hover: phones and most tablets. */
  touchPrimary: boolean;
}

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i;
const DISCRETE = /nvidia|geforce|quadro|rtx|radeon (rx|pro)|radeon\(tm\) rx|arc\(tm\) a|apple m\d/i;
const WEAK_MOBILE = /mali-[gt]\d{1,2}\b|adreno \(tm\) [1-5]\d\d\b|powervr|videocore/i;

export function initialTier(info: DeviceInfo): Tier {
  const { renderer, cores, memoryGb, touchPrimary } = info;
  if (SOFTWARE.test(renderer)) return "low";
  const lowSpec = (cores > 0 && cores <= 4) || (memoryGb > 0 && memoryGb <= 4);
  if (touchPrimary) {
    if (lowSpec || WEAK_MOBILE.test(renderer)) return "low";
    return "medium";
  }
  if (DISCRETE.test(renderer) && !lowSpec) return "high";
  return lowSpec ? "low" : "medium";
}

/** Reads DeviceInfo from a live WebGL context. Browser-only; kept out of initialTier for tests. */
export function readDeviceInfo(gl: WebGLRenderingContext | WebGL2RenderingContext): DeviceInfo {
  let renderer = "";
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  if (ext) {
    const value: unknown = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
    if (typeof value === "string") renderer = value;
  }
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    renderer,
    cores: navigator.hardwareConcurrency || 0,
    memoryGb: typeof nav.deviceMemory === "number" ? nav.deviceMemory : 0,
    touchPrimary: window.matchMedia("(pointer: coarse) and (hover: none)").matches,
  };
}
