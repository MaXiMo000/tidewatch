/**
 * Stylised (Balanced/Simple) archipelago: one low-poly island per service, placed and eased by the
 * shared WorldModel, crowned in its status colour; channels (lines) for edges.
 *
 * Meshes are rebuilt only when model.topologyVersion changes; update() runs every frame and only
 * copies eased model values into transforms/colours (no allocation).
 */
import * as THREE from "three";
import { glowMaterial } from "./glow";
import { unitNoise } from "./layout";
import type { IslandState, Status, WorldModel } from "./model";
import { PALETTE } from "./palette";

const ISLAND_SEGMENTS = 8;

interface Island {
  state: IslandState;
  group: THREE.Group;
  crown: THREE.Mesh;
  glow: THREE.Sprite;
  lantern: THREE.Sprite;
  shownStatus: Status;
  phase: number;
}

export class World {
  readonly root = new THREE.Group();

  private readonly islands: Island[] = [];
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
  private builtVersion = -1;
  private glowEnabled = true;
  private reducedMotion = false;
  private readonly tmpColor = new THREE.Color();
  private readonly channelBase = new THREE.Color(PALETTE.channel);

  constructor(private readonly model: WorldModel) {
    const crown = (c: number): THREE.MeshLambertMaterial =>
      new THREE.MeshLambertMaterial({
        color: c,
        emissive: c,
        emissiveIntensity: 0.35,
        flatShading: true,
      });
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
    for (const isl of this.islands) {
      isl.glow.visible = enabled;
      isl.lantern.visible = enabled;
    }
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
  }

  update(seconds: number): void {
    if (this.model.topologyVersion !== this.builtVersion) this.rebuild();
    for (const isl of this.islands) {
      const s = isl.state;
      isl.group.scale.setScalar(s.scale);
      if (isl.shownStatus !== s.status) {
        isl.shownStatus = s.status;
        isl.crown.material = this.crownMaterials[s.status];
        isl.glow.material = this.glowMaterials[s.status];
      }
      if (this.glowEnabled) {
        const pulse = this.reducedMotion ? 1 : 1 + 0.06 * Math.sin(seconds * 1.3 + isl.phase);
        const g = 4.2 * s.scale * pulse;
        isl.glow.scale.set(g, g, 1);
      }
    }
    this.recolourChannels();
  }

  dispose(): void {
    this.clear();
    this.channelMaterial.dispose();
  }

  private clear(): void {
    for (const isl of this.islands) {
      this.root.remove(isl.group);
      isl.group.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
    }
    this.islands.length = 0;
    if (this.channels) {
      this.root.remove(this.channels);
      this.channels.geometry.dispose();
      this.channels = null;
    }
  }

  private rebuild(): void {
    this.clear();
    this.builtVersion = this.model.topologyVersion;
    for (const state of this.model.islands.values()) {
      const isl = this.makeIsland(state);
      isl.group.position.set(state.place.x, 0, state.place.z);
      this.root.add(isl.group);
      this.islands.push(isl);
    }
    const edges = this.model.edges;
    if (edges.length === 0) return;
    const positions = new Float32Array(edges.length * 6);
    edges.forEach((e, i) => {
      const a = this.model.islands.get(e.src)?.place;
      const b = this.model.islands.get(e.dst)?.place;
      if (a && b) positions.set([a.x, 0.06, a.z, b.x, 0.06, b.z], i * 6);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(edges.length * 6), 3));
    this.channels = new THREE.LineSegments(geometry, this.channelMaterial);
    this.root.add(this.channels);
  }

  private makeIsland(state: IslandState): Island {
    const id = state.id;
    const group = new THREE.Group();
    group.name = id;
    const body = new THREE.Mesh(jaggedCylinder(id, 1.0, 1.35, 0.9, 11), this.bodyMaterial);
    body.position.y = 0.2;
    const rock = new THREE.Mesh(jaggedCylinder(id, 0.18, 0.42, 0.55, 23), this.rockMaterial);
    rock.position.set(unitNoise(id, 31) * 0.3, 1.05, unitNoise(id, 37) * 0.3);
    const crown = new THREE.Mesh(
      jaggedCylinder(id, 0.72, 0.95, 0.22, 41),
      this.crownMaterials[state.status],
    );
    crown.position.y = 0.72;
    const glow = new THREE.Sprite(this.glowMaterials[state.status]);
    glow.position.y = 1.6;
    glow.visible = this.glowEnabled;
    const lantern = new THREE.Sprite(this.lanternMaterial);
    const a = unitNoise(id, 53) * Math.PI;
    lantern.position.set(Math.cos(a) * 1.05, 0.95, Math.sin(a) * 1.05);
    lantern.scale.set(0.7, 0.7, 1);
    lantern.visible = this.glowEnabled;
    group.add(body, rock, crown, glow, lantern);
    return {
      state,
      group,
      crown,
      glow,
      lantern,
      shownStatus: state.status,
      phase: unitNoise(id, 61) * Math.PI,
    };
  }

  /** Brighter channel = more traffic. Writes into the existing colour buffer. */
  private recolourChannels(): void {
    const attr = this.channels?.geometry.getAttribute("color");
    if (!(attr instanceof THREE.BufferAttribute)) return;
    let max = 1;
    for (const e of this.model.edges) max = Math.max(max, e.rps);
    this.model.edges.forEach((e, i) => {
      this.tmpColor.copy(this.channelBase).multiplyScalar(0.25 + 0.75 * Math.sqrt(e.rps / max));
      attr.setXYZ(i * 2, this.tmpColor.r, this.tmpColor.g, this.tmpColor.b);
      attr.setXYZ(i * 2 + 1, this.tmpColor.r, this.tmpColor.g, this.tmpColor.b);
    });
    attr.needsUpdate = true;
  }
}

/** Low-poly island piece: a cylinder with deterministic per-id radial jitter, flat shaded. */
export function jaggedCylinder(
  id: string,
  top: number,
  bottom: number,
  height: number,
  salt: number,
  segments = ISLAND_SEGMENTS,
): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(top, bottom, height, segments, 1);
  const pos = g.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    if (Math.hypot(x, z) < 1e-4) continue; // cap centres
    // % folds the seam (angle 0 and 2*pi) onto one index so the jittered ring stays closed.
    const angleIndex =
      Math.round(((Math.atan2(z, x) + Math.PI) / (2 * Math.PI)) * segments) % segments;
    const f = 1 + unitNoise(id, salt + angleIndex) * 0.18;
    pos.setX(i, x * f);
    pos.setZ(i, z * f);
  }
  const flat = g.toNonIndexed();
  g.dispose();
  flat.computeVertexNormals();
  return flat;
}
