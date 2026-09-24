/**
 * Cinematic islets: one mossy rock islet per service carrying a small structure whose SILHOUETTE
 * says what the service is, readable without labels:
 *   gateway = lighthouse, auth = stone tower with a lock ring, api/service = stilt hall,
 *   cache = small hut with a quick beacon mast, database = layered rock with a vault door,
 *   queue = jetty with crates, worker = workshop with a chimney.
 * Warm lantern windows everywhere; a status-coloured signal light per structure (Round 3 animates
 * it: amber pulse, red flicker). Procedural PBR materials; no model files.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { glowMaterial } from "../scene/glow";
import { unitNoise } from "../scene/layout";
import type { IslandState, Status, WorldModel } from "../scene/model";
import { mulberry32 } from "./textures";

export type Silhouette = "lighthouse" | "tower" | "hall" | "beacon" | "vault" | "jetty" | "workshop";

/** Kind -> silhouette, with the well-known auth role called out (it shares kind "service"). */
export function silhouetteFor(state: Pick<IslandState, "id" | "kind">): Silhouette {
  if (state.kind === "service" && /auth|login|identity|iam|sso/.test(state.id)) return "tower";
  switch (state.kind) {
    case "gateway":
      return "lighthouse";
    case "cache":
      return "beacon";
    case "database":
      return "vault";
    case "queue":
      return "jetty";
    case "worker":
      return "workshop";
    default:
      return "hall";
  }
}

const STATUS_HEX: Record<Status, number> = { ok: 0x3fd0a5, degraded: 0xf2b134, failing: 0xff4d5e };

interface Mats {
  wood: THREE.MeshStandardMaterial;
  darkWood: THREE.MeshStandardMaterial;
  stone: THREE.MeshStandardMaterial;
  paleStone: THREE.MeshStandardMaterial;
  roof: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  window: THREE.MeshStandardMaterial;
  rock: THREE.MeshStandardMaterial;
  status: Record<Status, THREE.MeshStandardMaterial>;
  lanternGlow: THREE.SpriteMaterial;
  statusGlow: Record<Status, THREE.SpriteMaterial>;
}

function makeMats(): Mats {
  const std = (color: number, roughness: number, metalness = 0): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const emissive = (hex: number, intensity: number): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({ color: 0x000000, emissive: hex, emissiveIntensity: intensity, roughness: 0.6 });
  return {
    wood: std(0x4a3a2c, 0.85),
    darkWood: std(0x2c231c, 0.9),
    stone: std(0x5b5760, 0.95),
    paleStone: std(0x9d968c, 0.85),
    roof: std(0x2a2328, 0.8),
    metal: std(0x2b2d30, 0.45, 0.8),
    window: emissive(0xffa95c, 5.5),
    rock: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }),
    status: {
      ok: emissive(STATUS_HEX.ok, 4),
      degraded: emissive(STATUS_HEX.degraded, 5),
      failing: emissive(STATUS_HEX.failing, 6),
    },
    lanternGlow: glowMaterial(0xffa25a, 0.5),
    statusGlow: {
      ok: glowMaterial(STATUS_HEX.ok, 0.45),
      degraded: glowMaterial(STATUS_HEX.degraded, 0.55),
      failing: glowMaterial(STATUS_HEX.failing, 0.65),
    },
  };
}

/** Lumpy islet: displaced, flattened icosphere, moss on top, wet dark rock at the waterline. */
function isletGeometry(id: string, radius: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 4);
  const pos = g.getAttribute("position");
  const colors = new Float32Array(pos.count * 3);
  const moss = new THREE.Color(0x2f3d22);
  const rock = new THREE.Color(0x44403a);
  const wet = new THREE.Color(0x191816);
  const mud = new THREE.Color(0x3a3024);
  const c = new THREE.Color();
  const seed = unitNoise(id, 3) * 100;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n =
      Math.sin(x * 3.1 + seed) * Math.cos(z * 2.7 - seed) * 0.12 +
      Math.sin(x * 7.3 + z * 5.1 + seed) * 0.05 +
      Math.sin(z * 11.0 - x * 3.0) * 0.025;
    const r = 1 + n;
    const flat = y > 0 ? 0.42 : 0.6;
    const px = x * r * radius;
    const py = (y * flat + n * 0.4) * radius * 0.9 + 0.12;
    const pz = z * r * radius;
    pos.setXYZ(i, px, py, pz);
    const up = y;
    if (py < 0.18) c.copy(wet).lerp(mud, Math.max(0, py / 0.18) * 0.5);
    else if (up > 0.55) c.copy(moss).lerp(rock, Math.max(0, n * 3));
    else c.copy(rock).lerp(moss, Math.max(0, (up - 0.2) * 1.6));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

interface Built {
  group: THREE.Group;
  signal: THREE.Mesh;
  signalGlow: THREE.Sprite;
  top: number;
}

function box(w: number, h: number, d: number, m: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function cyl(rt: number, rb: number, h: number, seg: number, m: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Gable roof: a triangular prism along x. */
function gable(w: number, h: number, d: number, m: THREE.Material): THREE.Mesh {
  const g = new THREE.CylinderGeometry(d * 0.62, d * 0.62, w, 3, 1);
  g.rotateZ(Math.PI / 2);
  g.rotateX(Math.PI / 6);
  g.scale(1, h / (d * 0.62 * 1.5), 1);
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true;
  return mesh;
}

function windowPane(w: number, h: number, m: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
}

function structure(kind: Silhouette, mats: Mats, status: Status, rnd: () => number): Built {
  const g = new THREE.Group();
  const signal = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), mats.status[status]);
  const signalGlow = new THREE.Sprite(mats.statusGlow[status]);
  signalGlow.scale.set(1.6, 1.6, 1);
  const lantern = (x: number, y: number, z: number, size = 0.9): void => {
    const s = new THREE.Sprite(mats.lanternGlow);
    s.position.set(x, y, z);
    s.scale.set(size, size, 1);
    g.add(s);
  };
  let top = 1;

  switch (kind) {
    case "lighthouse": {
      const tower = cyl(0.26, 0.42, 2.8, 12, mats.paleStone);
      tower.position.y = 1.4;
      const band = cyl(0.33, 0.35, 0.18, 12, mats.roof);
      band.position.y = 1.2;
      const gallery = cyl(0.42, 0.42, 0.06, 12, mats.metal);
      gallery.position.y = 2.82;
      const room = cyl(0.24, 0.24, 0.42, 10, mats.window);
      room.position.y = 3.06;
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.4, 10), mats.roof);
      cap.position.y = 3.47;
      signal.position.set(0, 3.72, 0);
      g.add(tower, band, gallery, room, cap);
      lantern(0, 3.06, 0, 2.2);
      top = 3.8;
      break;
    }
    case "tower": {
      const t = box(0.8, 2.2, 0.8, mats.stone);
      t.position.y = 1.1;
      g.add(t);
      for (const [x, z] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]] as const) {
        const m = box(0.2, 0.26, 0.2, mats.stone);
        m.position.set(x, 2.33, z);
        g.add(m);
      }
      for (const y of [0.9, 1.6]) {
        const w = windowPane(0.1, 0.3, mats.window);
        w.position.set(0, y, 0.405);
        g.add(w);
        lantern(0, y, 0.5, 0.6);
      }
      const lock = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.035, 8, 20), mats.status[status]);
      lock.position.set(0, 0.45, 0.42);
      g.add(lock);
      signal.position.set(0, 2.62, 0);
      top = 2.7;
      break;
    }
    case "hall": {
      const deck = box(2.4, 0.08, 1.2, mats.darkWood);
      deck.position.set(0.5, 0.62, 0);
      const hall = box(2.0, 0.75, 0.95, mats.wood);
      hall.position.set(0.5, 1.03, 0);
      const roof = gable(2.3, 0.6, 1.25, mats.roof);
      roof.position.set(0.5, 1.62, 0);
      g.add(deck, hall, roof);
      for (let i = 0; i < 5; i++) {
        for (const z of [-0.55, 0.55]) {
          const stilt = cyl(0.04, 0.05, 1.3, 5, mats.darkWood);
          stilt.position.set(-0.6 + i * 0.55, 0.0, z);
          g.add(stilt);
        }
      }
      for (let i = 0; i < 4; i++) {
        const w = windowPane(0.22, 0.26, mats.window);
        w.position.set(-0.2 + i * 0.45, 1.05, 0.48);
        g.add(w);
      }
      lantern(0.5, 1.05, 0.7, 1.4);
      lantern(1.75, 0.8, 0.45, 0.7);
      signal.position.set(0.5, 2.05, 0);
      top = 2.1;
      break;
    }
    case "beacon": {
      const hut = box(0.6, 0.45, 0.55, mats.wood);
      hut.position.y = 0.72;
      const roof = gable(0.7, 0.3, 0.7, mats.roof);
      roof.position.y = 1.08;
      const mast = cyl(0.03, 0.05, 2.0, 5, mats.metal);
      mast.position.set(0.45, 1.3, 0);
      const w = windowPane(0.16, 0.16, mats.window);
      w.position.set(0, 0.74, 0.28);
      g.add(hut, roof, mast, w);
      signal.scale.setScalar(1.6);
      signal.position.set(0.45, 2.35, 0);
      lantern(0, 0.74, 0.4, 0.6);
      top = 2.4;
      break;
    }
    case "vault": {
      let y = 0.45;
      for (let i = 0; i < 3; i++) {
        const r = 1.05 - i * 0.24;
        const h = 0.42 - i * 0.05;
        const slab = cyl(r * 0.92, r, h, 9, mats.stone);
        slab.position.y = y + h / 2;
        slab.rotation.y = rnd() * Math.PI;
        g.add(slab);
        y += h;
      }
      const door = new THREE.Mesh(new THREE.CircleGeometry(0.26, 20), mats.metal);
      door.position.set(0, 0.75, 1.0);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.29, 0.04, 8, 24), mats.status[status]);
      rim.position.set(0, 0.75, 1.01);
      g.add(door, rim);
      lantern(0.55, 0.9, 0.85, 0.7);
      signal.position.set(0, y + 0.12, 0);
      top = y + 0.2;
      break;
    }
    case "jetty": {
      const deck = box(3.0, 0.07, 0.55, mats.darkWood);
      deck.position.set(1.3, 0.35, 0);
      g.add(deck);
      for (let i = 0; i < 6; i++) {
        for (const z of [-0.25, 0.25]) {
          const post = cyl(0.035, 0.04, 0.9, 5, mats.darkWood);
          post.position.set(0.1 + i * 0.55, 0.0, z);
          g.add(post);
        }
      }
      for (let i = 0; i < 5; i++) {
        const c = box(0.28, 0.28, 0.28, mats.wood);
        c.position.set(-0.2 + (i % 3) * 0.32, 0.62 + Math.floor(i / 3) * 0.29, (rnd() - 0.5) * 0.3);
        c.rotation.y = (rnd() - 0.5) * 0.5;
        g.add(c);
      }
      const post = cyl(0.03, 0.03, 1.1, 5, mats.metal);
      post.position.set(2.7, 0.9, 0.2);
      g.add(post);
      lantern(2.7, 1.45, 0.2, 1.0);
      lantern(0.05, 1.05, 0.25, 0.8);
      const crateLamp = box(0.08, 0.1, 0.08, mats.window);
      crateLamp.position.set(0.05, 0.97, 0.25);
      g.add(crateLamp);
      signal.position.set(2.7, 1.5, 0.2);
      top = 1.6;
      break;
    }
    case "workshop": {
      const house = box(1.1, 0.7, 0.85, mats.wood);
      house.position.y = 0.9;
      const roof = gable(1.25, 0.5, 1.05, mats.roof);
      roof.position.y = 1.45;
      const chimney = box(0.18, 0.8, 0.18, mats.stone);
      chimney.position.set(0.32, 1.7, -0.15);
      g.add(house, roof, chimney);
      for (const x of [-0.25, 0.2]) {
        const w = windowPane(0.2, 0.22, mats.window);
        w.position.set(x, 0.92, 0.43);
        g.add(w);
      }
      lantern(0, 0.92, 0.6, 1.1);
      signal.position.set(-0.4, 1.75, 0.2);
      top = 2.1;
      break;
    }
  }
  signalGlow.position.copy(signal.position);
  g.add(signal, signalGlow);
  return { group: g, signal, signalGlow, top };
}

/**
 * Collapses a structure's static meshes into one mesh per material (the signal light stays separate
 * so it can switch status material). ~15 meshes -> ~5, and every mesh is drawn 3x per frame (main
 * view, planar reflection, shadow map), so this matters.
 */
function mergeStatic(group: THREE.Group, keep: THREE.Object3D): void {
  group.updateMatrixWorld(true);
  const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const drop: THREE.Mesh[] = [];
  group.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || o === keep || Array.isArray(o.material)) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const name of Object.keys(g.attributes)) {
      if (name !== "position" && name !== "normal") g.deleteAttribute(name);
    }
    g.applyMatrix4(o.matrixWorld);
    const list = byMaterial.get(o.material) ?? [];
    list.push(g);
    byMaterial.set(o.material, list);
    drop.push(o);
  });
  for (const o of drop) {
    o.removeFromParent();
    o.geometry.dispose();
  }
  const inverse = group.matrixWorld.clone().invert();
  for (const [material, geos] of byMaterial) {
    const merged = mergeGeometries(geos);
    for (const g of geos) g.dispose();
    if (!merged) continue;
    merged.applyMatrix4(inverse);
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
}

interface IslandView {
  state: IslandState;
  root: THREE.Group;
  signal: THREE.Mesh;
  signalGlow: THREE.Sprite;
  shownStatus: Status;
}

export class Islands {
  readonly root = new THREE.Group();
  private readonly mats = makeMats();
  private views: IslandView[] = [];
  private builtVersion = -1;
  private facingKey = "";

  update(model: WorldModel, eye: THREE.Vector3): void {
    if (model.topologyVersion !== this.builtVersion) this.rebuild(model);
    // Turn each structure's front (+z: doors, windows, lock ring, vault door) toward the camera's
    // base view, with a little per-island jitter so it does not look staged.
    const key = `${this.builtVersion}|${Math.round(eye.x)}|${Math.round(eye.z)}`;
    if (key !== this.facingKey) {
      this.facingKey = key;
      for (const v of this.views) {
        const face = Math.atan2(eye.x - v.root.position.x, eye.z - v.root.position.z);
        v.root.rotation.y = face + unitNoise(v.state.id, 5) * 0.45;
      }
    }
    for (const v of this.views) {
      v.root.scale.setScalar(0.95 + 0.4 * v.state.scale);
      if (v.shownStatus !== v.state.status) {
        v.shownStatus = v.state.status;
        v.signal.material = this.mats.status[v.state.status];
        v.signalGlow.material = this.mats.statusGlow[v.state.status];
      }
    }
  }

  get meshCount(): number {
    let n = 0;
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) n += 1;
    });
    return n;
  }

  private rebuild(model: WorldModel): void {
    this.clear();
    this.builtVersion = model.topologyVersion;
    for (const state of model.islands.values()) {
      const rnd = mulberry32(Math.floor((unitNoise(state.id, 9) + 1) * 1e6));
      const root = new THREE.Group();
      root.name = state.id;
      const kind = silhouetteFor(state);
      const radius = kind === "vault" ? 1.55 : kind === "beacon" ? 0.95 : 1.3;
      const islet = new THREE.Mesh(isletGeometry(state.id, radius), this.mats.rock);
      islet.receiveShadow = true;
      islet.castShadow = true;
      const built = structure(kind, this.mats, state.status, rnd);
      mergeStatic(built.group, built.signal);
      root.add(islet, built.group);
      root.position.set(state.place.x, 0, state.place.z);
      this.root.add(root);
      this.views.push({
        state,
        root,
        signal: built.signal,
        signalGlow: built.signalGlow,
        shownStatus: state.status,
      });
    }
  }

  private clear(): void {
    for (const v of this.views) {
      this.root.remove(v.root);
      v.root.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
    }
    this.views = [];
  }

  dispose(): void {
    this.clear();
    const m = this.mats;
    for (const mat of [m.wood, m.darkWood, m.stone, m.paleStone, m.roof, m.metal, m.window, m.rock, m.lanternGlow, ...Object.values(m.status), ...Object.values(m.statusGlow)]) {
      mat.dispose();
    }
  }
}
