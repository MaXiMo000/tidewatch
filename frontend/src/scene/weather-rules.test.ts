import { describe, expect, it } from "vitest";
import {
  fogDensityScale,
  LightningClock,
  MIN_FLASH_GAP_S,
  mistAmount,
  Shake,
  sinkShare,
} from "./weather-rules";

describe("weather rules", () => {
  it("fog thickens with latency and storm, and is unchanged when healthy", () => {
    expect(fogDensityScale(0, 0)).toBe(1);
    expect(fogDensityScale(1, 0)).toBeGreaterThan(fogDensityScale(0.5, 0));
    expect(fogDensityScale(1, 1)).toBeGreaterThan(fogDensityScale(1, 0));
    expect(fogDensityScale(5, 5)).toBe(fogDensityScale(1, 1)); // clamped
  });

  it("mist only over slow islands", () => {
    expect(mistAmount(20)).toBe(0);
    expect(mistAmount(120)).toBe(0);
    expect(mistAmount(500)).toBeGreaterThan(0.4);
    expect(mistAmount(5000)).toBe(1);
  });

  it("boats sink in proportion to errors, never all of them", () => {
    expect(sinkShare(0)).toBe(0);
    expect(sinkShare(0.05)).toBeCloseTo(0.2);
    expect(sinkShare(1)).toBe(0.6);
    expect(sinkShare(-1)).toBe(0);
  });
});

describe("LightningClock", () => {
  const seq = (values: number[]) => {
    let i = 0;
    return () => values[i++ % values.length] ?? 0;
  };

  it("never flashes more often than once per 2.5 s, even in the worst storm", () => {
    const clock = new LightningClock(seq([0]));
    const starts: number[] = [];
    let prev = 0;
    for (let t = 0; t < 120; t += 1 / 60) {
      const f = clock.tick(t, 1, false);
      if (f === 1 && prev < 1 && (starts.length === 0 || t - (starts[starts.length - 1] ?? 0) > 0.3)) starts.push(t);
      prev = f;
    }
    expect(starts.length).toBeGreaterThan(5);
    for (let i = 1; i < starts.length; i++) {
      expect((starts[i] ?? 0) - (starts[i - 1] ?? 0)).toBeGreaterThanOrEqual(MIN_FLASH_GAP_S);
    }
  });

  it("stays dark without a storm and under reduced motion", () => {
    for (const [storm, reduced] of [[0, false], [1, true]] as const) {
      const clock = new LightningClock(seq([0]));
      let max = 0;
      for (let t = 0; t < 60; t += 1 / 30) max = Math.max(max, clock.tick(t, storm, reduced));
      expect(max).toBe(0);
    }
  });
});

describe("Shake", () => {
  it("kicks, decays to rest, and is rate-limited and off under reduced motion", () => {
    const s = new Shake();
    const out = { x: 0, y: 0, z: 0 };
    s.kick(10, 1, false);
    s.offset(10.01, 0.016, out);
    expect(Math.hypot(out.x, out.y, out.z)).toBeGreaterThan(0);
    for (let i = 0; i < 200; i++) s.offset(10 + i / 60, 1 / 60, out);
    expect(Math.hypot(out.x, out.y, out.z)).toBe(0);
    expect(s.active).toBe(false);

    s.kick(11, 1, false); // within 2.5 s of the last kick: ignored
    s.offset(11.01, 0.016, out);
    expect(s.active).toBe(false);

    const calm = new Shake();
    calm.kick(20, 1, true);
    calm.offset(20.01, 0.016, out);
    expect(calm.active).toBe(false);
  });
});
