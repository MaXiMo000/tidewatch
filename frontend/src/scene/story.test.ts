import { describe, expect, it } from "vitest";
import {
  CHAPTERS,
  chapterIndex,
  liveWeight,
  makePlan,
  planRoute,
  requestAt,
  stillFor,
  storyPose,
  type Pose,
  type RouteEdge,
  type RouteNode,
  type Vec3,
} from "./story";

const DEMO_NODES: RouteNode[] = [
  { id: "gateway", kind: "gateway", x: 0, z: 0 },
  { id: "auth", kind: "service", x: 7, z: -6 },
  { id: "api", kind: "service", x: 7, z: 6 },
  { id: "cache", kind: "cache", x: 14, z: 0 },
  { id: "db", kind: "database", x: 28, z: 6 },
  { id: "queue", kind: "queue", x: 14, z: 12 },
  { id: "worker", kind: "worker", x: 21, z: 12 },
];
const DEMO_EDGES: RouteEdge[] = [
  { src: "gateway", dst: "auth", rps: 252 },
  { src: "gateway", dst: "api", rps: 378 },
  { src: "api", dst: "cache", rps: 760 },
  { src: "api", dst: "db", rps: 190 },
  { src: "api", dst: "queue", rps: 114 },
  { src: "queue", dst: "worker", rps: 120 },
  { src: "worker", dst: "db", rps: 44 },
];

const pose = (): Pose => ({ eye: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } });
const dist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe("chapters", () => {
  it("cover 0..1 in order without gaps, and every still sits inside its chapter", () => {
    expect(CHAPTERS[0]?.start).toBe(0);
    expect(CHAPTERS[CHAPTERS.length - 1]?.end).toBe(1);
    CHAPTERS.forEach((c, i) => {
      if (i > 0) expect(c.start).toBe(CHAPTERS[i - 1]?.end);
      expect(c.still).toBeGreaterThanOrEqual(c.start);
      expect(c.still).toBeLessThanOrEqual(c.end);
      expect(chapterIndex(c.still)).toBe(i);
    });
  });

  it("maps progress to chapters, clamped", () => {
    expect(chapterIndex(-1)).toBe(0);
    expect(chapterIndex(0.12)).toBe(1);
    expect(chapterIndex(0.549)).toBe(2);
    expect(chapterIndex(0.95)).toBe(5);
    expect(chapterIndex(2)).toBe(5);
  });

  it("reduced motion: a whole chapter shows one still (the camera cuts, never glides)", () => {
    expect(stillFor(0.31)).toBe(stillFor(0.54));
    expect(stillFor(0.31)).not.toBe(stillFor(0.56));
  });

  it("the live camera takes over only at the end", () => {
    expect(liveWeight(0)).toBe(0);
    expect(liveWeight(0.8)).toBe(0);
    expect(liveWeight(1)).toBe(1);
  });
});

describe("planRoute", () => {
  it("demo: the longest path from the gateway, ending at the database", () => {
    expect(planRoute(DEMO_NODES, DEMO_EDGES)).toEqual(["gateway", "api", "queue", "worker", "db"]);
  });

  it("live: internet -> app -> its database, preferred over an equally long external API", () => {
    const nodes: RouteNode[] = [
      { id: "internet", kind: "gateway", x: 0, z: 0 },
      { id: "aninest", kind: "service", x: 7, z: 0 },
      { id: "aninest-anime-api", kind: "service", x: 14, z: -3 },
      { id: "aninest-db", kind: "database", x: 14, z: 3 },
      { id: "quiz", kind: "service", x: 7, z: 6 },
    ];
    const edges: RouteEdge[] = [
      { src: "internet", dst: "aninest", rps: 10 },
      { src: "internet", dst: "quiz", rps: 0 },
      { src: "aninest", dst: "aninest-anime-api", rps: 9 },
      { src: "aninest", dst: "aninest-db", rps: 2 },
    ];
    expect(planRoute(nodes, edges)).toEqual(["internet", "aninest", "aninest-db"]);
  });

  it("no gateway: starts at a root; no edges: the single island; nothing: empty", () => {
    const nodes = DEMO_NODES.filter((n) => n.id !== "gateway");
    expect(planRoute(nodes, DEMO_EDGES)[0]).toBe("api");
    expect(planRoute(DEMO_NODES.slice(0, 1), [])).toEqual(["gateway"]);
    expect(planRoute([], [])).toEqual([]);
  });

  it("is order-independent and survives cycles and self-loops", () => {
    const shuffled = [...DEMO_NODES].reverse();
    const edges = [...DEMO_EDGES].reverse().concat([
      { src: "db", dst: "api", rps: 5 },
      { src: "cache", dst: "cache", rps: 1 },
    ]);
    const route = planRoute(shuffled, edges);
    expect(route.length).toBe(5);
    expect(new Set(route).size).toBe(route.length);
    expect(route[0]).toBe("gateway");
  });

  it("stays bounded on a dense graph", () => {
    const nodes: RouteNode[] = Array.from({ length: 60 }, (_, i) => ({
      id: `n${i}`,
      kind: i === 0 ? "gateway" : "service",
      x: i,
      z: 0,
    }));
    const edges: RouteEdge[] = [];
    for (let a = 0; a < 60; a++) for (let b = 0; b < 60; b++) if (a !== b) edges.push({ src: `n${a}`, dst: `n${b}`, rps: 1 });
    const t0 = performance.now();
    expect(planRoute(nodes, edges).length).toBe(5);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

describe("the request and the camera", () => {
  const ids = planRoute(DEMO_NODES, DEMO_EDGES);
  const route = ids.map((id) => DEMO_NODES.find((n) => n.id === id) as RouteNode);
  const plan = makePlan(route, 14, 6, 20);

  it("the request appears in chapter 2, reaches the gateway, hops, and rests on the database", () => {
    const at = { x: 0, y: 0, z: 0 };
    expect(requestAt(0.05, plan, at)).toBe(false);
    expect(requestAt(0.14, plan, at)).toBe(true);
    expect(dist(at, plan.entry)).toBeLessThan(1e-6);
    requestAt(0.3, plan, at);
    expect(dist(at, plan.route[0] as Vec3)).toBeLessThan(1e-6);
    requestAt(0.56, plan, at);
    expect(dist(at, plan.route[4] as Vec3)).toBeLessThan(1e-6);
    expect(requestAt(0.7, plan, at)).toBe(false);
  });

  it("the entry is out on the water, away from every island", () => {
    for (const r of plan.route) expect(dist(plan.entry, r)).toBeGreaterThan(5);
  });

  it("is continuous: scrubbing never jumps the camera", () => {
    const a = pose();
    const b = pose();
    let worst = 0;
    for (let i = 0; i < 1000; i++) {
      storyPose(i / 1000, plan, 3, a);
      storyPose((i + 1) / 1000, plan, 3, b);
      worst = Math.max(worst, dist(a.eye, b.eye), dist(a.target, b.target));
    }
    // 1/1000 of the film never moves the camera more than a small step (radius 20 world).
    expect(worst).toBeLessThan(1.5);
  });

  it("follows the request in chapter 3 and circles the database in chapter 4", () => {
    const cam = pose();
    const at = { x: 0, y: 0, z: 0 };
    storyPose(0.42, plan, 0, cam);
    requestAt(0.42, plan, at);
    expect(dist(cam.target, at)).toBeLessThan(plan.radius * 0.3);
    expect(dist(cam.eye, at)).toBeLessThan(plan.radius * 0.9);
    storyPose(0.68, plan, 0, cam);
    const db = plan.route[4] as Vec3;
    expect(Math.hypot(cam.target.x - db.x, cam.target.z - db.z)).toBeLessThan(1e-6);
  });

  it("the aerial drifts with time, and nothing else does", () => {
    const a = pose();
    const b = pose();
    storyPose(0.02, plan, 0, a);
    storyPose(0.02, plan, 10, b);
    expect(dist(a.eye, b.eye)).toBeGreaterThan(1);
    storyPose(0.42, plan, 0, a);
    storyPose(0.42, plan, 10, b);
    expect(dist(a.eye, b.eye)).toBe(0);
  });

  it("with an anchor (Cinematic) every shot stays inside the anchor's view cone, and still flows", () => {
    const anchor: Pose = { eye: { x: -30, y: 3, z: 30 }, target: { x: 14, y: 1.4, z: 6 } };
    const cplan = makePlan(route, 14, 6, 20, anchor.eye);
    const vx = anchor.target.x - anchor.eye.x;
    const vz = anchor.target.z - anchor.eye.z;
    // Widest angle any island needs from the anchor eye: the clear channel is at least that wide.
    const need = Math.max(
      ...[...route, cplan.entry].map((r) => Math.abs(Math.atan2(vx * (r.z - anchor.eye.z) - vz * (r.x - anchor.eye.x), vx * (r.x - anchor.eye.x) + vz * (r.z - anchor.eye.z)))),
    );
    const a = pose();
    const b = pose();
    let worst = 0;
    for (let i = 0; i <= 1000; i++) {
      storyPose(i / 1000, cplan, 3, a, anchor);
      const ex = a.eye.x - anchor.eye.x;
      const ez = a.eye.z - anchor.eye.z;
      if (Math.hypot(ex, ez) > 0.5) {
        const off = Math.abs(Math.atan2(vx * ez - vz * ex, vx * ex + vz * ez));
        expect(off).toBeLessThanOrEqual(need + 0.12);
      }
      if (i < 1000) {
        storyPose((i + 1) / 1000, cplan, 3, b, anchor);
        worst = Math.max(worst, dist(a.eye, b.eye), dist(a.target, b.target));
      }
    }
    expect(worst).toBeLessThan(1.5);
  });
});
