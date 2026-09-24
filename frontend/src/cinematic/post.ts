/**
 * Cinematic frame pipeline (all passes read the HDR scene target + its depth texture):
 *   1. bloom      three's UnrealBloomPass, additively onto the HDR scene (lanterns, glint, flashes)
 *   2. fog        half-res raymarched height fog (noise, HG forward scatter), colour/density follow p95
 *   3. aux        half-res: depth-only ambient occlusion (r) + screen-space light shafts (g): a radial
 *                 blur toward the sun of "open sky here" - shafts only exist where the canopy has gaps
 *   4. dof        half-res blurred copy; the composite mixes it in by distance from the focus plane
 *   5. composite  DOF mix, AO, fog, shafts, exposure (+ lightning flash), ACES, teal/pink grade,
 *                 light chromatic aberration, vignette, fine animated grain, sRGB
 */
import * as THREE from "three";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { params } from "../render/params";
import { GLSL_NOISE } from "./noise";

const fullscreenVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const fogFragment = /* glsl */ `
${GLSL_NOISE}
uniform sampler2D tDepth;
uniform mat4 uProjInv;
uniform mat4 uViewInv;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uFogColor;
uniform float uDensity;
uniform float uHeight;
uniform float uTime;
uniform float uMaxDist;
uniform vec2 uResolution;
varying vec2 vUv;

vec3 worldFromDepth(vec2 uv, float depth) {
  vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 view = uProjInv * clip;
  view /= view.w;
  return (uViewInv * view).xyz;
}

float hg(float cosT, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * 3.14159265 * pow(1.0 + g2 - 2.0 * g * cosT, 1.5));
}

void main() {
  float depth = texture2D(tDepth, vUv).r;
  vec3 target = worldFromDepth(vUv, depth);
  vec3 rayDir = normalize(target - uCamPos);
  float rayLen = depth >= 1.0 ? uMaxDist : min(length(target - uCamPos), uMaxDist);

  const int STEPS = 14;
  float stepLen = rayLen / float(STEPS);
  float jitter = twIgn(gl_FragCoord.xy + fract(uTime * 7.0) * 64.0);
  float cosT = dot(rayDir, uSunDir);
  float phase = hg(cosT, 0.7) * 2.5; // forward scatter toward the low sun
  vec3 lightCol = uFogColor + uSunColor * phase * 0.12;

  float transmittance = 1.0;
  vec3 inscatter = vec3(0.0);
  for (int i = 0; i < STEPS; i++) {
    float t = (float(i) + jitter) * stepLen;
    vec3 pos = uCamPos + rayDir * t;
    float h = max(pos.y, 0.0);
    float base = exp(-h / uHeight);
    vec3 q = pos * 0.045 + vec3(uTime * 0.03, 0.0, uTime * 0.018);
    float billow = 0.45 + 1.1 * twFbm3(q);
    float sigma = uDensity * base * billow;
    float att = exp(-sigma * stepLen);
    inscatter += transmittance * (1.0 - att) * lightCol;
    transmittance *= att;
  }
  gl_FragColor = vec4(inscatter, transmittance);
}
`;

const auxFragment = /* glsl */ `
uniform sampler2D tDepth;
uniform sampler2D tColor;
uniform mat4 uProjInv;
uniform vec2 uSunScreen;
uniform float uSunVisible;
varying vec2 vUv;

float viewZ(vec2 uv) {
  float d = texture2D(tDepth, uv).r;
  vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return v.z / v.w;
}
float ign(vec2 px) { return fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715)))); }

void main() {
  // Ambient occlusion: 8 depth samples in a rotated disk sized by distance.
  float z = viewZ(vUv);
  float ao = 1.0;
  if (z > -300.0) {
    float radius = clamp(1.4 / -z, 0.002, 0.03);
    float rot = ign(gl_FragCoord.xy) * 6.2831;
    float occ = 0.0;
    for (int i = 0; i < 8; i++) {
      float a = rot + float(i) * 0.785398;
      float r = radius * (0.35 + 0.65 * fract(float(i) * 0.618));
      float dz = viewZ(vUv + vec2(cos(a), sin(a)) * r) - z; // > 0: neighbour is nearer
      occ += smoothstep(0.05, 0.4, dz) * (1.0 - smoothstep(1.2, 3.0, dz));
    }
    ao = 1.0 - occ / 8.0 * 0.8;
  }
  // Light shafts: march toward the sun accumulating open-sky (far depth) brightness.
  float shafts = 0.0;
  if (uSunVisible > 0.0) {
    vec2 delta = (uSunScreen - vUv) / 28.0;
    vec2 uv = vUv + delta * ign(gl_FragCoord.xy + 17.0);
    float decay = 1.0;
    for (int i = 0; i < 28; i++) {
      uv += delta;
      if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) break;
      float sky = step(0.99999, texture2D(tDepth, uv).r);
      float lum = dot(texture2D(tColor, uv).rgb, vec3(0.2126, 0.7152, 0.0722));
      shafts += sky * min(lum, 1.2) * decay;
      decay *= 0.94;
    }
    shafts = shafts / 28.0 * uSunVisible * 0.6;
  }
  gl_FragColor = vec4(ao, shafts, 0.0, 1.0);
}
`;

const dofFragment = /* glsl */ `
uniform sampler2D tColor;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec3 c = vec3(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      c += texture2D(tColor, vUv + vec2(float(x), float(y)) * uTexel * 1.5).rgb;
    }
  }
  gl_FragColor = vec4(c / 9.0, 1.0);
}
`;

const compositeFragment = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tFog;
uniform sampler2D tFogDepth;
uniform sampler2D tAux;
uniform sampler2D tDof;
uniform mat4 uProjInv;
uniform vec2 uFogTexel;
uniform float uExposure;
uniform float uFlash;
uniform float uShafts;
uniform vec3 uSunColor;
uniform float uFocus;
uniform float uTime;
uniform float uAspect;
uniform float uGrain;
uniform float uAberration;
varying vec2 vUv;

vec3 rrtOdt(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 aces(vec3 c) {
  const mat3 inM = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 outM = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  return clamp(outM * rrtOdt(inM * c), 0.0, 1.0);
}
vec3 srgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

// Depth-aware 2x2 upsample of the half-res fog (no halos on silhouettes).
vec4 fogAt(vec2 uv, float d) {
  vec4 sum = vec4(0.0);
  float wsum = 0.0;
  for (int y = 0; y < 2; y++) {
    for (int x = 0; x < 2; x++) {
      vec2 o = (vec2(float(x), float(y)) - 0.5) * uFogTexel;
      float fd = texture2D(tFogDepth, uv + o).r;
      float w = 1.0 / (abs(fd - d) * 4000.0 + 0.001);
      sum += texture2D(tFog, uv + o) * w;
      wsum += w;
    }
  }
  return sum / wsum;
}

void main() {
  float d = texture2D(tDepth, vUv).r;
  vec4 v = uProjInv * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  float dist = d >= 1.0 ? 1e4 : -v.z / v.w;

  // Light chromatic aberration toward the frame edges.
  vec2 ca = (vUv - 0.5) * uAberration;
  vec3 c = vec3(texture2D(tColor, vUv + ca).r, texture2D(tColor, vUv).g, texture2D(tColor, vUv - ca).b);
  // Subtle depth of field: the far background softens a little.
  float coc = smoothstep(uFocus * 1.8, uFocus * 4.5, dist) * 0.5;
  c = mix(c, texture2D(tDof, vUv).rgb, coc);

  vec4 aux = texture2D(tAux, vUv);
  c *= aux.r;
  vec4 fog = fogAt(vUv, d);
  c = c * fog.a + fog.rgb;
  c += uSunColor * aux.g * uShafts;

  c *= uExposure * (1.0 + uFlash * 1.1);
  c = aces(c);

  // Grade: teal shadows, warm-pink highlights, a touch more saturation in the mids.
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c += mix(vec3(-0.006, 0.014, 0.012), vec3(0.022, -0.004, 0.01), smoothstep(0.08, 0.75, l));
  c = mix(vec3(l), c, 1.06);
  vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
  c *= 1.0 - smoothstep(0.45, 1.15, length(q)) * 0.5;
  c += (hash(vUv * 1024.0 + fract(uTime * 13.7) * 91.0) - 0.5) * uGrain;
  gl_FragColor = vec4(srgb(clamp(c, 0.0, 1.0)), 1.0);
}
`;

function fullscreenMesh(material: THREE.ShaderMaterial): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  return mesh;
}

function quadMaterial(fragmentShader: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: fullscreenVertex,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
  });
}

export class CinematicPost {
  readonly sceneTarget: THREE.WebGLRenderTarget;
  private readonly fogTarget: THREE.WebGLRenderTarget;
  private readonly fogDepthTarget: THREE.WebGLRenderTarget;
  private readonly auxTarget: THREE.WebGLRenderTarget;
  private readonly dofTarget: THREE.WebGLRenderTarget;
  private readonly fogMaterial: THREE.ShaderMaterial;
  private readonly fogDepthMaterial: THREE.ShaderMaterial;
  private readonly auxMaterial: THREE.ShaderMaterial;
  private readonly dofMaterial: THREE.ShaderMaterial;
  private readonly compositeMaterial: THREE.ShaderMaterial;
  private readonly bloom: UnrealBloomPass;
  private readonly quadScene = new THREE.Scene();
  private readonly quad: THREE.Mesh;
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  /** Fog colour after the latency response, exposed for the scene's own FogExp2. */
  readonly fogColor = new THREE.Color();
  private readonly healthy = new THREE.Color();
  private readonly murky = new THREE.Color(0x6e6452);
  private readonly sunWorld = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();

  constructor() {
    const half = { type: THREE.HalfFloatType, depthBuffer: false } as const;
    this.sceneTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      depthTexture: new THREE.DepthTexture(1, 1, THREE.UnsignedIntType),
    });
    this.fogTarget = new THREE.WebGLRenderTarget(1, 1, half);
    this.fogDepthTarget = new THREE.WebGLRenderTarget(1, 1, half);
    this.auxTarget = new THREE.WebGLRenderTarget(1, 1, half);
    this.dofTarget = new THREE.WebGLRenderTarget(1, 1, half);
    const depthTex = this.sceneTarget.depthTexture;
    this.fogMaterial = quadMaterial(fogFragment, {
      tDepth: { value: depthTex },
      uProjInv: { value: new THREE.Matrix4() },
      uViewInv: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() },
      uSunDir: { value: new THREE.Vector3() },
      uSunColor: { value: new THREE.Color(1.0, 0.8, 0.66) },
      uFogColor: { value: this.fogColor },
      uDensity: { value: 0.04 },
      uHeight: { value: 3 },
      uTime: { value: 0 },
      uMaxDist: { value: 520 },
      uResolution: { value: new THREE.Vector2() },
    });
    this.fogDepthMaterial = quadMaterial(
      /* glsl */ `uniform sampler2D tDepth; varying vec2 vUv;
        void main() { gl_FragColor = vec4(texture2D(tDepth, vUv).r, 0.0, 0.0, 1.0); }`,
      { tDepth: { value: depthTex } },
    );
    this.auxMaterial = quadMaterial(auxFragment, {
      tDepth: { value: depthTex },
      tColor: { value: this.sceneTarget.texture },
      uProjInv: { value: new THREE.Matrix4() },
      uSunScreen: { value: new THREE.Vector2() },
      uSunVisible: { value: 0 },
    });
    this.dofMaterial = quadMaterial(dofFragment, {
      tColor: { value: this.sceneTarget.texture },
      uTexel: { value: new THREE.Vector2() },
    });
    this.compositeMaterial = quadMaterial(compositeFragment, {
      tColor: { value: this.sceneTarget.texture },
      tDepth: { value: depthTex },
      tFog: { value: this.fogTarget.texture },
      tFogDepth: { value: this.fogDepthTarget.texture },
      tAux: { value: this.auxTarget.texture },
      tDof: { value: this.dofTarget.texture },
      uProjInv: { value: new THREE.Matrix4() },
      uFogTexel: { value: new THREE.Vector2() },
      uExposure: { value: 1 },
      uFlash: { value: 0 },
      uShafts: { value: 0.35 },
      uSunColor: { value: new THREE.Color(1.0, 0.78, 0.6) },
      uFocus: { value: 30 },
      uTime: { value: 0 },
      uAspect: { value: 1 },
      uGrain: { value: 0.028 },
      uAberration: { value: 0.0022 },
    });
    // High threshold: only lanterns, windows, the glint and flashes bloom - never the foliage.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.45, 0.4, 2.4);
    this.quad = fullscreenMesh(this.fogMaterial);
    this.quadScene.add(this.quad);
  }

  resize(width: number, height: number, pixelRatio: number): void {
    const w = Math.max(1, Math.round(width * pixelRatio));
    const h = Math.max(1, Math.round(height * pixelRatio));
    this.sceneTarget.setSize(w, h);
    const fw = Math.max(1, Math.round(w / 2));
    const fh = Math.max(1, Math.round(h / 2));
    for (const t of [this.fogTarget, this.fogDepthTarget, this.auxTarget, this.dofTarget]) t.setSize(fw, fh);
    this.bloom.setSize(w, h);
    (this.compositeMaterial.uniforms["uFogTexel"]?.value as THREE.Vector2).set(1 / fw, 1 / fh);
    (this.fogMaterial.uniforms["uResolution"]?.value as THREE.Vector2).set(fw, fh);
    (this.dofMaterial.uniforms["uTexel"]?.value as THREE.Vector2).set(1 / fw, 1 / fh);
    const a = this.compositeMaterial.uniforms["uAspect"];
    if (a) a.value = w / h;
  }

  get gpuBytes(): number {
    const s = this.sceneTarget;
    const f = this.fogTarget;
    // Scene colour + depth, 4 half-res targets, bloom mip chain (~2x a half-res target).
    return s.width * s.height * (8 + 4) + f.width * f.height * 8 * 6;
  }

  /** Fog colour/density follow average latency: calm teal when healthy, murky brown-grey when slow. */
  updateFog(latency: number, sunDir: THREE.Vector3, seconds: number, camera: THREE.PerspectiveCamera): void {
    this.healthy.setHex(params.fogColor);
    this.fogColor.copy(this.healthy).lerp(this.murky, latency * 0.8);
    const u = this.fogMaterial.uniforms;
    if (u["uDensity"]) u["uDensity"].value = params.fogDensity * (1 + 1.6 * latency);
    if (u["uHeight"]) u["uHeight"].value = params.fogHeight * (1 + 0.8 * latency);
    if (u["uTime"]) u["uTime"].value = seconds;
    (u["uSunDir"]?.value as THREE.Vector3).copy(sunDir);
    (u["uProjInv"]?.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
    (u["uViewInv"]?.value as THREE.Matrix4).copy(camera.matrixWorld);
    (u["uCamPos"]?.value as THREE.Vector3).setFromMatrixPosition(camera.matrixWorld);

    // Sun on screen for the shafts (fades out as the sun leaves the view).
    camera.getWorldDirection(this.forward);
    const facing = this.forward.dot(sunDir);
    this.sunWorld.copy(sunDir).multiplyScalar(500).add(camera.position).project(camera);
    const au = this.auxMaterial.uniforms;
    (au["uSunScreen"]?.value as THREE.Vector2).set(this.sunWorld.x * 0.5 + 0.5, this.sunWorld.y * 0.5 + 0.5);
    if (au["uSunVisible"]) au["uSunVisible"].value = THREE.MathUtils.smoothstep(facing, 0.1, 0.5);
    (au["uProjInv"]?.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
    const cu = this.compositeMaterial.uniforms;
    (cu["uProjInv"]?.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
    if (cu["uTime"]) cu["uTime"].value = seconds;
  }

  /** Per-frame look: lightning flash, focus distance; reduced motion keeps the grain nearly still. */
  setLook(flash: number, focus: number, reducedMotion: boolean): void {
    const cu = this.compositeMaterial.uniforms;
    if (cu["uFlash"]) cu["uFlash"].value = flash;
    if (cu["uFocus"]) cu["uFocus"].value = focus;
    if (cu["uShafts"]) cu["uShafts"].value = params.shafts;
    if (cu["uGrain"]) cu["uGrain"].value = reducedMotion ? 0.008 : 0.016;
    this.bloom.strength = params.bloom;
  }

  private pass(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null, renderer: THREE.WebGLRenderer): void {
    this.quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(this.quadScene, this.quadCamera);
  }

  render(renderer: THREE.WebGLRenderer): void {
    this.bloom.render(renderer, this.sceneTarget, this.sceneTarget, 0, false);
    this.pass(this.fogDepthMaterial, this.fogDepthTarget, renderer);
    this.pass(this.fogMaterial, this.fogTarget, renderer);
    this.pass(this.auxMaterial, this.auxTarget, renderer);
    this.pass(this.dofMaterial, this.dofTarget, renderer);
    const exposure = this.compositeMaterial.uniforms["uExposure"];
    if (exposure) exposure.value = params.exposure;
    this.pass(this.compositeMaterial, null, renderer);
  }

  dispose(): void {
    this.sceneTarget.depthTexture?.dispose();
    for (const t of [this.sceneTarget, this.fogTarget, this.fogDepthTarget, this.auxTarget, this.dofTarget]) t.dispose();
    for (const m of [this.fogMaterial, this.fogDepthMaterial, this.auxMaterial, this.dofMaterial, this.compositeMaterial]) {
      m.dispose();
    }
    this.bloom.dispose();
    this.quad.geometry.dispose();
  }
}
