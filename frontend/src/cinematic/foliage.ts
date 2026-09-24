/**
 * Cinematic foliage, all instanced and procedural:
 *  - bald cypress trees: flared trunk, a few branches, crowns of alpha-tested leaf-cluster cards,
 *    hanging Spanish-moss cards, cypress knees at the waterline
 *  - lily pads (+ a few flowers) and reed clumps on the water near islets and banks
 * Wind sway runs in the vertex shader (one shared time uniform), so the CPU cost per frame is a
 * uniform write regardless of how many cards there are.
 *
 * Placement composes a CHANNEL like the reference: a dark wall of trees behind the archipelago and
 * two banks that hug the camera frustum's side edges, never between the camera and an island.
 * It is recomputed only when the topology or the camera's base framing changes.
 */
import * as THREE from "three";
import { params } from "../render/params";
import type { WorldModel } from "../scene/model";
import { leafClusterTexture, mossTexture, mulberry32 } from "./textures";

export interface ViewFrame {
  /** Camera position at the centre of its drift. */
  eye: THREE.Vector3;
  /** Point the camera looks at. */
  target: THREE.Vector3;
  spread: number;
}

const shared = {
  uTime: { value: 0 },
  uWind: { value: 1 },
};

/** Adds wind sway to a standard material (vertex shader only). Taller parts sway more. */
function withSway(material: THREE.MeshStandardMaterial, amount: number, key: string): THREE.MeshStandardMaterial {
  material.onBeforeCompile = (shader) => {
    shader.uniforms["uTime"] = shared.uTime;
    shader.uniforms["uWind"] = shared.uWind;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;\nuniform float uWind;")
      .replace(
        "#include <project_vertex>",
        /* glsl */ `
        vec4 mvPosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
        #endif
        {
          float h = max(mvPosition.y, 0.0);
          float phase = mvPosition.x * 0.13 + mvPosition.z * 0.09;
          float gust = 0.6 + 0.4 * sin(uTime * 0.23 + phase * 0.3);
          float s = ${amount.toFixed(4)} * uWind * gust * h * h;
          mvPosition.x += sin(uTime * 0.9 + phase) * s;
          mvPosition.z += cos(uTime * 0.7 + phase * 1.3) * s * 0.6;
        }
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`,
      );
  };
  material.customProgramCacheKey = () => `tw-sway-${key}`;
  return material;
}

/** Unit bald-cypress trunk (height 1): strongly flared buttress base, gentle taper. */
function trunkGeometry(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    const r = 0.02 * (1 + 2.6 * Math.exp(-t * 16)) * (1 - 0.55 * t);
    pts.push(new THREE.Vector2(r, t - 0.02));
  }
  const g = new THREE.LatheGeometry(pts, 9);
  // Irregular buttresses: push the base out in a few lobes.
  const pos = g.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const a = Math.atan2(z, x);
    const lobe = 1 + 0.35 * Math.max(0, Math.sin(a * 4 + 0.7)) * Math.exp(-Math.max(y, 0) * 18);
    pos.setX(i, x * lobe);
    pos.setZ(i, z * lobe);
  }
  g.computeVertexNormals();
  return g;
}

function branchGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.35, 0.5, 1, 5, 1, true);
  g.translate(0, 0.5, 0); // pivot at the base
  return g;
}

function cardGeometry(pivotTop: boolean): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(1, 1);
  if (pivotTop) g.translate(0, -0.5, 0);
  return g;
}

function lilyGeometry(): THREE.BufferGeometry {
  // A pad with its characteristic notch.
  const g = new THREE.CircleGeometry(1, 18, 0.25, Math.PI * 2 - 0.5);
  g.rotateX(-Math.PI / 2);
  return g;
}

function reedGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([-0.03, 0, 0, 0.03, 0, 0, 0.0, 1, 0.02], 3),
  );
  g.computeVertexNormals();
  return g;
}

interface Batch {
  mesh: THREE.InstancedMesh;
  count: number;
}

function batch(geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number): Batch {
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.count = 0;
  mesh.frustumCulled = false; // instances span the whole world; one bounds test would be wrong
  return { mesh, count: 0 };
}

const MAX_TREES = 340;

export class Foliage {
  readonly root = new THREE.Group();
  private readonly trunks: Batch;
  private readonly branches: Batch;
  private readonly leaves: Batch;
  private readonly moss: Batch;
  private readonly knees: Batch;
  /** Dark root mounds joining each trunk to the water (no tree may look like it floats). */
  private readonly mounds: Batch;
  /** Low understory clumps around tree bases and along the banks, filling the bare-trunk zone. */
  private readonly bushes: Batch;
  private readonly pads: Batch;
  private readonly flowers: Batch;
  private readonly reeds: Batch;
  private readonly textures: THREE.Texture[];
  private layoutKey = "";
  private readonly m = new THREE.Matrix4();
  private readonly m2 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();

  constructor() {
    const leafTex = leafClusterTexture();
    const mossTex = mossTexture();
    this.textures = [leafTex, mossTex];
    const bark = withSway(
      new THREE.MeshStandardMaterial({ color: 0x2b2621, roughness: 1, metalness: 0 }),
      0.00012,
      "bark",
    );
    const leaf = withSway(
      new THREE.MeshStandardMaterial({
        map: leafTex,
        color: 0x8fa682,
        alphaTest: 0.42,
        side: THREE.DoubleSide,
        roughness: 0.95,
      }),
      0.00022,
      "leaf",
    );
    const mossMat = withSway(
      new THREE.MeshStandardMaterial({
        map: mossTex,
        color: 0xc4c8b4,
        alphaTest: 0.3,
        side: THREE.DoubleSide,
        roughness: 1,
      }),
      0.0006,
      "moss",
    );
    const reed = withSway(
      new THREE.MeshStandardMaterial({ color: 0x2c3524, side: THREE.DoubleSide, roughness: 0.9 }),
      0.02,
      "reed",
    );
    const pad = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72, metalness: 0 });
    const flower = new THREE.MeshStandardMaterial({
      color: 0xf4e6ea,
      emissive: 0xf4d6dc,
      emissiveIntensity: 0.35,
      roughness: 0.6,
    });
    this.trunks = batch(trunkGeometry(), bark, MAX_TREES);
    // Capacities: up to 6 branches, 13 clumps x 10 cards and ~26 moss strands per tree.
    this.branches = batch(branchGeometry(), bark, MAX_TREES * 7);
    this.leaves = batch(cardGeometry(false), leaf, MAX_TREES * 130);
    this.moss = batch(cardGeometry(true), mossMat, MAX_TREES * 28);
    this.knees = batch(new THREE.ConeGeometry(0.22, 1, 6, 1), bark, MAX_TREES * 5);
    const mound = new THREE.ConeGeometry(1, 1, 9, 1, true);
    mound.translate(0, 0.5, 0);
    this.mounds = batch(mound, bark, MAX_TREES);
    const bush = withSway(
      new THREE.MeshStandardMaterial({
        map: leafTex,
        color: 0x7c9670,
        alphaTest: 0.42,
        side: THREE.DoubleSide,
        roughness: 0.95,
      }),
      0.004,
      "bush",
    );
    this.bushes = batch(cardGeometry(false), bush, MAX_TREES * 24);
    this.pads = batch(lilyGeometry(), pad, 900);
    this.flowers = batch(new THREE.IcosahedronGeometry(0.16, 0), flower, 60);
    this.reeds = batch(reedGeometry(), reed, 900);
    for (const b of [this.trunks, this.branches, this.leaves, this.moss, this.knees, this.mounds, this.bushes, this.pads, this.flowers, this.reeds]) {
      this.root.add(b.mesh);
    }
  }

  get instanceCount(): number {
    return [this.trunks, this.branches, this.leaves, this.moss, this.knees, this.mounds, this.bushes, this.pads, this.flowers, this.reeds]
      .reduce((n, b) => n + b.count, 0);
  }

  tick(seconds: number, reducedMotion: boolean): void {
    shared.uTime.value = seconds;
    shared.uWind.value = reducedMotion ? 0.15 : 1;
  }

  /** Re-plants only when the archipelago or the camera's base framing changed meaningfully. */
  update(model: WorldModel, view: ViewFrame): void {
    const key = `${model.topologyVersion}|${view.spread.toFixed(2)}|${Math.round(view.eye.x)}|${Math.round(view.eye.z)}|${Math.round(view.target.x)}|${Math.round(view.target.z)}|${params.foliageDensity}`;
    if (key === this.layoutKey || model.islands.size === 0) return;
    this.layoutKey = key;
    this.plant(model, view);
  }

  private plant(model: WorldModel, view: ViewFrame): void {
    for (const b of [this.trunks, this.branches, this.leaves, this.moss, this.knees, this.mounds, this.bushes, this.pads, this.flowers, this.reeds]) {
      b.count = 0;
    }
    const rnd = mulberry32(0x7ee5 + model.topologyVersion);
    const density = params.foliageDensity;
    const R = model.bounds.radius;
    const O = new THREE.Vector3(model.bounds.cx, 0, model.bounds.cz);
    const eye = new THREE.Vector3(view.eye.x, 0, view.eye.z);
    const u = O.clone().sub(eye).setY(0).normalize(); // view axis
    const v = new THREE.Vector3(-u.z, 0, u.x); // lateral
    const d = eye.distanceTo(O);
    const islands = [...model.islands.values()].map((i) => new THREE.Vector2(i.place.x, i.place.z));

    /** True if a tree at (x, z) would sit on an islet or between the camera and one. */
    /**
     * True if a tree at (x, z) would sit on an islet or between the camera and one. `crown` is the
     * tree's crown radius: near the camera the sight lines pass at crown height, so a crown blocks
     * as much as a trunk does.
     */
    const blocked = (x: number, z: number, clearance: number, crown = 0): boolean => {
      for (const isl of islands) {
        if (Math.hypot(x - isl.x, z - isl.y) < clearance) return true;
        // Distance from the tree to the camera->island segment (sight line).
        const ex = eye.x;
        const ez = eye.z;
        const dx = isl.x - ex;
        const dz = isl.y - ez;
        const len2 = dx * dx + dz * dz;
        const t = Math.max(0, Math.min(1, ((x - ex) * dx + (z - ez) * dz) / len2));
        const reach = 2.2 + (t < 0.55 ? crown : 0);
        if (Math.hypot(x - (ex + dx * t), z - (ez + dz * t)) < reach && t < 0.97) return true;
      }
      return false;
    };

    const plantTree = (x: number, z: number, height: number, inward?: THREE.Vector3): void => {
      if (this.trunks.count >= MAX_TREES) return;
      // Never plant the camera inside a crown: keep a horizontal clearance that grows with the tree.
      if (Math.hypot(x - eye.x, z - eye.z) < Math.max(6, height * (inward ? 0.75 : 0.5))) return;
      this.tree(rnd, x, z, height, inward);
      // Root mound: a low dark flare that meets the water, so the trunk is visibly rooted.
      const flare = height * 0.075;
      this.p.set(x, -0.35, z);
      this.q.setFromEuler(this.e.set(0, rnd() * Math.PI, 0));
      this.s.set(flare * (1.2 + rnd() * 0.4), 0.9 + rnd() * 0.6, flare * (1.2 + rnd() * 0.4));
      this.push(this.mounds, this.p, this.q, this.s);
      // Understory around most bases: low leafy clumps that hide the bare lower trunk.
      if (rnd() < 0.8) this.bush(rnd, x, z, height * (0.09 + rnd() * 0.06), 5 + Math.floor(rnd() * 5));
      // Cypress knees poking out around the base.
      const knees = 2 + Math.floor(rnd() * 3);
      for (let k = 0; k < knees && this.knees.count < this.knees.mesh.instanceMatrix.count; k++) {
        const a = rnd() * Math.PI * 2;
        const r = height * (0.08 + rnd() * 0.1);
        this.p.set(x + Math.cos(a) * r, -0.1, z + Math.sin(a) * r);
        this.s.set(1, 0.4 + rnd() * 0.7, 1).multiplyScalar(0.7 + rnd() * 0.6);
        this.q.identity();
        this.push(this.knees, this.p, this.q, this.s);
      }
    };

    // Background wall: beyond the archipelago, dense, tall, disappearing into the mist.
    const wall = Math.round(90 * density);
    for (let i = 0; i < wall; i++) {
      const s = R + 5 + Math.pow(rnd(), 0.7) * (R + 75);
      const l = (rnd() * 2 - 1) * (R + 25 + s * 0.8);
      const x = O.x + u.x * s + v.x * l;
      const z = O.z + u.z * s + v.z * l;
      if (blocked(x, z, 4.5)) continue;
      // Shorter near the view axis so the lit sky shows in the middle; taller toward the sides.
      const off = Math.min(1, Math.abs(l) / (R + 25));
      plantTree(x, z, (7 + Math.pow(rnd(), 0.8) * 11) * (0.7 + 0.7 * off));
    }
    // Far treeline: low, misty, closing the horizon between the trunks (cheap: fog eats detail).
    const far = Math.round(70 * density);
    for (let i = 0; i < far; i++) {
      const s = R + 60 + rnd() * 90;
      const l = (rnd() * 2 - 1) * (R + 40 + s);
      plantTree(O.x + u.x * s + v.x * l, O.z + u.z * s + v.z * l, 6 + rnd() * 7);
    }
    // Side banks hugging the frustum edges, from near the camera to the archipelago.
    const bank = Math.round(70 * density);
    for (let i = 0; i < bank; i++) {
      const s = -d + 3 + rnd() * (d + R + 8);
      const depth = s + d; // distance ahead of the camera along the axis
      const height = 10 + rnd() * 12;
      const crown = height * 0.42;
      // Near the camera the whole crown must stay outside the frustum edge; far away it may overlap
      // the sky (that is what frames the shot).
      const near = 1 - Math.min(1, depth / (d + R));
      const edge = Math.min(depth * view.spread * 0.85 + 1.5 + crown * near, R * 0.95 + 4 + crown * near);
      const side = rnd() < 0.5 ? -1 : 1;
      const l = side * (edge + Math.pow(rnd(), 1.6) * 22);
      const x = O.x + u.x * s + v.x * l;
      const z = O.z + u.z * s + v.z * l;
      if (blocked(x, z, 4.5, crown)) continue;
      plantTree(x, z, height);
    }
    // Understory along the bank shallows, between trunks (fills the gap between crowns and water).
    const shrubs = Math.round(80 * density);
    for (let i = 0; i < shrubs; i++) {
      const s = -d * 0.5 + rnd() * (d + R + 60);
      const depth = s + d;
      const side = rnd() < 0.5 ? -1 : 1;
      const l = side * (Math.min(depth * view.spread * 0.9 + 2, R * 0.95 + 5) + rnd() * 26);
      const x = O.x + u.x * s + v.x * l;
      const z = O.z + u.z * s + v.z * l;
      if (blocked(x, z, 4, 3) || Math.hypot(x - eye.x, z - eye.z) < 8) continue;
      this.bush(rnd, x, z, 1.6 + rnd() * 2.2, 5 + Math.floor(rnd() * 5));
    }
    // Hero trees just ahead of the camera at both frame edges, reaching over the channel.
    // Only in landscape: a narrow portrait frame has no room for framing trees.
    for (const side of view.spread > 0.4 ? [-1, 1] : []) {
      const heroes = 2 + Math.floor(rnd() * 2);
      for (let k = 0; k < heroes; k++) {
        const depth = 5 + k * 7 + rnd() * 4;
        const s = -d + depth;
        const l = side * (depth * view.spread * 1.02 + 1.5 + rnd() * 2.5);
        const x = O.x + u.x * s + v.x * l;
        const z = O.z + u.z * s + v.z * l;
        if (blocked(x, z, 4)) continue;
        plantTree(x, z, 22 + rnd() * 8, v.clone().multiplyScalar(-side));
      }
    }
    // No trees ON islets: with full crowns they hide the structures that identify each service.

    // Lily pads: clusters near islets and along the bank shallows, a scatter in open water.
    const padCluster = (cx: number, cz: number, n: number, spread: number): void => {
      for (let k = 0; k < n && this.pads.count < this.pads.mesh.instanceMatrix.count; k++) {
        const a = rnd() * Math.PI * 2;
        const r = Math.sqrt(rnd()) * spread;
        const x = cx + Math.cos(a) * r;
        const z = cz + Math.sin(a) * r;
        this.p.set(x, 0.015 + rnd() * 0.01, z);
        this.q.setFromEuler(this.e.set(0, rnd() * Math.PI * 2, 0));
        const size = 0.22 + rnd() * 0.3;
        this.s.set(size, 1, size);
        this.c.setHSL(0.26 + rnd() * 0.07, 0.4 + rnd() * 0.2, 0.035 + rnd() * 0.04);
        this.push(this.pads, this.p, this.q, this.s, this.c);
        if (rnd() < 0.05 && this.flowers.count < this.flowers.mesh.instanceMatrix.count) {
          this.p.y = 0.08;
          this.s.set(1, 0.6, 1);
          this.push(this.flowers, this.p, this.q, this.s);
        }
      }
    };
    for (const isl of model.islands.values()) {
      const a = rnd() * Math.PI * 2;
      const r = 2.4 * isl.scale + 1.2;
      padCluster(isl.place.x + Math.cos(a) * r, isl.place.z + Math.sin(a) * r, Math.round(26 * density), 1.6);
    }
    for (let i = 0; i < Math.round(22 * density); i++) {
      const s = -d * 0.6 + rnd() * (d + R);
      const side = rnd() < 0.5 ? -1 : 1;
      const l = side * (Math.min((s + d) * 0.45, R * 0.9) + rnd() * 4);
      padCluster(O.x + u.x * s + v.x * l, O.z + u.z * s + v.z * l, Math.round(14 * density), 2.4);
    }

    // Reeds around islet shores.
    for (const isl of model.islands.values()) {
      const n = Math.round(60 * density);
      for (let k = 0; k < n && this.reeds.count < this.reeds.mesh.instanceMatrix.count; k++) {
        const a = rnd() * Math.PI * 2;
        const r = (1.25 + rnd() * 0.6) * isl.scale;
        this.p.set(isl.place.x + Math.cos(a) * r, -0.05, isl.place.z + Math.sin(a) * r);
        this.q.setFromEuler(this.e.set((rnd() - 0.5) * 0.3, rnd() * Math.PI, (rnd() - 0.5) * 0.3));
        this.s.setScalar(0.7 + rnd() * 0.9);
        this.push(this.reeds, this.p, this.q, this.s);
      }
    }

    for (const b of [this.trunks, this.branches, this.leaves, this.moss, this.knees, this.mounds, this.bushes, this.pads, this.flowers, this.reeds]) {
      b.mesh.count = b.count;
      b.mesh.instanceMatrix.needsUpdate = true;
      if (b.mesh.instanceColor) b.mesh.instanceColor.needsUpdate = true;
    }
  }

  /**
   * One bald cypress. `inward` (optional) is a horizontal direction the crown reaches toward: hero
   * trees at the frame edges lean their branches over the channel, like the reference.
   */
  private tree(rnd: () => number, x: number, z: number, height: number, inward?: THREE.Vector3): void {
    const lean = (rnd() - 0.5) * 0.08;
    const yaw = rnd() * Math.PI * 2;
    this.e.set(lean, yaw, (rnd() - 0.5) * 0.08);
    const treeQ = new THREE.Quaternion().setFromEuler(this.e);
    const treeM = new THREE.Matrix4().compose(new THREE.Vector3(x, -0.2, z), treeQ, new THREE.Vector3(1, 1, 1));
    // Trunk
    this.p.set(x, -0.2, z);
    this.s.setScalar(height);
    this.push(this.trunks, this.p, treeQ, this.s);

    // Crown: clumps concentrated high, flat-topped and a little lopsided, like old bald cypress.
    const clumps: THREE.Vector3[] = [new THREE.Vector3(0, height * 0.97, 0)];
    const nBranches = 4 + Math.floor(rnd() * 3);
    // Tree-local direction of `inward` (undo the tree's yaw).
    const inwardA = inward ? Math.atan2(inward.z, inward.x) + yaw : 0;
    for (let b = 0; b < nBranches; b++) {
      const at = height * (0.3 + rnd() * 0.55);
      const a = inward && b < 3 ? inwardA + (rnd() - 0.5) * 0.9 : rnd() * Math.PI * 2;
      const len = height * (0.18 + rnd() * 0.2) * (inward && b < 3 ? 1.8 : 1);
      const tilt = 0.95 + rnd() * 0.45; // radians from vertical: spreading, nearly horizontal
      const dir = new THREE.Vector3(Math.sin(tilt) * Math.cos(a), Math.cos(tilt), Math.sin(tilt) * Math.sin(a));
      const bq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      this.m2.compose(new THREE.Vector3(0, at, 0), bq, new THREE.Vector3(height * 0.012, len, height * 0.012));
      this.m.multiplyMatrices(treeM, this.m2);
      this.pushMatrix(this.branches, this.m);
      const tip = new THREE.Vector3(0, at, 0).addScaledVector(dir, len);
      clumps.push(tip);
      clumps.push(new THREE.Vector3(0, at, 0).addScaledVector(dir, len * 0.55));
      // Moss hangs from the branch.
      const nMoss = 2 + Math.floor(rnd() * 4);
      for (let k = 0; k < nMoss; k++) {
        const along = 0.35 + rnd() * 0.6;
        const mp = new THREE.Vector3(0, at, 0).addScaledVector(dir, len * along);
        const mq = new THREE.Quaternion().setFromEuler(this.e.set(0, rnd() * Math.PI, 0));
        const mlen = Math.min(height * (0.14 + rnd() * 0.2), 4.2);
        this.m2.compose(mp, mq, new THREE.Vector3(height * (0.06 + rnd() * 0.05), mlen, 1));
        this.m.multiplyMatrices(treeM, this.m2);
        this.pushMatrix(this.moss, this.m);
      }
    }
    for (const c of clumps) {
      const cards = 7 + Math.floor(rnd() * 4);
      const spread = height * 0.085;
      for (let k = 0; k < cards; k++) {
        const cp = c.clone().add(new THREE.Vector3((rnd() - 0.5) * spread * 2, (rnd() - 0.3) * spread * 0.7, (rnd() - 0.5) * spread * 2));
        const cq = new THREE.Quaternion().setFromEuler(this.e.set((rnd() - 0.5) * 0.9, rnd() * Math.PI, (rnd() - 0.5) * 0.5));
        const size = height * (0.11 + rnd() * 0.07);
        this.m2.compose(cp, cq, new THREE.Vector3(size, size * 0.8, size));
        this.m.multiplyMatrices(treeM, this.m2);
        this.pushMatrix(this.leaves, this.m);
      }
    }
  }

  /** A low understory clump of `cards` leaf cards around (x, z), roughly `size` tall. */
  private bush(rnd: () => number, x: number, z: number, size: number, cards: number): void {
    const spread = size * 1.1;
    for (let k = 0; k < cards; k++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * spread;
      this.p.set(x + Math.cos(a) * r, size * (0.35 + rnd() * 0.45), z + Math.sin(a) * r);
      this.q.setFromEuler(this.e.set((rnd() - 0.5) * 0.5, rnd() * Math.PI, (rnd() - 0.5) * 0.3));
      const c = size * (1.1 + rnd() * 0.7);
      this.s.set(c, c * 0.75, c);
      this.push(this.bushes, this.p, this.q, this.s);
    }
  }

  private push(b: Batch, p: THREE.Vector3, q: THREE.Quaternion, s: THREE.Vector3, colour?: THREE.Color): void {
    if (b.count >= b.mesh.instanceMatrix.count) return;
    this.m.compose(p, q, s);
    b.mesh.setMatrixAt(b.count, this.m);
    if (colour) b.mesh.setColorAt(b.count, colour);
    b.count += 1;
  }

  private pushMatrix(b: Batch, m: THREE.Matrix4): void {
    if (b.count >= b.mesh.instanceMatrix.count) return;
    b.mesh.setMatrixAt(b.count, m);
    b.count += 1;
  }

  dispose(): void {
    for (const b of [this.trunks, this.branches, this.leaves, this.moss, this.knees, this.mounds, this.bushes, this.pads, this.flowers, this.reeds]) {
      b.mesh.geometry.dispose();
      (b.mesh.material as THREE.Material).dispose();
      b.mesh.dispose();
    }
    for (const t of this.textures) t.dispose();
  }
}
