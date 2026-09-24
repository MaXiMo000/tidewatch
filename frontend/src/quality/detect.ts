/**
 * Start tier from detect-gpu (owner decision, docs/PLAN.md decision log), with its benchmark data
 * served from our own origin (see vite.config.ts) and loaded through `loadBenchmarks`, so the
 * library's unpkg.com default is never used. Falls back to the local heuristic (gpu.ts) if the
 * lookup fails, times out or returns something unexpected.
 */
import { getGPUTier, type TierResult } from "detect-gpu";
import { initialTier, readDeviceInfo } from "./gpu";
import type { Tier } from "./tiers";

const BENCH_FILE = /^[dm]-[a-z-]+\.json$/;
const MAX_BENCH_BYTES = 512 * 1024;
const TIMEOUT_MS = 3_000;

async function loadBenchmarks(file: string): Promise<never[]> {
  if (!BENCH_FILE.test(file)) throw new Error("unexpected benchmark file name");
  const res = await fetch(`/benchmarks/${file}`, { credentials: "omit", cache: "force-cache" });
  if (!res.ok) throw new Error(`benchmarks ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_BENCH_BYTES) throw new Error("benchmark file too large");
  const data: unknown = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error("benchmark file is not an array");
  return data as never[];
}

/** detect-gpu tier (0-3) -> ours. Phones never start on Cinematic; the governor may not raise them either. */
export function mapGpuTier(result: Pick<TierResult, "tier" | "isMobile">): Tier {
  if (result.tier >= 3 && !result.isMobile) return "high";
  if (result.tier >= 2) return "medium";
  return "low";
}

export async function detectStartTier(gl: WebGLRenderingContext | WebGL2RenderingContext): Promise<{
  tier: Tier;
  source: "detect-gpu" | "heuristic";
}> {
  const fallback = { tier: initialTier(readDeviceInfo(gl)), source: "heuristic" as const };
  try {
    const result = await Promise.race([
      getGPUTier({ glContext: gl, override: { loadBenchmarks } }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS)),
    ]);
    if (!result || result.type === "WEBGL_UNSUPPORTED" || result.type === "SSR") return fallback;
    return { tier: mapGpuTier(result), source: "detect-gpu" };
  } catch {
    return fallback;
  }
}
