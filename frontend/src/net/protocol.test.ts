import { describe, expect, it } from "vitest";
import { SnapshotSchema } from "./protocol";

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
