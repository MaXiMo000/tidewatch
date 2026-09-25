/**
 * Requests as boats: one InstancedMesh of small lantern-lit boats sailing each traffic channel,
 * animated entirely on the GPU (per-instance route + phase; the vertex shader computes position,
 * heading, bob and the fade in/out at the docks). CPU cost per frame: one uniform write. Boat
 * count per channel follows its request rate; rebuilt only when topology or rates change bucket.
 * Shared by every tier (Cinematic adds wakes: cinematic/boats.ts).
 *
 * Errors sink boats (M3): each boat carries its destination's sink share (weather-rules.ts
 * sinkShare(errorRate)); on each lap a boat whose per-lap hash falls under it settles, tilts and
 * goes down over the last part of the channel instead of docking. Deterministic, all on the GPU.
 */
import * as THREE from "three";
import { pinPositionAttribute } from "./instancing";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { WorldModel } from "./model";
import { mulberry32 } from "./random";
import { sinkShare } from "./weather-rules";

const MAX_BOATS = 96;
const SPEED = 1.6; // world units per second

/** Shared GLSL: where is boat i at time t. Uses aRoute (sx, sz, ex, ez) and aParams (phase, rate, lane, seed). */
export const BOAT_PATH = /* glsl */ `
uniform float uTime;
attribute vec4 aRoute;
attribute vec4 aParams;
varying float vFade;
vec3 boatPath(out vec2 dir, out float fade) {
  vec2 a = aRoute.xy;
  vec2 b = aRoute.zw;
  vec2 d = b - a;
  float len = max(length(d), 0.001);
  dir = d / len;
  float t = fract(aParams.x + uTime * aParams.y);
  fade = smoothstep(0.0, 0.07, t) * (1.0 - smoothstep(0.93, 1.0, t));
  vec2 side = vec2(-dir.y, dir.x);
  // A gentle S-curve so boats do not travel on a ruler line.
  vec2 p = a + d * t + side * (aParams.z + sin(t * 3.14159 * 2.0 + aParams.w) * 0.25);
  return vec3(p.x, 0.0, p.y);
}
`;

function boatGeometry(): THREE.BufferGeometry {
  const hull = new THREE.BoxGeometry(0.42, 0.16, 1.2, 1, 1, 2);
  const pos = hull.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    const y = pos.getY(i);
    // Taper the bow (+z) and narrow the keel: reads as a boat, not a brick.
    if (z > 0.1) pos.setX(i, pos.getX(i) * (1 - (z - 0.1) * 1.4));
    if (y < 0) pos.setX(i, pos.getX(i) * 0.75);
  }
  hull.translate(0, 0.06, 0);
  const cabin = new THREE.BoxGeometry(0.3, 0.2, 0.38);
  cabin.translate(0, 0.24, -0.18);
  const lamp = new THREE.BoxGeometry(0.07, 0.09, 0.07);
  lamp.translate(0, 0.42, -0.15);
  const bowLamp = new THREE.BoxGeometry(0.05, 0.05, 0.05);
  bowLamp.translate(0, 0.2, 0.5);
  const parts = [hull, cabin, lamp, bowLamp].map((g, i) => {
    const n = g.toNonIndexed();
    g.dispose();
    const glow = new Float32Array(n.getAttribute("position").count).fill(i >= 2 ? 1 : 0);
    n.setAttribute("aGlow", new THREE.BufferAttribute(glow, 1));
    n.deleteAttribute("uv");
    return n;
  });
  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error("boat geometry");
  merged.computeVertexNormals();
  return merged;
}

export class Boats {
  readonly mesh: THREE.InstancedMesh;
  readonly routes: THREE.InstancedBufferAttribute;
  readonly params: THREE.InstancedBufferAttribute;
  readonly sink: THREE.InstancedBufferAttribute;
  readonly time = { value: 0 };
  private key = "";
  /** Destination island of each boat, for the sink share. */
  private dest: string[] = [];

  constructor() {
    const geometry = boatGeometry();
    this.routes = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BOATS * 4), 4);
    this.params = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BOATS * 4), 4);
    geometry.setAttribute("aRoute", this.routes);
    geometry.setAttribute("aParams", this.params);
    this.sink = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BOATS), 1);
    this.sink.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("aSink", this.sink);
    const material = new THREE.MeshStandardMaterial({ color: 0x3a2e26, roughness: 0.8 });
    material.onBeforeCompile = (shader) => {
      shader.uniforms["uTime"] = this.time;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${BOAT_PATH}\nattribute float aGlow;\nattribute float aSink;\nvarying float vGlow;`)
        .replace(
          "#include <beginnormal_vertex>",
          /* glsl */ `
          vec2 bDir; float bFade;
          vec3 bPos = boatPath(bDir, bFade);
          float bYaw = atan(bDir.x, bDir.y);
          mat3 bRot = mat3(cos(bYaw), 0.0, -sin(bYaw), 0.0, 1.0, 0.0, sin(bYaw), 0.0, cos(bYaw));
          vec3 objectNormal = bRot * normal;`,
        )
        .replace(
          "#include <begin_vertex>",
          /* glsl */ `
          float bob = sin(uTime * 2.1 + aParams.w * 7.0) * 0.025;
          // Sinking (errors): this lap's hash under the destination's sink share -> go down.
          float bLap = floor(aParams.x + uTime * aParams.y);
          float bT = fract(aParams.x + uTime * aParams.y);
          float bSinks = step(fract(sin(bLap * 12.9898 + aParams.w * 78.233) * 43758.5453), aSink);
          float bDown = bSinks * smoothstep(0.55, 0.9, bT);
          bFade *= 1.0 - bDown * smoothstep(0.75, 0.93, bT);
          float bTilt = bDown * 0.7;
          mat3 bPitch = mat3(1.0, 0.0, 0.0, 0.0, cos(bTilt), sin(bTilt), 0.0, -sin(bTilt), cos(bTilt));
          vec3 transformed = bRot * (bPitch * position * 1.7 * bFade) + bPos + vec3(0.0, bob - bDown * 0.7, 0.0);
          vGlow = aGlow;
          vFade = bFade;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying float vGlow;\nvarying float vFade;")
        .replace(
          "#include <emissivemap_fragment>",
          "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.62, 0.3) * vGlow * 14.0 * vFade;",
        );
    };
    material.customProgramCacheKey = () => "tw-boat";
    this.mesh = new THREE.InstancedMesh(geometry, material, MAX_BOATS);
    pinPositionAttribute(material);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }

  get count(): number {
    return this.mesh.count;
  }

  /** Rebuild routes when topology or a channel's rate bucket changes (not per frame). */
  update(model: WorldModel, budget: number): void {
    this.rebuild(model, budget);
    // Sink shares follow the destinations' error rates; written only when one really changes.
    let dirty = false;
    for (let i = 0; i < this.mesh.count; i++) {
      const share = sinkShare(model.islands.get(this.dest[i] ?? "")?.errorRate ?? 0);
      if (Math.abs(share - (this.sink.getX(i) ?? 0)) > 0.01) {
        this.sink.setX(i, share);
        dirty = true;
      }
    }
    if (dirty) this.sink.needsUpdate = true;
  }

  private rebuild(model: WorldModel, budget: number): void {
    let maxRps = 1;
    for (const e of model.edges) maxRps = Math.max(maxRps, e.targetRps);
    // No traffic (e.g. to an offline app): an empty channel, no boats.
    const perEdge = model.edges.map((e) =>
      e.targetRps > 0 ? Math.max(1, Math.round((e.targetRps / maxRps) * 5)) : 0,
    );
    const key = `${model.topologyVersion}|${perEdge.join(",")}|${budget}`;
    if (key === this.key) return;
    this.key = key;
    const rnd = mulberry32(0xb0a7 + model.topologyVersion);
    let n = 0;
    this.dest = [];
    model.edges.forEach((e, i) => {
      const a = model.islands.get(e.src);
      const b = model.islands.get(e.dst);
      if (!a || !b) return;
      const dx = b.place.x - a.place.x;
      const dz = b.place.z - a.place.z;
      const len = Math.hypot(dx, dz);
      if (len < 3) return;
      // Leave from / arrive at the islet shore, not its centre.
      const ra = 1.7 * (0.95 + 0.4 * a.scale);
      const rb = 1.7 * (0.95 + 0.4 * b.scale);
      const ux = dx / len;
      const uz = dz / len;
      const sx = a.place.x + ux * ra;
      const sz = a.place.z + uz * ra;
      const ex = b.place.x - ux * rb;
      const ez = b.place.z - uz * rb;
      const count = Math.min(perEdge[i] ?? 1, Math.max(1, Math.floor(budget / Math.max(1, model.edges.length))));
      const travel = Math.hypot(ex - sx, ez - sz);
      for (let k = 0; k < count && n < MAX_BOATS; k++, n++) {
        this.routes.setXYZW(n, sx, sz, ex, ez);
        this.params.setXYZW(n, k / count + rnd() * 0.1, SPEED / travel, (rnd() - 0.5) * 0.6, rnd() * 6.28);
        this.dest[n] = e.dst;
        this.sink.setX(n, sinkShare(b.errorRate));
      }
    });
    this.mesh.count = n;
    this.routes.needsUpdate = true;
    this.params.needsUpdate = true;
    this.sink.needsUpdate = true;
  }

  tick(seconds: number): void {
    this.time.value = seconds;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}

