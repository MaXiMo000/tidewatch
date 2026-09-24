/**
 * The archipelago: one low-poly island per service, placed by layout.ts, sized by traffic and
 * crowned in its status colour; channels (lines) for edges.
 *
 * Data rules (docs/ARCHITECTURE.md s.4): `sync()` runs only when the store holds a NEW snapshot
 * (1 Hz) and sets targets; `tick()` runs every frame and eases toward them without allocating.
 * Geometry is rebuilt only when the topology key changes. Nothing here touches the DOM.
 */
import * as THREE from "three";
import type { ServiceMetrics, Snapshot } from "../net/protocol";
import { glowMaterial } from "./glow";
import { computeLayout, topologyKey, unitNoise } from "./layout";
import { PALETTE } from "./palette";

type Status = ServiceMetrics["status"];

const ISLAND_SEGMENTS = 8;
const EASE_PER_SECOND = 3;

/** Island scale from requests/s: sqrt so a 10x busier service is ~3x wider, clamped. */
export function trafficScale(rps: number): number {
  return Math.min(1.9, Math.max(0.6, 0.45 + Math.sqrt(Math.max(rps, 0)) / 28));
}

interface Island {
  group: THREE.Group;
  crown: THREE.Mesh;
  glow: THREE.Sprite;
  lantern: THREE.Sprite;
  targetScale: number;
  scale: number;
  status: Status;
  phase: number;
}

export class World {
  readonly root = new THREE.Group();
  /** Centre and radius of the current layout, for the camera. */
  readonly bounds = { cx: 0, cz: 0, radius: 10 };

  private readonly islands = new Map<string, Island>();
  private readonly bodyMaterial = new THREE.MeshLambertMaterial({
    color: PALETTE.sand,
    flatShading: true,
  });
  private readonly rockMaterial = new THREE.MeshLambertMaterial({
    color: PALETTE.rock,
    flatShading: true,
  });
  private readonly crownMaterials: Record<Status, THREE.MeshLambertMaterial>;
  private readonly glowMaterials: Record<Status, THREE.SpriteMaterial>;
  private readonly lanternMaterial = glowMaterial(PALETTE.lantern, 0.85);
  private readonly channelMaterial = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  private channels: THREE.LineSegments | null = null;
  private edgeOrder: { src: string; dst: string }[] = [];
  private key = "";
  private lastSeq = -1;
  private glowEnabled = true;
  private reducedMotion = false;
  private readonly tmpColor = new THREE.Color();
  private readonly channelBase = new THREE.Color(PALETTE.channel);

  constructor() {
    const crown = (c: number): THREE.MeshLambertMaterial =>
      new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: 0.35, flatShading: true });
    this.crownMaterials = {
      ok: crown(PALETTE.status.ok),
      degraded: crown(PALETTE.status.degraded),
      failing: crown(PALETTE.status.failing),
    };
    this.glowMaterials = {
      ok: glowMaterial(PALETTE.status.ok, 0.55),
      degraded: glowMaterial(PALETTE.status.degraded, 0.65),
      failing: glowMaterial(PALETTE.status.failing, 0.75),
    };
  }

  setGlow(enabled: boolean): void {
    this.glowEnabled = enabled;
    for (const isl of this.islands.values()) {
      isl.glow.visible = enabled;
      isl.lantern.visible = enabled;
    }
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
  }

  /** Call once per frame with the latest snapshot; cheap no-op unless it is new. */
  sync(snap: Snapshot | null): void {
    if (!snap || snap.seq === this.lastSeq) return;
    this.lastSeq = snap.seq;
    const key = topologyKey(snap.services, snap.edges);
    if (key !== this.key) {
      this.key = key;
      this.rebuild(snap);
    }
    for (const svc of snap.services) {
      const isl = this.islands.get(svc.id);
      if (!isl) continue;
      isl.targetScale = trafficScale(svc.rps);
      if (isl.status !== svc.status) {
        isl.status = svc.status;
        isl.crown.material = this.crownMaterials[svc.status];
        isl.glow.material = this.glowMaterials[svc.status];
      }
    }
    this.counts.ok = this.counts.degraded = this.counts.failing = 0;
    for (const isl of this.islands.values()) this.counts[isl.status] += 1;
    this.recolourChannels(snap);
  }

  tick(dtSeconds: number, seconds: number): void {
    const k = 1 - Math.exp(-EASE_PER_SECOND * dtSeconds);
    for (const isl of this.islands.values()) {
      isl.scale += (isl.targetScale - isl.scale) * k;
      isl.group.scale.setScalar(isl.scale);
      if (this.glowEnabled) {
        const pulse = this.reducedMotion ? 1 : 1 + 0.06 * Math.sin(seconds * 1.3 + isl.phase);
        const s = 4.2 * isl.scale * pulse;
        isl.glow.scale.set(s, s, 1);
      }
    }
  }

  private rebuild(snap: Snapshot): void {
    for (const isl of this.islands.values()) {
      this.root.remove(isl.group);
      isl.group.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
    }
    this.islands.clear();

    const layout = computeLayout(snap.services, snap.edges);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const svc of snap.services) {
      const p = layout.get(svc.id);
      if (!p || this.islands.has(svc.id)) continue;
      const island = this.makeIsland(svc.id, svc.status);
      island.group.position.set(p.x, 0, p.z);
      island.targetScale = island.scale = trafficScale(svc.rps);
      this.root.add(island.group);
      this.islands.set(svc.id, island);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    if (this.islands.size > 0) {
      this.bounds.cx = (minX + maxX) / 2;
      this.bounds.cz = (minZ + maxZ) / 2;
      this.bounds.radius = Math.max(8, Math.hypot(maxX - minX, maxZ - minZ) / 2 + 4);
    }
    this.rebuildChannels(snap, layout);
  }

  private makeIsland(id: string, status: Status): Island {
    const group = new THREE.Group();
    group.name = id;

    const body = new THREE.Mesh(jaggedCylinder(id, 1.0, 1.35, 0.9, 11), this.bodyMaterial);
    body.position.y = 0.2;
    const rock = new THREE.Mesh(jaggedCylinder(id, 0.18, 0.42, 0.55, 23), this.rockMaterial);
    rock.position.set(unitNoise(id, 31) * 0.3, 1.05, unitNoise(id, 37) * 0.3);
    const crown = new THREE.Mesh(jaggedCylinder(id, 0.72, 0.95, 0.22, 41), this.crownMaterials[status]);
    crown.position.y = 0.72;

    const glow = new THREE.Sprite(this.glowMaterials[status]);
    glow.position.y = 1.6;
    glow.visible = this.glowEnabled;
    const lantern = new THREE.Sprite(this.lanternMaterial);
    const a = unitNoise(id, 53) * Math.PI;
    lantern.position.set(Math.cos(a) * 1.05, 0.95, Math.sin(a) * 1.05);
    lantern.scale.set(0.7, 0.7, 1);
    lantern.visible = this.glowEnabled;

    group.add(body, rock, crown, glow, lantern);
    return {
      group,
      crown,
      glow,
      lantern,
      targetScale: 1,
      scale: 1,
      status,
      phase: unitNoise(id, 61) * Math.PI,
    };
  }

  private rebuildChannels(snap: Snapshot, layout: ReturnType<typeof computeLayout>): void {
    if (this.channels) {
      this.root.remove(this.channels);
      this.channels.geometry.dispose();
      this.channels = null;
    }
    this.edgeOrder = snap.edges
      .filter((e) => layout.has(e.src) && layout.has(e.dst) && e.src !== e.dst)
      .map((e) => ({ src: e.src, dst: e.dst }));
    if (this.edgeOrder.length === 0) return;
    const positions = new Float32Array(this.edgeOrder.length * 6);
    this.edgeOrder.forEach((e, i) => {
      const a = layout.get(e.src);
      const b = layout.get(e.dst);
      if (!a || !b) return;
      positions.set([a.x, 0.06, a.z, b.x, 0.06, b.z], i * 6);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute(
      "color",
      new THREE.BufferAttribute(new Float32Array(this.edgeOrder.length * 6), 3),
    );
    this.channels = new THREE.LineSegments(geometry, this.channelMaterial);
    this.root.add(this.channels);
  }

  /** Brighter channel = more traffic. Writes into the existing colour buffer. */
  private recolourChannels(snap: Snapshot): void {
    const attr = this.channels?.geometry.getAttribute("color");
    if (!(attr instanceof THREE.BufferAttribute)) return;
    let max = 1;
    for (const e of snap.edges) max = Math.max(max, e.rps);
    const byKey = new Map<string, number>();
    for (const e of snap.edges) byKey.set(`${e.src}>${e.dst}`, e.rps);
    this.edgeOrder.forEach((e, i) => {
      const rps = byKey.get(`${e.src}>${e.dst}`) ?? 0;
      this.tmpColor.copy(this.channelBase).multiplyScalar(0.25 + 0.75 * Math.sqrt(rps / max));
      attr.setXYZ(i * 2, this.tmpColor.r, this.tmpColor.g, this.tmpColor.b);
      attr.setXYZ(i * 2 + 1, this.tmpColor.r, this.tmpColor.g, this.tmpColor.b);
    });
    attr.needsUpdate = true;
  }

  get islandCount(): number {
    return this.islands.size;
  }

  /** Islands per status for the HUD's text summary (never colour alone). Updated in sync(). */
  readonly counts: Record<Status, number> = { ok: 0, degraded: 0, failing: 0 };
}

/** Low-poly island piece: a cylinder with deterministic per-id radial jitter, flat shaded. */
function jaggedCylinder(
  id: string,
  top: number,
  bottom: number,
  height: number,
  salt: number,
): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(top, bottom, height, ISLAND_SEGMENTS, 1);
  const pos = g.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 1e-4) continue; // cap centres
    // % folds the seam (angle 0 and 2*pi) onto one index so the jittered ring stays closed.
    const angleIndex =
      Math.round(((Math.atan2(z, x) + Math.PI) / (2 * Math.PI)) * ISLAND_SEGMENTS) % ISLAND_SEGMENTS;
    const f = 1 + unitNoise(id, salt + angleIndex) * 0.18;
    pos.setX(i, x * f);
    pos.setZ(i, z * f);
  }
  const flat = g.toNonIndexed();
  g.dispose();
  flat.computeVertexNormals();
  return flat;
}
