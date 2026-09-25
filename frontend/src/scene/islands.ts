/**
 * Cinematic islets: one mossy rock islet per service carrying a small structure whose SILHOUETTE
 * says what the service is, readable without labels:
 *   gateway = lighthouse, auth = stone tower with a lock ring, api/service = stilt hall,
 *   cache = small hut with a quick beacon mast, database = layered rock with a vault door,
 *   queue = jetty with crates, worker = workshop with a chimney.
 * Warm lantern windows everywhere; a status-coloured signal light per structure (Round 3 animates
 * it: amber pulse, red flicker). Procedural PBR materials; no model files.
 *
 * Draw calls do not grow with the number of islands: after building each islet, all of them are
 * merged per material into one mesh (scene/island-batch.ts). Per-island placement, traffic scale,
 * facing and status/window light live in a float texture updated each frame.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { glowMaterial } from "./glow";
import { unitNoise } from "./layout";
import type { IslandState, Status, WorldModel } from "./model";
import { isletScale, type Silhouette, silhouetteFor } from "./silhouette";
import { GlowBatch } from "./glows";
import { IslandBatch, MAX_ISLANDS, tagIsland } from "./island-batch";
import { mulberry32 } from "./random";
import { withSurface } from "./surfaces";

const STATUS_HEX: Record<Status, number> = {
  ok: 0x3fd0a5,
  degraded: 0xf2b134,
  failing: 0xff4d5e,
  offline: 0x59606b,
};

/** "pbr": Cinematic (standard materials, shadows). "flat": Balanced/Simple (flat Lambert, cheaper). */
export type Flavour = "pbr" | "flat";
type Lit = THREE.MeshStandardMaterial | THREE.MeshLambertMaterial;

interface Mats {
  wood: Lit;
  darkWood: Lit;
  stone: Lit;
  paleStone: Lit;
  roof: Lit;
  metal: Lit;
  window: Lit;
  rock: Lit;
  status: Record<Status, Lit>;
  lanternGlow: THREE.SpriteMaterial;
  statusGlow: Record<Status, THREE.SpriteMaterial>;
}

function makeMats(flavour: Flavour): Mats {
  const std = (color: number, roughness: number, metalness = 0): Lit =>
    flavour === "pbr"
      ? new THREE.MeshStandardMaterial({ color, roughness, metalness })
      : new THREE.MeshLambertMaterial({ color, flatShading: true });
  const emissive = (hex: number, intensity: number): Lit =>
    flavour === "pbr"
      ? new THREE.MeshStandardMaterial({ color: 0x000000, emissive: hex, emissiveIntensity: intensity, roughness: 0.6 })
      : new THREE.MeshLambertMaterial({ color: 0x000000, emissive: hex, emissiveIntensity: Math.min(intensity, 1.4) });
  const mats: Mats = {
    wood: std(0x4a3a2c, 0.85),
    darkWood: std(0x2c231c, 0.9),
    stone: std(0x5b5760, 0.95),
    paleStone: std(0x9d968c, 0.85),
    roof: std(0x2a2328, 0.8),
    metal: std(0x2b2d30, 0.45, 0.8),
    window: emissive(0xffa95c, 5.5),
    rock:
      flavour === "pbr"
        ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 })
        : new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
    status: {
      ok: emissive(STATUS_HEX.ok, 4),
      degraded: emissive(STATUS_HEX.degraded, 5),
      failing: emissive(STATUS_HEX.failing, 6),
      offline: emissive(STATUS_HEX.offline, 1),
    },
    lanternGlow: glowMaterial(0xffa25a, 0.5),
    statusGlow: {
      ok: glowMaterial(STATUS_HEX.ok, 0.45),
      degraded: glowMaterial(STATUS_HEX.degraded, 0.55),
      failing: glowMaterial(STATUS_HEX.failing, 0.65),
      offline: glowMaterial(STATUS_HEX.offline, 0.1),
    },
  };
  if (flavour === "pbr") {
    // Planks, shingles, stone courses and rock grain drawn in the shader (no extra triangles).
    withSurface(mats.wood as THREE.MeshStandardMaterial, "wood");
    withSurface(mats.darkWood as THREE.MeshStandardMaterial, "wood");
    withSurface(mats.stone as THREE.MeshStandardMaterial, "stone", 0.016);
    withSurface(mats.paleStone as THREE.MeshStandardMaterial, "stripes", 0.014);
    withSurface(mats.roof as THREE.MeshStandardMaterial, "roof", 0.014);
    withSurface(mats.rock as THREE.MeshStandardMaterial, "rock", 0.03);
  }
  return mats;
}

/** Lumpy islet: displaced, flattened icosphere, moss on top, wet dark rock at the waterline. */
function isletGeometry(id: string, radius: number, detail = 4): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, detail);
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

/** Anchor names the render paths look for: chimney smoke sources and the lighthouse lamp. */
export const SMOKE_ANCHOR = "tw-smoke";
export const LAMP_ANCHOR = "tw-lamp";

function anchor(g: THREE.Group, name: string, x: number, y: number, z: number): void {
  const a = new THREE.Object3D();
  a.name = name;
  a.position.set(x, y, z);
  g.add(a);
}

/** A window's frame: sill, lintel and two jambs, standing just proud of the wall (+z facing). */
function frame(g: THREE.Group, m: THREE.Material, x: number, y: number, z: number, w: number, h: number): void {
  const t = 0.035;
  for (const [fx, fy, fw, fh] of [
    [0, -h / 2 - t / 2, w + t * 3, t * 1.3],
    [0, h / 2 + t / 2, w + t * 2, t],
    [-w / 2 - t / 2, 0, t, h],
    [w / 2 + t / 2, 0, t, h],
  ] as const) {
    const b = box(fw, fh, t, m);
    b.position.set(x + fx, y + fy, z + t / 2);
    g.add(b);
  }
  // Muntin cross: four panes read as a real window, not a glowing slab.
  const v = box(0.012, h, 0.012, m);
  v.position.set(x, y, z + 0.008);
  const hz = box(w, 0.012, 0.012, m);
  hz.position.set(x, y, z + 0.008);
  g.add(v, hz);
}

/** A plank door with a lintel, facing +z. */
function door(g: THREE.Group, mats: Mats, x: number, y0: number, z: number, w = 0.26, h = 0.46): void {
  const d = box(w, h, 0.03, mats.darkWood);
  d.position.set(x, y0 + h / 2, z + 0.015);
  const lintel = box(w + 0.08, 0.05, 0.05, mats.wood);
  lintel.position.set(x, y0 + h + 0.025, z + 0.025);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.018, 5, 4), mats.metal);
  knob.position.set(x + w * 0.32, y0 + h * 0.48, z + 0.04);
  g.add(d, lintel, knob);
}

/** Railing along x at height y (posts + top rail), facing +z. */
function railing(g: THREE.Group, m: THREE.Material, x0: number, x1: number, y: number, z: number): void {
  const n = Math.max(2, Math.round((x1 - x0) / 0.38) + 1);
  for (let i = 0; i < n; i++) {
    const p = box(0.03, 0.3, 0.03, m);
    p.position.set(x0 + ((x1 - x0) * i) / (n - 1), y + 0.15, z);
    g.add(p);
  }
  const rail = box(x1 - x0 + 0.04, 0.03, 0.035, m);
  rail.position.set((x0 + x1) / 2, y + 0.3, z);
  g.add(rail);
}

/**
 * Cinematic-only detail on top of the silhouette: frames, doors, railings, props, and the anchors
 * for chimney smoke and the lighthouse lamp. Balanced/Simple skip it (their triangle budgets are
 * 20x smaller and the extra detail would not read at their distance anyway).
 */
function detail(kind: Silhouette, g: THREE.Group, mats: Mats): void {
  switch (kind) {
    case "lighthouse": {
      door(g, mats, 0, 0.45, 0.39, 0.22, 0.42);
      for (const y of [1.55, 2.2]) {
        const w = windowPane(0.08, 0.2, mats.window);
        w.position.set(0, y, 0.34 - (y - 1.4) * 0.05);
        g.add(w);
      }
      // Gallery railing: a ring of posts and a thin rail around the lamp room.
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const p = box(0.022, 0.24, 0.022, mats.metal);
        p.position.set(Math.cos(a) * 0.4, 2.97, Math.sin(a) * 0.4);
        g.add(p);
      }
      const rail = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.012, 4, 24), mats.metal);
      rail.rotation.x = Math.PI / 2;
      rail.position.y = 3.09;
      g.add(rail);
      // Lamp-room glazing bars.
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const bar = box(0.02, 0.42, 0.02, mats.metal);
        bar.position.set(Math.cos(a) * 0.245, 3.06, Math.sin(a) * 0.245);
        g.add(bar);
      }
      break;
    }
    case "tower": {
      door(g, mats, 0, 0.55, 0.4, 0.26, 0.5);
      // Flag pole on the roof.
      const pole = cyl(0.012, 0.015, 0.7, 4, mats.metal);
      pole.position.set(-0.28, 2.6, -0.28);
      g.add(pole);
      break;
    }
    case "hall": {
      for (let i = 0; i < 4; i++) frame(g, mats.darkWood, -0.2 + i * 0.45, 1.05, 0.475, 0.22, 0.26);
      // The hall's end wall faces +x: the door is on the deck side, at the end.
      const d = new THREE.Group();
      door(d, mats, 0, 0.66, 0, 0.26, 0.5);
      d.rotation.y = Math.PI / 2;
      d.position.set(1.5, 0, 0);
      g.add(d);
      railing(g, mats.darkWood, -0.65, 1.65, 0.66, 0.57);
      const ridge = box(2.34, 0.05, 0.05, mats.darkWood);
      ridge.position.set(0.5, 1.94, 0);
      g.add(ridge);
      // A rain barrel and a ladder down to the water.
      const barrel = cyl(0.11, 0.1, 0.26, 8, mats.wood);
      barrel.position.set(1.62, 0.8, -0.35);
      g.add(barrel);
      for (const z of [-0.12, 0.12]) {
        const side = box(0.03, 0.8, 0.03, mats.darkWood);
        side.position.set(1.72, 0.3, z);
        g.add(side);
      }
      for (let i = 0; i < 4; i++) {
        const rung = box(0.03, 0.025, 0.24, mats.darkWood);
        rung.position.set(1.72, 0.05 + i * 0.17, 0);
        g.add(rung);
      }
      break;
    }
    case "beacon": {
      door(g, mats, -0.16, 0.5, 0.275, 0.16, 0.34);
      frame(g, mats.darkWood, 0.1, 0.74, 0.275, 0.16, 0.16);
      const dish = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.08, 10, 1, true), mats.metal);
      dish.rotation.x = Math.PI / 2 + 0.4;
      dish.position.set(0.45, 1.85, 0.12);
      g.add(dish);
      break;
    }
    case "vault": {
      // Steps up to the vault door and iron bands on the door.
      for (let i = 0; i < 3; i++) {
        const step = box(0.7 - i * 0.1, 0.1, 0.22, mats.stone);
        step.position.set(0, 0.3 + i * 0.1, 1.22 - i * 0.16);
        g.add(step);
      }
      for (const y of [0.64, 0.86]) {
        const band = box(0.44, 0.03, 0.02, mats.darkWood);
        band.position.set(0, y, 1.015);
        g.add(band);
      }
      const post = cyl(0.03, 0.035, 0.7, 5, mats.metal);
      post.position.set(0.55, 0.75, 0.85);
      g.add(post);
      break;
    }
    case "jetty": {
      for (const x of [0.6, 1.7, 2.6]) {
        const bollard = cyl(0.05, 0.06, 0.18, 7, mats.metal);
        bollard.position.set(x, 0.47, -0.2);
        g.add(bollard);
      }
      const rope = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.022, 4, 12), mats.wood);
      rope.rotation.x = Math.PI / 2;
      rope.position.set(1.15, 0.4, 0.12);
      g.add(rope);
      break;
    }
    case "workshop": {
      door(g, mats, 0.4, 0.55, 0.425, 0.22, 0.46);
      for (const x of [-0.25, 0.2]) frame(g, mats.darkWood, x - 0.1, 0.92, 0.425, 0.2, 0.22);
      // Wood pile against the side wall.
      for (let i = 0; i < 5; i++) {
        const log = cyl(0.05, 0.05, 0.36, 6, mats.wood);
        log.rotation.x = Math.PI / 2;
        log.position.set(-0.68, 0.62 + Math.floor(i / 3) * 0.09, -0.2 + (i % 3) * 0.1 + (i >= 3 ? 0.05 : 0));
        g.add(log);
      }
      break;
    }
  }
}

/**
 * Shore boulders and a moored rowboat around a Cinematic islet (island-local; the rowboat sits on
 * the side away from the structure's front so it never hides a door or window).
 */
function shoreProps(root: THREE.Group, mats: Mats, radius: number, rnd: () => number): void {
  const rockCol = new THREE.Color();
  const n = 4 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const g = new THREE.DodecahedronGeometry(1, 0);
    const pos = g.getAttribute("position");
    for (let k = 0; k < pos.count; k++) {
      pos.setXYZ(k, pos.getX(k) * (0.85 + rnd() * 0.3), pos.getY(k) * (0.6 + rnd() * 0.25), pos.getZ(k) * (0.85 + rnd() * 0.3));
    }
    const colours = new Float32Array(pos.count * 3);
    rockCol.setHSL(0.08, 0.08, 0.14 + rnd() * 0.08);
    for (let k = 0; k < pos.count; k++) colours.set([rockCol.r, rockCol.g, rockCol.b], k * 3);
    g.setAttribute("color", new THREE.BufferAttribute(colours, 3));
    g.computeVertexNormals(); // dodecahedra are already non-indexed: faceted normals as-is
    const b = new THREE.Mesh(g, mats.rock);
    const a = rnd() * Math.PI * 2;
    const r = radius * (0.95 + rnd() * 0.25);
    const size = 0.12 + rnd() * 0.18;
    b.scale.setScalar(size);
    b.position.set(Math.cos(a) * r, 0.02, Math.sin(a) * r);
    b.rotation.set(rnd(), rnd() * 6, rnd());
    root.add(b);
  }
  // Rowboat: an open bowl hull with two thwarts, tied up behind the islet.
  const hullGeo = new THREE.SphereGeometry(1, 12, 5, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  hullGeo.scale(0.5, 0.16, 0.19);
  const boat = new THREE.Group();
  const hull = new THREE.Mesh(hullGeo, mats.wood);
  hull.position.y = 0.1;
  boat.add(hull);
  for (const x of [-0.16, 0.14]) {
    const thwart = box(0.07, 0.02, 0.34, mats.darkWood);
    thwart.position.set(x, 0.07, 0);
    boat.add(thwart);
  }
  const oar = box(0.7, 0.015, 0.035, mats.darkWood);
  oar.position.set(0.02, 0.1, 0.06);
  oar.rotation.y = 0.18;
  boat.add(oar);
  const a = Math.PI + (rnd() - 0.5) * 1.2; // behind (-z) the structure's front
  boat.position.set(Math.sin(a) * (radius + 0.35), 0, Math.cos(a) * (radius + 0.35));
  boat.rotation.y = a + Math.PI / 2 + (rnd() - 0.5) * 0.4;
  root.add(boat);
  const post = cyl(0.03, 0.035, 0.5, 5, mats.darkWood);
  post.position.set(Math.sin(a) * radius * 0.92, 0.2, Math.cos(a) * radius * 0.92);
  root.add(post);
}

function structure(kind: Silhouette, mats: Mats, status: Status, rnd: () => number, withDetail = false): Built {
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
      // Eight rows (0.35 tall) so the flat tiers can paint alternate rows red: per-face colour.
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.42, 2.8, 12, 8), mats.paleStone);
      tower.castShadow = true;
      tower.receiveShadow = true;
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
  // Stove pipes and the emitter anchors exist on every tier (smoke and the lamp beam are drawn by
  // the render paths that can afford them).
  if (kind === "hall" || kind === "beacon") {
    const [x, y, z, h] = kind === "hall" ? [-0.1, 1.95, -0.2, 0.55] : [-0.18, 1.2, -0.12, 0.3];
    const pipe = cyl(0.04, 0.04, h, 6, mats.metal);
    pipe.position.set(x, y, z);
    g.add(pipe);
    anchor(g, SMOKE_ANCHOR, x, y + h / 2 + 0.05, z);
  }
  if (kind === "workshop") anchor(g, SMOKE_ANCHOR, 0.32, 2.15, -0.15);
  if (kind === "lighthouse") anchor(g, LAMP_ANCHOR, 0, 3.06, 0);
  if (withDetail) detail(kind, g, mats);
  signalGlow.position.copy(signal.position);
  g.add(signal, signalGlow);
  return { group: g, signal, signalGlow, top };
}

/**
 * Collapses a structure's static meshes into one mesh per material (the signal light stays separate
 * so it can switch status material). ~15 meshes -> ~5, and every mesh is drawn 3x per frame (main
 * view, planar reflection, shadow map), so this matters.
 */
function mergeStatic(group: THREE.Group, keep: THREE.Object3D | null): void {
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

const FLAT_BAND = new THREE.Color(0xb3443a);
const FLAT_MOSS = new THREE.Color(0x3d4d2b);

/**
 * Hand-painted look for the flat tiers, baked per face (no shader cost): each face's tone jitters a
 * little, the lighthouse gets its red bands, and some up-facing roof faces go mossy.
 */
function flatColours(g: THREE.BufferGeometry, material: THREE.Material, mats: Mats): THREE.BufferAttribute {
  const pos = g.getAttribute("position");
  const out = new Float32Array(pos.count * 3);
  const base = new THREE.Color((material as THREE.MeshLambertMaterial).color?.getHex() ?? 0x444444);
  const c = new THREE.Color();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const d = new THREE.Vector3();
  for (let f = 0; f + 2 < pos.count; f += 3) {
    a.fromBufferAttribute(pos, f);
    b.fromBufferAttribute(pos, f + 1);
    d.fromBufferAttribute(pos, f + 2);
    const cx = (a.x + b.x + d.x) / 3;
    const cy = (a.y + b.y + d.y) / 3;
    const cz = (a.z + b.z + d.z) / 3;
    const h = Math.abs(Math.sin(cx * 127.1 + cy * 311.7 + cz * 74.7) * 43758.5453) % 1;
    c.copy(base).multiplyScalar(1.6 + 0.45 * h); // flat Lambert reads darker than PBR: lift it
    if (material === mats.paleStone && cy > 1.0 && Math.floor(cy / 0.35) % 2 === 1) c.copy(FLAT_BAND).multiplyScalar(0.9 + 0.2 * h);
    if (material === mats.roof) {
      const ny = b.sub(a).cross(d.sub(a)).normalize().y;
      if (Math.abs(ny) > 0.4 && h < 0.3) c.lerp(FLAT_MOSS, 0.7);
    }
    for (let k = 0; k < 3; k++) out.set([c.r, c.g, c.b], (f + k) * 3);
  }
  return new THREE.BufferAttribute(out, 3);
}

/**
 * Flat flavour only: bake every body material's colour into vertex colours and merge the islet and
 * all non-glowing parts into ONE mesh (one draw call per islet instead of ~6). Materials in `live`
 * (windows, the status signal) stay separate because they animate per island.
 */
function mergeFlatBody(root: THREE.Group, body: THREE.Material, live: Set<THREE.Material>, mats: Mats): void {
  root.updateMatrixWorld(true);
  const geos: THREE.BufferGeometry[] = [];
  const drop: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || Array.isArray(o.material) || live.has(o.material)) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const name of Object.keys(g.attributes)) {
      if (name !== "position" && name !== "normal" && name !== "color") g.deleteAttribute(name);
    }
    g.applyMatrix4(o.matrixWorld);
    if (!g.getAttribute("color")) g.setAttribute("color", flatColours(g, o.material, mats));
    geos.push(g);
    drop.push(o);
  });
  for (const o of drop) {
    o.removeFromParent();
    o.geometry.dispose();
  }
  const merged = mergeGeometries(geos);
  for (const g of geos) g.dispose();
  if (!merged) return;
  merged.applyMatrix4(root.matrixWorld.clone().invert());
  merged.computeVertexNormals();
  root.add(new THREE.Mesh(merged, body));
}

interface IslandView {
  state: IslandState;
  /** Batch index (row in the island texture). */
  index: number;
  /** Transform holder (no meshes): placement for the glow anchors and the texture. */
  root: THREE.Group;
  /** Per-island glow colours for the GlowBatch (sprite materials used only as value holders). */
  glowMat: THREE.SpriteMaterial;
  lanternMat: THREE.SpriteMaterial;
  /** Glow anchors (former sprites) rendered through the shared GlowBatch. */
  glows: { anchor: THREE.Object3D; size: number; lantern: boolean }[];
  phase: number;
  /** World-space shore circle for the water's foam: x, z, radius. */
  shore: THREE.Vector3;
  /** Cinematic anchors: chimney tops and the lighthouse lamp (children of root). */
  smoke: THREE.Object3D[];
  lamps: THREE.Object3D[];
}

const STATUS_COLOURS: Record<Status, THREE.Color> = {
  ok: new THREE.Color(STATUS_HEX.ok),
  degraded: new THREE.Color(STATUS_HEX.degraded),
  failing: new THREE.Color(STATUS_HEX.failing),
  offline: new THREE.Color(STATUS_HEX.offline),
};
const WARM = new THREE.Color(0xffa95c);
const RED_WINDOW = new THREE.Color(0xff5a48);

/** Smooth pseudo-random 0..1 signal (no hard steps: flicker without strobing). */
function smoothNoise(t: number, seed: number): number {
  return (
    0.5 +
    0.3 * Math.sin(t * 2.3 + seed) +
    0.2 * Math.sin(t * 4.1 + seed * 1.7) * Math.sin(t * 0.9 + seed * 0.3)
  );
}

const LANTERN = new THREE.Color(1.0, 0.62, 0.34);

export class Islands {
  readonly root = new THREE.Group();
  private readonly glowBatch = new GlowBatch();
  private readonly wp = new THREE.Vector3();
  private readonly mats: Mats;
  /** Flat flavour: one vertex-coloured body material shared by every merged islet. */
  private readonly flatBody = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  /** Flat materials cannot go far above 1 emissive without clipping; Cinematic uses HDR values. */
  private readonly emissiveScale: number;
  private glowsEnabled = true;
  private readonly batch = new IslandBatch();
  /** One shared material each for every island's status light and windows (colour per island). */
  private readonly signalMat: Lit;
  private readonly windowMat: Lit;
  private batchMeshes: THREE.Mesh[] = [];

  constructor(private readonly flavour: Flavour = "pbr") {
    this.mats = makeMats(flavour);
    this.emissiveScale = flavour === "pbr" ? 1 : 0.25;
    this.signalMat = this.mats.status.ok.clone();
    this.windowMat = this.mats.window.clone();
    this.batch.patch(this.signalMat, 1);
    this.batch.patch(this.windowMat, 2);
    this.root.add(this.glowBatch.mesh);
  }

  /** Simple tier: no glow billboards at all (one draw call and a lot of overdraw saved). */
  setGlows(enabled: boolean): void {
    this.glowsEnabled = enabled;
    this.glowBatch.mesh.visible = enabled;
  }
  private views: IslandView[] = [];
  private builtVersion = -1;
  private facingKey = "";

  private readonly tmp = new THREE.Color();
  /** Shore circles, updated each frame (the water reads them for foam). */
  readonly shores: THREE.Vector3[] = [];

  update(model: WorldModel, eye: THREE.Vector3, seconds: number, reducedMotion: boolean): void {
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
      const scale = isletScale(v.state.scale);
      v.root.scale.setScalar(scale);
      v.shore.set(v.root.position.x, v.root.position.z, 1.35 * scale);
      this.batch.setPlacement(v.index, v.root.position.x, v.root.position.z, scale, v.root.rotation.y);
      const w = v.state.weight;
      // Signal colour cross-fades between statuses with the eased weights (no popping).
      const { ok, degraded, failing, offline } = STATUS_COLOURS;
      this.tmp.setRGB(
        ok.r * w.ok + degraded.r * w.degraded + failing.r * w.failing + offline.r * w.offline,
        ok.g * w.ok + degraded.g * w.degraded + failing.g * w.failing + offline.g * w.offline,
        ok.b * w.ok + degraded.b * w.degraded + failing.b * w.failing + offline.b * w.offline,
      );
      // Offline: the lights go out. A dim grey signal, dark windows, no lantern.
      const lit = 1 - w.offline;
      const t = seconds + v.phase;
      // Degraded: slow amber breathing (~0.8 Hz). Failing: irregular red flicker, smooth (no strobe).
      const pulse = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(t * 5);
      const flicker = reducedMotion ? 0.6 : smoothNoise(t * 2.2, v.phase * 13);
      const intensity = 3.5 + w.degraded * (1 + 4 * pulse) + w.failing * (2 + 6 * flicker);
      const signal = (intensity * lit + 0.6 * w.offline) * this.emissiveScale;
      this.batch.setEmissive(v.index, 1, this.tmp.r * signal, this.tmp.g * signal, this.tmp.b * signal);
      v.glowMat.color.copy(this.tmp);
      v.glowMat.opacity = (0.35 + w.degraded * 0.35 * pulse + w.failing * 0.5 * flicker) * lit;
      // Windows: warm when healthy; dim and pulse when degraded; reddish, stuttering when failing.
      this.tmp.copy(WARM).lerp(RED_WINDOW, w.failing * 0.6);
      const win =
        5.5 * this.emissiveScale * lit * (1 - w.degraded * 0.35 * (1 - pulse) - w.failing * (0.55 - 0.45 * flicker));
      this.batch.setEmissive(v.index, 2, this.tmp.r * win, this.tmp.g * win, this.tmp.b * win);
      v.lanternMat.opacity = 0.5 * lit * (1 - w.failing * 0.4 * (1 - flicker));
    }
    this.batch.commit();
    // All glows in one draw call per pass.
    if (!this.glowsEnabled) return;
    this.glowBatch.begin();
    for (const v of this.views) {
      v.root.updateMatrixWorld();
      const k = v.root.scale.x;
      for (const g of v.glows) {
        g.anchor.getWorldPosition(this.wp);
        if (g.lantern) this.glowBatch.push(this.wp, g.size * k, LANTERN, v.lanternMat.opacity);
        else this.glowBatch.push(this.wp, g.size * k, v.glowMat.color, v.glowMat.opacity);
      }
    }
    this.glowBatch.end();
  }

  /**
   * World positions of the Cinematic emitters of one kind, written into `out` (grown as needed):
   * xyz = position, w = how lit the island is (0 offline .. 1) times its scale. Returns the count.
   */
  emitters(kind: "smoke" | "lamps", out: THREE.Vector4[]): number {
    let n = 0;
    for (const v of this.views) {
      const list = kind === "smoke" ? v.smoke : v.lamps;
      if (list.length === 0) continue;
      v.root.updateMatrixWorld();
      const lit = (1 - v.state.weight.offline) * v.root.scale.x;
      for (const a of list) {
        a.getWorldPosition(this.wp);
        const slot = out[n] ?? (out[n] = new THREE.Vector4());
        slot.set(this.wp.x, this.wp.y, this.wp.z, lit);
        n += 1;
      }
    }
    return n;
  }

  /** Draw calls the islets themselves cost (one per material, whatever the island count). */
  get batchCount(): number {
    return this.batchMeshes.length;
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
    // Geometry of every island, grouped by the material it will be drawn with.
    const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
    let index = 0;
    for (const state of model.islands.values()) {
      if (index >= MAX_ISLANDS) break;
      const rnd = mulberry32(Math.floor((unitNoise(state.id, 9) + 1) * 1e6));
      const root = new THREE.Group();
      root.name = state.id;
      const kind = silhouetteFor(state);
      const radius = kind === "vault" ? 1.55 : kind === "beacon" ? 0.95 : 1.3;
      const islet = new THREE.Mesh(
        isletGeometry(state.id, radius, this.flavour === "pbr" ? 4 : 2),
        this.mats.rock,
      );
      // Per-island stand-ins while building; in the batch they become the shared signal/window
      // materials, coloured per island from the texture.
      const signalMat = this.mats.status.ok.clone();
      const windowMat = this.mats.window.clone();
      const glowMat = this.mats.statusGlow.ok.clone();
      const lanternMat = this.mats.lanternGlow.clone();
      const own: Mats = {
        ...this.mats,
        window: windowMat,
        status: { ok: signalMat, degraded: signalMat, failing: signalMat, offline: signalMat },
        statusGlow: { ok: glowMat, degraded: glowMat, failing: glowMat, offline: glowMat },
        lanternGlow: lanternMat,
      };
      const built = structure(kind, own, state.status, rnd, this.flavour === "pbr");
      const smoke: THREE.Object3D[] = [];
      const lamps: THREE.Object3D[] = [];
      built.group.traverse((o) => {
        if (o.name === SMOKE_ANCHOR) smoke.push(o);
        if (o.name === LAMP_ANCHOR) lamps.push(o);
      });
      // Swap every sprite for an anchor; the GlowBatch draws them all in one call.
      const glows: IslandView["glows"] = [];
      const sprites: THREE.Sprite[] = [];
      built.group.traverse((o) => {
        if (o instanceof THREE.Sprite) sprites.push(o);
      });
      for (const sp of sprites) {
        const anchor = new THREE.Object3D();
        anchor.position.copy(sp.position);
        sp.parent?.add(anchor);
        sp.removeFromParent();
        glows.push({ anchor, size: sp.scale.x, lantern: sp.material === lanternMat });
      }
      mergeStatic(built.group, null);
      root.add(islet, built.group);
      if (this.flavour === "pbr") shoreProps(root, this.mats, radius, rnd);
      if (this.flavour === "flat") mergeFlatBody(root, this.flatBody, new Set([signalMat, windowMat]), this.mats);
      // Move every mesh's geometry (in island-local space) into its material's bucket.
      root.updateMatrixWorld(true);
      const meshes: THREE.Mesh[] = [];
      root.traverse((o) => {
        if (o instanceof THREE.Mesh) meshes.push(o);
      });
      for (const mesh of meshes) {
        const source = mesh.material as THREE.Material;
        const target = source === signalMat ? this.signalMat : source === windowMat ? this.windowMat : source;
        const colour = (target as THREE.MeshLambertMaterial).vertexColors === true;
        const g = tagIsland(mesh.geometry, index, colour);
        g.applyMatrix4(mesh.matrixWorld);
        const list = buckets.get(target) ?? [];
        list.push(g);
        buckets.set(target, list);
        mesh.removeFromParent();
        mesh.geometry.dispose();
      }
      signalMat.dispose();
      windowMat.dispose();
      root.position.set(state.place.x, 0, state.place.z);
      this.root.add(root);
      const shore = new THREE.Vector3(state.place.x, state.place.z, 1.35);
      this.shores.push(shore);
      this.views.push({
        state,
        index,
        root,
        glowMat,
        lanternMat,
        glows,
        phase: unitNoise(state.id, 71) * 10,
        shore,
        smoke,
        lamps,
      });
      index += 1;
    }
    for (const [material, geos] of buckets) {
      const merged = mergeGeometries(geos);
      for (const g of geos) g.dispose();
      if (!merged) continue;
      this.batch.patch(material);
      const mesh = new THREE.Mesh(merged, material);
      // The shader places each island; bounds of the unplaced geometry would cull wrongly.
      mesh.frustumCulled = false;
      if (this.flavour === "pbr") {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.customDepthMaterial = this.batch.depthMaterial;
      }
      this.batchMeshes.push(mesh);
      this.root.add(mesh);
    }
  }

  private clear(): void {
    this.shores.length = 0;
    for (const v of this.views) {
      for (const m of [v.glowMat, v.lanternMat]) m.dispose();
      this.root.remove(v.root);
    }
    this.views = [];
    for (const mesh of this.batchMeshes) {
      this.root.remove(mesh);
      mesh.geometry.dispose();
    }
    this.batchMeshes = [];
  }

  dispose(): void {
    this.clear();
    this.glowBatch.dispose();
    this.flatBody.dispose();
    this.batch.dispose();
    this.signalMat.dispose();
    this.windowMat.dispose();
    const m = this.mats;
    for (const mat of [m.wood, m.darkWood, m.stone, m.paleStone, m.roof, m.metal, m.window, m.rock, m.lanternGlow, ...Object.values(m.status), ...Object.values(m.statusGlow)]) {
      mat.dispose();
    }
  }
}
