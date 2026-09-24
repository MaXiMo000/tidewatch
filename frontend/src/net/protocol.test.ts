import { describe, expect, it } from "vitest";
import { InfoSchema, SnapshotSchema } from "./protocol";

const service = { id: "api", kind: "service", rps: 1, p95_ms: 1, error_rate: 0.1, status: "ok" };
const snapshot = { v: 1, type: "snapshot", seq: 0, ts_ms: 0, services: [service], edges: [] };

describe("SnapshotSchema", () => {
  it("accepts a valid snapshot", () => {
    expect(SnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it("rejects unknown fields (no smuggled data)", () => {
    expect(SnapshotSchema.safeParse({ ...snapshot, extra: "x" }).success).toBe(false);
    expect(
      SnapshotSchema.safeParse({ ...snapshot, services: [{ ...service, label: "leak" }] }).success,
    ).toBe(false);
  });

  it("rejects out-of-range values and unsafe ids", () => {
    expect(
      SnapshotSchema.safeParse({ ...snapshot, services: [{ ...service, error_rate: 2 }] }).success,
    ).toBe(false);
    expect(
      SnapshotSchema.safeParse({ ...snapshot, services: [{ ...service, id: "<img src=x>" }] })
        .success,
    ).toBe(false);
  });
});

describe("offline status and InfoSchema (mirror backend/app/schemas.py)", () => {
  it("accepts an offline service", () => {
    const offline = { ...service, rps: 0, p95_ms: 0, error_rate: 0, status: "offline" };
    expect(SnapshotSchema.safeParse({ ...snapshot, services: [offline] }).success).toBe(true);
    expect(
      SnapshotSchema.safeParse({ ...snapshot, services: [{ ...service, status: "down" }] }).success,
    ).toBe(false);
  });

  it("accepts demo and live info, rejects markup in names and extra fields", () => {
    expect(InfoSchema.safeParse({ mode: "demo", sources: [] }).success).toBe(true);
    const live = { mode: "live", sources: [{ id: "quiz", name: "Quiz-App" }] };
    expect(InfoSchema.safeParse(live).success).toBe(true);
    const bad = (name: string) => ({ mode: "live", sources: [{ id: "quiz", name }] });
    expect(InfoSchema.safeParse(bad("<b>x</b>")).success).toBe(false);
    expect(InfoSchema.safeParse(bad("x".repeat(33))).success).toBe(false);
    expect(InfoSchema.safeParse({ ...live, url: "https://x" }).success).toBe(false);
    expect(InfoSchema.safeParse({ mode: "prod", sources: [] }).success).toBe(false);
  });
});
