import { describe, expect, it } from "vitest";
import type { Pose } from "../scene/story";
import { CHANNEL, FreeFly, OPEN_WATER } from "./freefly";

const start: Pose = { eye: { x: 0, y: 6, z: 20 }, target: { x: 0, y: 0, z: 0 } };
const pose = (): Pose => ({ eye: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } });
const dist = (p: Pose): number =>
  Math.hypot(p.eye.x - p.target.x, p.eye.y - p.target.y, p.eye.z - p.target.z);

describe("FreeFly", () => {
  it("engages exactly where the camera already is (no jump)", () => {
    const f = new FreeFly();
    f.engage(start, 10, OPEN_WATER);
    const p = pose();
    f.pose(p);
    expect(p.eye.x).toBeCloseTo(start.eye.x);
    expect(p.eye.y).toBeCloseTo(start.eye.y);
    expect(p.eye.z).toBeCloseTo(start.eye.z);
  });

  it("open water: circles all the way round; pitch and distance stay in range", () => {
    const f = new FreeFly();
    f.engage(start, 10, OPEN_WATER);
    f.turn(Math.PI, 5);
    const p = pose();
    f.pose(p);
    expect(p.eye.z).toBeLessThan(0); // went round to the other side
    expect(Math.asin((p.eye.y - p.target.y) / dist(p))).toBeCloseTo(OPEN_WATER.pitchMax);
    f.zoom(0.001);
    f.pose(p);
    expect(dist(p)).toBeCloseTo(Math.hypot(6, 20) * OPEN_WATER.nearFactor);
    f.zoom(1e6);
    f.pose(p);
    expect(dist(p)).toBeCloseTo(Math.hypot(6, 20) * OPEN_WATER.farFactor);
  });

  it("Cinematic's channel: yaw, pitch and slide are held close to the composed view", () => {
    const f = new FreeFly();
    const low: Pose = { eye: { x: 0, y: 1, z: 20 }, target: { x: 0, y: 0, z: 0 } };
    f.engage(low, 10, CHANNEL);
    f.turn(2, 2);
    f.pan(100, 100);
    const p = pose();
    f.pose(p);
    const yaw = Math.atan2(p.eye.x - p.target.x, p.eye.z - p.target.z);
    expect(Math.abs(yaw)).toBeLessThanOrEqual(CHANNEL.yawRange + 1e-9);
    expect(Math.hypot(p.target.x, p.target.z)).toBeLessThanOrEqual(10 * CHANNEL.panFactor + 1e-9);
  });

  it("held keys move smoothly with time and stop when released", () => {
    const f = new FreeFly();
    f.engage(start, 10, OPEN_WATER);
    const a = pose();
    const b = pose();
    f.pose(a);
    f.setKey("right", true);
    f.tick(0.5);
    f.pose(b);
    expect(Math.hypot(b.eye.x - a.eye.x, b.eye.z - a.eye.z)).toBeGreaterThan(1);
    f.setKey("right", false);
    expect(f.moving).toBe(false);
    f.pose(a);
    f.tick(1);
    f.pose(b);
    expect(b).toEqual(a);
  });

  it("release hands back and forgets held keys", () => {
    const f = new FreeFly();
    f.engage(start, 10, OPEN_WATER);
    f.setKey("in", true);
    f.release();
    expect(f.engaged).toBe(false);
    expect(f.moving).toBe(false);
  });
});
