/**
 * The world as DATA, shared by every render path (Simple, Balanced, Cinematic): layout, per-island
 * eased values, health counts and the aggregate latency that drives fog. Render paths only read it.
 *
 * `sync()` runs when the store holds a new snapshot (1 Hz) and sets targets; `tick()` eases toward
 * them every frame so nothing pops between snapshots. No allocation in tick().
 */
import type { ServiceMetrics, Snapshot } from "../net/protocol";
import { computeLayout, topologyKey, type Placement } from "./layout";

export type Status = ServiceMetrics["status"];
export type Kind = ServiceMetrics["kind"];

const EASE_PER_SECOND = 2.5;

/** Island scale from requests/s: sqrt so a 10x busier service is ~3x wider, clamped. */
export function trafficScale(rps: number): number {
  return Math.min(1.9, Math.max(0.6, 0.45 + Math.sqrt(Math.max(rps, 0)) / 28));
}

/** 0 = healthy latency, 1 = very slow (p95 >= 1.5 s). Drives fog colour and density. */
export function latencyFactor(p95Ms: number): number {
  return Math.min(1, Math.max(0, (p95Ms - 80) / 1420));
}

export interface IslandState {
  readonly id: string;
  readonly kind: Kind;
  readonly place: Placement;
  status: Status;
  /** Eased 0..1 per status, so visuals can cross-fade instead of switching. */
  readonly weight: Record<Status, number>;
  scale: number;
  targetScale: number;
  p95: number;
  targetP95: number;
  rps: number;
  errorRate: number;
}

export interface EdgeState {
  readonly src: string;
  readonly dst: string;
  rps: number;
  targetRps: number;
}

export class WorldModel {
  readonly islands = new Map<string, IslandState>();
  edges: EdgeState[] = [];
  readonly counts: Record<Status, number> = { ok: 0, degraded: 0, failing: 0 };
  readonly bounds = { cx: 0, cz: 0, radius: 10 };
  /** Eased mean latency factor (0..1) across services. */
  latency = 0;
  /** Eased share of failing services (0..1): storm intensity. */
  storm = 0;
  /** Bumped whenever islands/edges are rebuilt, so render paths know to rebuild meshes. */
  topologyVersion = 0;
  lastSeq = -1;

  private key = "";
  private targetLatency = 0;
  private targetStorm = 0;

  sync(snap: Snapshot | null): void {
    if (!snap || snap.seq === this.lastSeq) return;
    this.lastSeq = snap.seq;
    const key = topologyKey(snap.services, snap.edges);
    if (key !== this.key) {
      this.key = key;
      this.rebuild(snap);
    }
    let latencySum = 0;
    this.counts.ok = this.counts.degraded = this.counts.failing = 0;
    for (const svc of snap.services) {
      const isl = this.islands.get(svc.id);
      if (!isl) continue;
      isl.status = svc.status;
      isl.targetScale = trafficScale(svc.rps);
      isl.targetP95 = svc.p95_ms;
      isl.rps = svc.rps;
      isl.errorRate = svc.error_rate;
      this.counts[svc.status] += 1;
      latencySum += latencyFactor(svc.p95_ms);
    }
    const n = Math.max(1, this.islands.size);
    this.targetLatency = latencySum / n;
    this.targetStorm = this.counts.failing / n;
    const byKey = new Map(snap.edges.map((e) => [`${e.src}>${e.dst}`, e.rps]));
    for (const e of this.edges) e.targetRps = byKey.get(`${e.src}>${e.dst}`) ?? 0;
  }

  tick(dtSeconds: number): void {
    const k = 1 - Math.exp(-EASE_PER_SECOND * dtSeconds);
    for (const isl of this.islands.values()) {
      isl.scale += (isl.targetScale - isl.scale) * k;
      isl.p95 += (isl.targetP95 - isl.p95) * k;
      isl.weight.ok += ((isl.status === "ok" ? 1 : 0) - isl.weight.ok) * k;
      isl.weight.degraded += ((isl.status === "degraded" ? 1 : 0) - isl.weight.degraded) * k;
      isl.weight.failing += ((isl.status === "failing" ? 1 : 0) - isl.weight.failing) * k;
    }
    for (const e of this.edges) e.rps += (e.targetRps - e.rps) * k;
    this.latency += (this.targetLatency - this.latency) * k;
    this.storm += (this.targetStorm - this.storm) * k;
  }

  private rebuild(snap: Snapshot): void {
    this.islands.clear();
    const layout = computeLayout(snap.services, snap.edges);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const svc of snap.services) {
      const place = layout.get(svc.id);
      if (!place || this.islands.has(svc.id)) continue;
      const scale = trafficScale(svc.rps);
      this.islands.set(svc.id, {
        id: svc.id,
        kind: svc.kind,
        place,
        status: svc.status,
        weight: {
          ok: svc.status === "ok" ? 1 : 0,
          degraded: svc.status === "degraded" ? 1 : 0,
          failing: svc.status === "failing" ? 1 : 0,
        },
        scale,
        targetScale: scale,
        p95: svc.p95_ms,
        targetP95: svc.p95_ms,
        rps: svc.rps,
        errorRate: svc.error_rate,
      });
      minX = Math.min(minX, place.x);
      maxX = Math.max(maxX, place.x);
      minZ = Math.min(minZ, place.z);
      maxZ = Math.max(maxZ, place.z);
    }
    if (this.islands.size > 0) {
      this.bounds.cx = (minX + maxX) / 2;
      this.bounds.cz = (minZ + maxZ) / 2;
      this.bounds.radius = Math.max(8, Math.hypot(maxX - minX, maxZ - minZ) / 2 + 4);
    }
    this.edges = snap.edges
      .filter((e) => this.islands.has(e.src) && this.islands.has(e.dst) && e.src !== e.dst)
      .map((e) => ({ src: e.src, dst: e.dst, rps: e.rps, targetRps: e.rps }));
    this.topologyVersion += 1;
  }
}
