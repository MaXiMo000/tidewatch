/**
 * Traffic channels for the stylised (Balanced/Simple) path: one LineSegments for every edge,
 * brightness following the edge's eased request rate. Islands, boats and trees are the shared
 * modules (scene/islands.ts, scene/boats.ts, scene/silhouettes.ts).
 */
import * as THREE from "three";
import type { WorldModel } from "./model";
import { PALETTE } from "./palette";

export class Channels {
  readonly root = new THREE.Group();
  private readonly material = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
  });
  private lines: THREE.LineSegments | null = null;
  private builtVersion = -1;
  private readonly tmp = new THREE.Color();
  private readonly base = new THREE.Color(PALETTE.channel);

  constructor(private readonly model: WorldModel) {}

  update(): void {
    if (this.model.topologyVersion !== this.builtVersion) this.rebuild();
    const attr = this.lines?.geometry.getAttribute("color");
    if (!(attr instanceof THREE.BufferAttribute)) return;
    let max = 1;
    for (const e of this.model.edges) max = Math.max(max, e.rps);
    this.model.edges.forEach((e, i) => {
      this.tmp.copy(this.base).multiplyScalar(0.25 + 0.75 * Math.sqrt(e.rps / max));
      attr.setXYZ(i * 2, this.tmp.r, this.tmp.g, this.tmp.b);
      attr.setXYZ(i * 2 + 1, this.tmp.r, this.tmp.g, this.tmp.b);
    });
    attr.needsUpdate = true;
  }

  private rebuild(): void {
    this.builtVersion = this.model.topologyVersion;
    if (this.lines) {
      this.root.remove(this.lines);
      this.lines.geometry.dispose();
      this.lines = null;
    }
    const edges = this.model.edges;
    if (edges.length === 0) return;
    const positions = new Float32Array(edges.length * 6);
    edges.forEach((e, i) => {
      const a = this.model.islands.get(e.src)?.place;
      const b = this.model.islands.get(e.dst)?.place;
      if (a && b) positions.set([a.x, 0.05, a.z, b.x, 0.05, b.z], i * 6);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(edges.length * 6), 3));
    this.lines = new THREE.LineSegments(geometry, this.material);
    this.root.add(this.lines);
  }

  dispose(): void {
    this.lines?.geometry.dispose();
    this.material.dispose();
  }
}
