/**
 * WakeField (Cinematic only): a top-down ping-pong render target where every boat stamps a soft
 * splat each frame; a decay + 4-tap diffusion pass turns the stamps into spreading, fading trails.
 * The water shader samples it for ripple normals and foam. It reuses the boats' per-instance
 * attributes and path GLSL, so the CPU never needs to know where a boat is.
 */
import * as THREE from "three";
import { pinPositionAttribute } from "../scene/instancing";
import { BOAT_PATH, type Boats } from "../scene/boats";
import type { WorldModel } from "../scene/model";

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
    pinPositionAttribute(this.splat);
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
