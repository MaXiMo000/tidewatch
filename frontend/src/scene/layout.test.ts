import { describe, expect, it } from "vitest";
import { computeLayout, topologyKey, type LayoutEdge, type LayoutNode } from "./layout";

const nodes: LayoutNode[] = ["gateway", "auth", "api", "cache", "db", "queue", "worker"].map(
  (id) => ({ id }),
);
const edges: LayoutEdge[] = [
  { src: "gateway", dst: "auth" },
  { src: "gateway", dst: "api" },
  { src: "api", dst: "cache" },
  { src: "api", dst: "db" },
  { src: "api", dst: "queue" },
  { src: "queue", dst: "worker" },
  { src: "worker", dst: "db" },
];

function shuffled<T>(xs: readonly T[], seed: number): T[] {
  const out = [...xs];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

describe("computeLayout", () => {
  it("is independent of input order", () => {
    const base = [...computeLayout(nodes, edges).entries()].sort();
    for (let seed = 1; seed <= 20; seed++) {
      const other = computeLayout(shuffled(nodes, seed), shuffled(edges, seed * 7));
      expect([...other.entries()].sort()).toEqual(base);
    }
  });

  it("places requests left to right by longest path", () => {
    const l = computeLayout(nodes, edges);
    const depth = (id: string): number => l.get(id)?.depth ?? -1;
    expect(depth("gateway")).toBe(0);
    expect(depth("api")).toBe(1);
    expect(depth("queue")).toBe(2);
    expect(depth("worker")).toBe(3);
    // db is 2 hops via api->db and 4 via api->queue->worker->db: the longest path wins.
    expect(depth("db")).toBe(4);
    expect(l.get("gateway")?.x ?? 0).toBeLessThan(l.get("db")?.x ?? 0);
  });

  it("keeps islands apart", () => {
    const pts = [...computeLayout(nodes, edges).values()];
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i];
        const b = pts[j];
        if (!a || !b) continue;
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(3);
      }
    }
  });

  it("survives cycles, self-loops, duplicates and unknown ids", () => {
    const l = computeLayout(
      [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "a" }],
      [
        { src: "a", dst: "b" },
        { src: "b", dst: "c" },
        { src: "c", dst: "a" },
        { src: "b", dst: "b" },
        { src: "a", dst: "b" },
        { src: "ghost", dst: "a" },
      ],
    );
    expect(l.size).toBe(3);
    for (const p of l.values()) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.z)).toBe(true);
      expect(p.depth).toBeLessThanOrEqual(2);
    }
  });

  it("handles an isolated node and an empty graph", () => {
    expect(computeLayout([], []).size).toBe(0);
    expect(computeLayout([{ id: "solo" }], []).get("solo")?.depth).toBe(0);
  });

  it("stays fast on a dense 200-node DAG", () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ id: `s${i}` }));
    const dense: LayoutEdge[] = [];
    for (let i = 0; i < 200; i++) {
      for (let j = i + 1; j < Math.min(200, i + 6); j++) dense.push({ src: `s${i}`, dst: `s${j}` });
    }
    const t0 = performance.now();
    const l = computeLayout(many, dense);
    expect(performance.now() - t0).toBeLessThan(200);
    expect(l.get("s199")?.depth).toBe(199);
  });
});

describe("topologyKey", () => {
  it("ignores order and changes with topology", () => {
    expect(topologyKey(shuffled(nodes, 3), shuffled(edges, 5))).toBe(topologyKey(nodes, edges));
    expect(topologyKey(nodes, edges.slice(1))).not.toBe(topologyKey(nodes, edges));
  });
});
