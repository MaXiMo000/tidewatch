import { describe, expect, it } from "vitest";
import type { Snapshot } from "../net/protocol";
import { rowsFor, StruggleDetector } from "./fallback2d";
import { photoName } from "./photo";

describe("photo", () => {
  it("names files by local date and time", () => {
    expect(photoName(new Date(2026, 8, 4, 7, 5, 3))).toBe("tidewatch-2026-09-04-070503.png");
  });
});

describe("2D view rows", () => {
  it("worst first, then by name; status as a word; offline shows no numbers", () => {
    const snap: Snapshot = {
      v: 1,
      type: "snapshot",
      seq: 1,
      ts_ms: 0,
      edges: [],
      services: [
        { id: "cache", kind: "cache", rps: 900, p95_ms: 2, error_rate: 0, status: "ok" },
        { id: "shop", kind: "service", rps: 0, p95_ms: 0, error_rate: 0, status: "offline" },
        { id: "db", kind: "database", rps: 220, p95_ms: 1800, error_rate: 0.08, status: "failing" },
        { id: "api", kind: "service", rps: 380, p95_ms: 600, error_rate: 0.02, status: "degraded" },
      ],
    };
    expect(rowsFor(snap).map((r) => r.cells)).toEqual([
      ["DB", "database", "failing", "220 req/s", "1.80 s", "8.0%"],
      ["API", "service", "degraded", "380 req/s", "600 ms", "2.0%"],
      ["Shop", "service", "offline", "–", "–", "–"],
      ["Cache", "cache", "healthy", "900 req/s", "2 ms", "0.00%"],
    ]);
  });
});


describe("StruggleDetector", () => {
  const run = (d: StruggleDetector, interval: number, seconds: number, lightest = true): boolean[] => {
    const out: boolean[] = [];
    for (let t = 0; t < seconds * 1000; t += interval) out.push(d.sample(interval, t, lightest));
    return out;
  };

  it("suggests the 2D view once after 10 s under 12 fps on the lightest tier", () => {
    const d = new StruggleDetector();
    const fired = run(d, 125, 25); // 8 fps
    expect(fired.filter(Boolean)).toHaveLength(1);
  });

  it("stays quiet at a playable frame rate, or while a heavier tier is still in use", () => {
    expect(run(new StruggleDetector(), 50, 30).some(Boolean)).toBe(false); // 20 fps
    expect(run(new StruggleDetector(), 125, 30, false).some(Boolean)).toBe(false);
  });
});
