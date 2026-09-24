/**
 * Requests as boats: one InstancedMesh of small lantern-lit boats sailing each traffic channel,
 * animated entirely on the GPU (per-instance route + phase; the vertex shader computes position,
 * heading, bob and the fade in/out at the docks). CPU cost per frame: one uniform write. Boat
 * count per channel follows its request rate; rebuilt only when topology or rates change bucket.
 *
 * WakeField: a top-down ping-pong render target where every boat stamps a soft splat each frame;
 * a decay + 4-tap diffusion pass turns the stamps into spreading, fading trails. The water shader
 * samples it for ripple normals and foam. The same GLSL computes boat positions in both passes, so
 * the CPU never needs to know where a boat is.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { WorldModel } from "../scene/model";
import { mulberry32 } from "./textures";

const MAX_BOATS = 96;
const SPEED = 1.6; // world units per second

/** Shared GLSL: where is boat i at time t. Uses aRoute (sx, sz, ex, ez) and aParams (phase, rate, lane, seed). */
const BOAT_PATH = /* glsl */ `
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
  readonly time = { value: 0 };
  private key = "";

  constructor() {
    const geometry = boatGeometry();
    this.routes = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BOATS * 4), 4);
    this.params = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BOATS * 4), 4);
    geometry.setAttribute("aRoute", this.routes);
    geometry.setAttribute("aParams", this.params);
    const material = new THREE.MeshStandardMaterial({ color: 0x3a2e26, roughness: 0.8 });
    material.onBeforeCompile = (shader) => {
      shader.uniforms["uTime"] = this.time;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${BOAT_PATH}\nattribute float aGlow;\nvarying float vGlow;`)
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
          vec3 transformed = bRot * (position * 1.7 * bFade) + bPos + vec3(0.0, bob, 0.0);
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
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }

  get count(): number {
    return this.mesh.count;
  }

  /** Rebuild routes when topology or a channel's rate bucket changes (not per frame). */
  update(model: WorldModel, budget: number): void {
    let maxRps = 1;
    for (const e of model.edges) maxRps = Math.max(maxRps, e.targetRps);
    const perEdge = model.edges.map((e) => Math.max(1, Math.round((e.targetRps / maxRps) * 5)));
    const key = `${model.topologyVersion}|${perEdge.join(",")}|${budget}`;
    if (key === this.key) return;
    this.key = key;
    const rnd = mulberry32(0xb0a7 + model.topologyVersion);
    let n = 0;
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
      }
    });
    this.mesh.count = n;
    this.routes.needsUpdate = true;
    this.params.needsUpdate = true;
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

const quadVertex = /* glsl */ `
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/** Top-down ping-pong wake/ripple field sampled by the water shader. */
export class WakeField {
  /** Latest field; red = wake height (0..~1). */
  get texture(): THREE.Texture {
    return this.targets[this.current]?.texture ?? this.empty;
  }
  /** xz centre and size of the square the field covers. */
  readonly rect = new THREE.Vector4(0, 0, 80, 80);
  private readonly targets: THREE.WebGLRenderTarget[];
  private current = 0;
  private readonly empty = new THREE.Texture();
  private readonly decay: THREE.ShaderMaterial;
  private readonly splat: THREE.ShaderMaterial;
  private readonly quadScene = new THREE.Scene();
  private readonly quad: THREE.Mesh;
  private readonly splatScene = new THREE.Scene();
  private readonly splatMesh: THREE.InstancedMesh;
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  constructor(boats: Boats, size = 512) {
    const opts = { type: THREE.HalfFloatType, depthBuffer: false } as const;
    this.targets = [new THREE.WebGLRenderTarget(size, size, opts), new THREE.WebGLRenderTarget(size, size, opts)];
    this.decay = new THREE.ShaderMaterial({
      vertexShader: quadVertex,
      fragmentShader: /* glsl */ `
        uniform sampler2D tPrev; uniform float uKeep; uniform vec2 uTexel; varying vec2 vUv;
        void main() {
          float c = texture2D(tPrev, vUv).r;
          float n = texture2D(tPrev, vUv + vec2(uTexel.x, 0.0)).r + texture2D(tPrev, vUv - vec2(uTexel.x, 0.0)).r
                  + texture2D(tPrev, vUv + vec2(0.0, uTexel.y)).r + texture2D(tPrev, vUv - vec2(0.0, uTexel.y)).r;
          gl_FragColor = vec4(mix(c, n * 0.25, 0.35) * uKeep, 0.0, 0.0, 1.0);
        }`,
      uniforms: { tPrev: { value: null }, uKeep: { value: 0.97 }, uTexel: { value: new THREE.Vector2(1 / size, 1 / size) } },
      depthTest: false,
      depthWrite: false,
    });
    const quadGeo = new THREE.BufferGeometry();
    quadGeo.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.quad = new THREE.Mesh(quadGeo, this.decay);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    // Splats reuse the boats' per-instance attributes and path GLSL.
    const splatGeo = new THREE.PlaneGeometry(1, 1);
    splatGeo.setAttribute("aRoute", boats.routes);
    splatGeo.setAttribute("aParams", boats.params);
    this.splat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        ${BOAT_PATH}
        uniform vec4 uRect;
        varying vec2 vLocal;
        void main() {
          vec2 dir; float fade;
          vec3 p = boatPath(dir, fade);
          vFade = fade;
          vLocal = position.xy;
          // Stretch along the heading: an elongated stamp reads as a wake, not a dot.
          vec2 side = vec2(-dir.y, dir.x);
          vec2 w = p.xz + side * position.x * 0.9 + dir * position.y * 1.6;
          vec2 ndc = (w - uRect.xy) / (uRect.zw * 0.5);
          gl_Position = vec4(ndc.x, ndc.y, 0.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uStrength; varying vec2 vLocal; varying float vFade;
        void main() {
          float r = length(vLocal * 2.0);
          float a = (1.0 - smoothstep(0.2, 1.0, r)) * uStrength * vFade;
          gl_FragColor = vec4(a, 0.0, 0.0, 1.0);
        }`,
      uniforms: { uTime: boats.time, uRect: { value: this.rect }, uStrength: { value: 0.08 } },
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.splatMesh = new THREE.InstancedMesh(splatGeo, this.splat, 96);
    this.splatMesh.frustumCulled = false;
    this.splatScene.add(this.splatMesh);
    this.boats = boats;
  }
  private readonly boats: Boats;

  get gpuBytes(): number {
    const t = this.targets[0];
    return t ? t.width * t.height * 8 * 2 : 0;
  }

  fit(model: WorldModel): void {
    const size = (model.bounds.radius + 8) * 2;
    this.rect.set(model.bounds.cx, model.bounds.cz, size, size);
  }

  update(renderer: THREE.WebGLRenderer, dt: number): void {
    const prev = this.targets[this.current];
    const next = this.targets[1 - this.current];
    if (!prev || !next) return;
    const prevTarget = renderer.getRenderTarget();
    const u = this.decay.uniforms;
    if (u["tPrev"]) u["tPrev"].value = prev.texture;
    // Frame-rate independent fade: ~3.5 s half-life.
    if (u["uKeep"]) u["uKeep"].value = Math.pow(0.5, dt / 3.5);
    renderer.setRenderTarget(next);
    renderer.render(this.quadScene, this.cam);
    this.splatMesh.count = this.boats.count;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.splatScene, this.cam);
    renderer.autoClear = autoClear;
    renderer.setRenderTarget(prevTarget);
    this.current = 1 - this.current;
  }

  dispose(): void {
    for (const t of this.targets) t.dispose();
    this.decay.dispose();
    this.splat.dispose();
    this.quad.geometry.dispose();
    this.splatMesh.geometry.dispose();
  }
}
