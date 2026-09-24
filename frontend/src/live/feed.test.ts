import { describe, expect, it } from "vitest";
import type { ServiceMetrics, Snapshot } from "../net/protocol";
import { diffStatuses, statusSentence } from "./feed";

const svc = (id: string, status: ServiceMetrics["status"], kind: ServiceMetrics["kind"] = "service"): ServiceMetrics => ({
  id,
  kind,
  rps: 10,
  p95_ms: status === "ok" ? 40 : 900,
  error_rate: status === "failing" ? 0.08 : 0.001,
  status,
});
const snap = (seq: number, services: ServiceMetrics[]): Snapshot => ({
  v: 1,
  type: "snapshot",
  seq,
  ts_ms: 0,
  services,
  edges: [],
});

describe("diffStatuses", () => {
  it("the first snapshot is a baseline, not a burst of events", () => {
    expect(diffStatuses(null, snap(1, [svc("db", "failing")]), 0)).toEqual([]);
  });

  it("reports worsening, improving, recovery, offline and back online", () => {
    const a = snap(1, [svc("api", "ok"), svc("db", "failing"), svc("cache", "degraded"), svc("queue", "ok"), svc("shop", "offline")]);
    const b = snap(2, [svc("api", "failing"), svc("db", "degraded"), svc("cache", "ok"), svc("queue", "offline"), svc("shop", "ok")]);
    const texts = diffStatuses(a, b, 5).map((e) => `${e.severity}:${e.text}`);
    expect(texts).toEqual([
      "bad:API is failing (8.0% errors, p95 900 ms)",
      "good:Cache recovered",
      "warn:DB improving: degraded (p95 900 ms, 0.10% errors)",
      "info:Queue went offline",
      "good:Shop is back online",
    ]);
  });

  it("no change, no events; topology change is one event", () => {
    const a = snap(1, [svc("api", "ok")]);
    expect(diffStatuses(a, snap(2, [svc("api", "ok")]), 0)).toEqual([]);
    const events = diffStatuses(a, snap(2, [svc("api", "ok"), svc("new", "ok")]), 0);
    expect(events).toHaveLength(1);
    expect(events[0]?.text).toBe("The map changed: 1 new");
  });

  it("never renders markup: names are plain text", () => {
    const a = snap(1, [svc("x-img", "ok")]);
    const b = snap(2, [svc("x-img", "failing")]);
    expect(diffStatuses(a, b, 0)[0]?.text).not.toMatch(/[<>]/);
  });
});

describe("statusSentence", () => {
  it("summarises for screen readers, gateway excluded from the count", () => {
    expect(statusSentence(null)).toBe("Waiting for data.");
    expect(statusSentence(snap(1, [svc("gw", "ok", "gateway"), svc("api", "ok"), svc("db", "ok")]))).toBe(
      "All 2 services healthy.",
    );
    expect(
      statusSentence(snap(1, [svc("gw", "ok", "gateway"), svc("api", "failing"), svc("db", "degraded"), svc("shop", "offline")])),
    ).toBe("3 services; failing: API; degraded: DB; offline: Shop.");
  });
});
