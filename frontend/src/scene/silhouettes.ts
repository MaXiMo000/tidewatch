/**
 * Balanced/Simple swamp trees: ONE instanced low-poly silhouette (flared trunk + two flattened crown
 * blobs), near-black, left to the scene fog to layer into the distance. One draw call for the whole
 * treeline; no textures. Planted in a ring outside the stylised camera's orbit so a tree can never
 * stand between the camera and an island.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { WorldModel } from "./model";

function treeGeometry(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.07, 0.4, 1, 6, 1);
  trunk.translate(0, 0.5, 0);
  const crownA = new THREE.IcosahedronGeometry(1, 0);
  crownA.scale(0.5, 0.15, 0.45);
  crownA.translate(0.06, 0.97, 0);
  const crownB = new THREE.IcosahedronGeometry(1, 0);
  crownB.scale(0.34, 0.12, 0.3);
  crownB.translate(-0.16, 0.8, 0.08);
  const merged = mergeGeometries([trunk.toNonIndexed(), crownA.toNonIndexed(), crownB.toNonIndexed()]);
  trunk.dispose();
  crownA.dispose();
  crownB.dispose();
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
      const a = (i / n) * Math.PI * 2 + rnd() * 0.12;
      const r = orbit * (1.5 + Math.pow(rnd(), 0.6) * 1.9);
      this.p.set(cx + Math.cos(a) * r, -0.2, cz + Math.sin(a) * r);
      this.q.setFromEuler(this.e.set(0, rnd() * Math.PI * 2, 0));
      const h = 5 + rnd() * 7;
      this.s.set(h * (0.35 + rnd() * 0.25), h, h * (0.35 + rnd() * 0.25));
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
