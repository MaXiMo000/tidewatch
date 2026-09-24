/**
 * Balanced/Simple swamp trees: ONE instanced low-poly silhouette (flared trunk + two flattened crown
 * blobs), near-black, left to the scene fog to layer into the distance. One draw call for the whole
 * treeline; no textures. Planted in a ring outside the stylised camera's orbit so a tree can never
 * stand between the camera and an island.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { WorldModel } from "./model";

/** A flat-topped bald cypress: flared trunk under an umbrella crown of three offset lumps. */
function treeGeometry(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.035, 0.22, 1, 6, 3);
  trunk.translate(0, 0.5, 0);
  const pos = trunk.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const flare = 1 + 1.6 * Math.exp(-y * 9); // buttressed base
    pos.setX(i, pos.getX(i) * flare);
    pos.setZ(i, pos.getZ(i) * flare);
  }
  const lump = (sx: number, sy: number, sz: number, x: number, y: number, z: number): THREE.BufferGeometry => {
    const g = new THREE.IcosahedronGeometry(1, 0); // 20 triangles: plenty for a silhouette in fog
    g.scale(sx, sy, sz);
    g.translate(x, y, z);
    return g;
  };
  const parts = [
    trunk,
    lump(0.42, 0.1, 0.38, 0.05, 0.97, 0),
    lump(0.3, 0.09, 0.27, -0.2, 0.84, 0.1),
    lump(0.26, 0.08, 0.24, 0.18, 0.72, -0.12),
  ].map((g) => {
    const n = g.toNonIndexed();
    g.dispose();
    return n;
  });
  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  merged.computeVertexNormals();
  return merged;
}

export class Silhouettes {
  readonly mesh: THREE.InstancedMesh;
  private plantedKey = "";
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();

  constructor(capacity = 120) {
    const material = new THREE.MeshLambertMaterial({ color: 0x0c1412, flatShading: true });
    this.mesh = new THREE.InstancedMesh(treeGeometry(), material, capacity);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }

  /** `count` trees in a ring around the archipelago, outside the camera orbit radius `orbit`. */
  update(model: WorldModel, orbit: number, count: number): void {
    const key = `${model.topologyVersion}|${Math.round(orbit)}|${count}`;
    if (key === this.plantedKey || model.islands.size === 0) return;
    this.plantedKey = key;
    const { cx, cz } = model.bounds;
    const n = Math.min(count, this.mesh.instanceMatrix.count);
    let seed = 0x51ee;
    const rnd = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < n; i++) {
      // Scattered in depth (not a ring): a few nearer groves, most far off in the mist.
      const a = rnd() * Math.PI * 2;
      const r = orbit * (1.45 + Math.pow(rnd(), 0.8) * 2.4);
      this.p.set(cx + Math.cos(a) * r, -0.2, cz + Math.sin(a) * r);
      this.q.setFromEuler(this.e.set(0, rnd() * Math.PI * 2, 0));
      const h = 6 + rnd() * 8;
      const w = h * (0.7 + rnd() * 0.5);
      this.s.set(w, h, w * (0.8 + rnd() * 0.3));
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}
