/**
 * Island layout from the service graph. Positions depend only on the SET of service ids and edges,
 * never on array order, so the world does not reshuffle when a source reorders its output.
 *
 * Requests flow along +x: roots (no incoming edges, e.g. the gateway) sit on the left, each hop
 * one column further right (longest path from a root, so a->b->c keeps c right of b even if a->c
 * also exists). Within a column, ids are ordered by the mean row of their parents, then by id,
 * which keeps connected islands near each other. A small deterministic per-id jitter makes it read
 * as an archipelago rather than a grid.
 */

export interface LayoutNode {
  id: string;
}
export interface LayoutEdge {
  src: string;
  dst: string;
}
export interface Placement {
  x: number;
  z: number;
  /** Column index (request hop depth). */
  depth: number;
}

export const COLUMN_SPACING = 7;
export const ROW_SPACING = 6;
const JITTER = 1.1;

/** FNV-1a 32-bit: small, stable, good enough to seed visual jitter from an id. */
export function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic value in [-1, 1) from an id and a salt. */
export function unitNoise(id: string, salt: number): number {
  return (((hashId(id) ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0) % 20_000) / 10_000 - 1;
}

/** Stable key of the topology: equal keys => identical layout. */
export function topologyKey(nodes: readonly LayoutNode[], edges: readonly LayoutEdge[]): string {
  const ids = nodes.map((n) => n.id).sort();
  const es = edges.map((e) => `${e.src}>${e.dst}`).sort();
  return `${ids.join(",")}|${es.join(",")}`;
}

export function computeLayout(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
): Map<string, Placement> {
  const ids = [...new Set(nodes.map((n) => n.id))].sort();
  const known = new Set(ids);
  const parents = new Map<string, string[]>(ids.map((id) => [id, []]));
  const children = new Map<string, string[]>(ids.map((id) => [id, []]));
  const edgeKeys = new Set<string>();
  for (const e of edges) {
    const key = `${e.src}>${e.dst}`;
    if (!known.has(e.src) || !known.has(e.dst) || e.src === e.dst || edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    parents.get(e.dst)?.push(e.src);
    children.get(e.src)?.push(e.dst);
  }
  for (const list of parents.values()) list.sort();
  for (const list of children.values()) list.sort();

  // Break cycles deterministically: DFS from the roots (then any unvisited id) in sorted order and
  // drop edges back to a node still on the stack. The finish order reversed is a topological order
  // of what remains, so longest-path depth is one linear pass. O(V + E); recursion depth <= V,
  // which the wire schema caps at 200.
  const roots = ids.filter((id) => (parents.get(id)?.length ?? 0) === 0);
  const state = new Map<string, 1 | 2>(); // 1 = on stack, 2 = done
  const back = new Set<string>();
  const finished: string[] = [];
  const dfs = (id: string): void => {
    state.set(id, 1);
    for (const c of children.get(id) ?? []) {
      const st = state.get(c);
      if (st === 1) back.add(`${id}>${c}`);
      else if (st === undefined) dfs(c);
    }
    state.set(id, 2);
    finished.push(id);
  };
  for (const id of [...roots, ...ids]) if (!state.has(id)) dfs(id);

  const depth = new Map<string, number>(ids.map((id) => [id, 0]));
  for (let i = finished.length - 1; i >= 0; i--) {
    const id = finished[i] ?? "";
    const d = depth.get(id) ?? 0;
    for (const c of children.get(id) ?? []) {
      if (!back.has(`${id}>${c}`) && (depth.get(c) ?? 0) < d + 1) depth.set(c, d + 1);
    }
  }

  // Columns; order within a column by mean parent row, then id. Process left to right so parent
  // rows are known.
  const columns = new Map<number, string[]>();
  for (const id of ids) {
    const d = depth.get(id) ?? 0;
    const col = columns.get(d);
    if (col) col.push(id);
    else columns.set(d, [id]);
  }
  const row = new Map<string, number>();
  const out = new Map<string, Placement>();
  const sortedDepths = [...columns.keys()].sort((a, b) => a - b);
  const maxDepth = sortedDepths[sortedDepths.length - 1] ?? 0;
  for (const d of sortedDepths) {
    const col = columns.get(d) ?? [];
    const score = (id: string): number => {
      const ps = (parents.get(id) ?? []).filter((p) => row.has(p));
      if (ps.length === 0) return Number.POSITIVE_INFINITY;
      return ps.reduce((s, p) => s + (row.get(p) ?? 0), 0) / ps.length;
    };
    col.sort((a, b) => {
      const sa = score(a);
      const sb = score(b);
      if (sa !== sb) return sa < sb ? -1 : 1;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    col.forEach((id, i) => {
      const r = i - (col.length - 1) / 2;
      row.set(id, r);
      out.set(id, {
        depth: d,
        x: (d - maxDepth / 2) * COLUMN_SPACING + unitNoise(id, 1) * JITTER,
        z: r * ROW_SPACING + unitNoise(id, 2) * JITTER,
      });
    });
  }
  return out;
}
