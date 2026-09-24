import { describe, expect, it } from "vitest";
import { FpsGovernor } from "./governor";
import type { Tier } from "./tiers";

/** Feeds `ms` of frames at `fps` starting at `t`; returns the end time and every change. */
function run(
  g: FpsGovernor,
  fps: number,
  ms: number,
  t: number,
  stopOnChange = false,
): { t: number; changes: Tier[] } {
  const dt = 1000 / fps;
  const changes: Tier[] = [];
  const end = t + ms;
  let now = t;
  while (now < end) {
    now += dt;
    const c = g.sample(dt, now);
    if (c) {
      changes.push(c);
      if (stopOnChange) break;
    }
  }
  return { t: now, changes };
}

/** A slow patch that ends as soon as the governor reacts (the new tier then runs fine). */
function slowPatch(g: FpsGovernor, t: number): { t: number; changes: Tier[] } {
  return run(g, 30, 10_000, t, true);
}

describe("FpsGovernor", () => {
  it("holds a tier that meets its target", () => {
    const g = new FpsGovernor("high", 0);
    expect(run(g, 60, 60_000, 0).changes).toEqual([]);
    expect(g.current).toBe("high");
  });

  it("steps down after sustained slow frames, one tier at a time", () => {
    const g = new FpsGovernor("high", 0);
    const warm = run(g, 60, 3_000, 0);
    const first = run(g, 30, 3_000, warm.t);
    expect(first.changes).toEqual(["medium"]); // ~2 s window after the settle period
    const second = run(g, 30, 5_000, first.t);
    expect(second.changes).toEqual(["low"]);
    expect(run(g, 20, 10_000, second.t).changes).toEqual([]);
    expect(g.current).toBe("low");
  });

  it("ignores a short hitch and pauses such as a hidden tab", () => {
    const g = new FpsGovernor("high", 0);
    let t = run(g, 60, 3_000, 0).t;
    t += 240;
    expect(g.sample(240, t)).toBeNull(); // one GC-sized hitch
    t += 8_000;
    expect(g.sample(8_000, t)).toBeNull(); // tab hidden for 8 s
    expect(run(g, 60, 10_000, t).changes).toEqual([]);
  });

  it("steps back up only after a long good stretch (hysteresis)", () => {
    const g = new FpsGovernor("medium", 0);
    const early = run(g, 60, 10_000, 0);
    expect(early.changes).toEqual([]); // not before upHoldMs (15 s)
    expect(run(g, 60, 10_000, early.t).changes).toEqual(["high"]);
  });

  it("does not flap: a tier it fell from is blocked with growing back-off", () => {
    const g = new FpsGovernor("high", 0);
    let r = run(g, 60, 3_000, 0);
    r = slowPatch(g, r.t);
    expect(r.changes).toEqual(["medium"]);
    const firstDrop = r.t;
    r = run(g, 60, 25_000, r.t); // good, but high is blocked for 30 s after the drop
    expect(r.changes).toEqual([]);
    r = run(g, 60, 20_000, r.t, true); // block expired
    expect(r.changes).toEqual(["high"]);
    expect(r.t - firstDrop).toBeGreaterThanOrEqual(30_000);
    r = run(g, 60, 3_000, r.t);
    r = slowPatch(g, r.t); // fails again: back-off doubles to 60 s
    expect(r.changes).toEqual(["medium"]);
    expect(run(g, 60, 55_000, r.t).changes).toEqual([]);
    expect(run(g, 60, 10_000, r.t + 55_000).changes).toEqual(["high"]);
  });

  it("never goes below low or above high", () => {
    expect(run(new FpsGovernor("low", 0), 10, 20_000, 0).changes).toEqual([]);
    expect(run(new FpsGovernor("high", 0), 144, 60_000, 0).changes).toEqual([]);
  });

  it("only watches while disabled (the user picked a tier)", () => {
    const g = new FpsGovernor("high", 0);
    g.setEnabled(false, 0);
    expect(run(g, 20, 20_000, 0).changes).toEqual([]);
    expect(g.current).toBe("high");
  });
});
