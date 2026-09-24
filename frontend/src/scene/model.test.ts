import { describe, expect, it } from "vitest";
import type { Snapshot } from "../net/protocol";
import { latencyFactor, WorldModel } from "./model";

function snap(seq: number, p95: number, status: Snapshot["services"][number]["status"] = "ok"): Snapshot {
  return {
    v: 1,
    type: "snapshot",
    seq,
    ts_ms: 0,
    services: [
      { id: "gateway", kind: "gateway", rps: 400, p95_ms: 20, error_rate: 0, status: "ok" },
      { id: "db", kind: "database", rps: 200, p95_ms: p95, error_rate: 0, status },
    ],
    edges: [{ src: "gateway", dst: "db", rps: 150 }],
  };
}

describe("WorldModel", () => {
  it("eases toward new values instead of jumping (nothing pops between 1 Hz snapshots)", () => {
    const m = new WorldModel();
    m.sync(snap(1, 20));
    m.sync(snap(2, 1800, "failing"));
    const db = m.islands.get("db");
    expect(db?.p95).toBe(20);
    m.tick(0.1);
    expect(db?.p95).toBeGreaterThan(20);
    expect(db?.p95).toBeLessThan(1800);
    expect(db?.weight.failing).toBeGreaterThan(0);
    expect(db?.weight.failing).toBeLessThan(1);
    for (let i = 0; i < 100; i++) m.tick(0.1);
    expect(db?.p95).toBeCloseTo(1800, 0);
    expect(db?.weight.failing).toBeCloseTo(1, 3);
    expect(db?.weight.ok).toBeCloseTo(0, 3);
  });

  it("aggregates latency and storm share for fog/weather, and counts statuses", () => {
    const m = new WorldModel();
    m.sync(snap(1, 1800, "failing"));
    for (let i = 0; i < 100; i++) m.tick(0.1);
    expect(m.counts).toEqual({ ok: 1, degraded: 0, failing: 1, offline: 0 });
    expect(m.storm).toBeCloseTo(0.5, 2);
    expect(m.latency).toBeCloseTo((latencyFactor(20) + latencyFactor(1800)) / 2, 2);
  });

  it("an offline island counts as offline and does not thin the mist or dilute the storm", () => {
    const m = new WorldModel();
    m.sync(snap(1, 0, "offline"));
    for (let i = 0; i < 100; i++) m.tick(0.1);
    expect(m.counts).toEqual({ ok: 1, degraded: 0, failing: 0, offline: 1 });
    expect(m.latency).toBeCloseTo(latencyFactor(20), 3);
    expect(m.islands.get("db")?.weight.offline).toBeCloseTo(1, 3);
  });

  it("ignores a repeated seq and only bumps topologyVersion when the graph changes", () => {
    const m = new WorldModel();
    m.sync(snap(1, 20));
    const v = m.topologyVersion;
    m.sync(snap(1, 999));
    expect(m.islands.get("db")?.targetP95).toBe(20);
    m.sync(snap(2, 30));
    expect(m.topologyVersion).toBe(v);
  });

  it("latencyFactor is 0 when healthy and saturates at 1", () => {
    expect(latencyFactor(20)).toBe(0);
    expect(latencyFactor(5000)).toBe(1);
  });
});
