/**
 * Cinematic frame pipeline:
 *   1. scene -> HDR half-float target with a depth texture
 *   2. volumetric height fog at HALF resolution: a short jittered raymarch per pixel through
 *      exp(-height) fog modulated by drifting 3D noise, Henyey-Greenstein forward scattering toward
 *      the low sun; stores in-scattered light (rgb) and transmittance (a)
 *   3. composite at full resolution: depth-aware upsample of the fog, apply it, exposure, ACES
 *      filmic tone mapping, a light teal/pink split-tone grade and the sRGB transfer.
 * Round 3 adds bloom, DOF, AO, grain and chromatic aberration to step 3.
 */
import * as THREE from "three";
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

const compositeFragment = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tFog;
uniform sampler2D tFogDepth;
uniform vec2 uFogTexel;
uniform float uExposure;
varying vec2 vUv;

// ACES filmic (Stephen Hill's RRT+ODT fit), input linear, output linear display-referred.
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

// Depth-aware 2x2 upsample: prefer half-res fog texels at a similar depth (no halos on silhouettes).
vec4 fogAt(vec2 uv) {
  float d = texture2D(tDepth, uv).r;
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
  vec3 c = texture2D(tColor, vUv).rgb;
  vec4 fog = fogAt(vUv);
  c = c * fog.a + fog.rgb;
  c *= uExposure;
  c = aces(c);
  // Split tone: teal in the shadows, a touch of pink in the highlights.
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c += mix(vec3(-0.004, 0.012, 0.010), vec3(0.020, -0.006, 0.008), smoothstep(0.1, 0.8, l));
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

export class CinematicPost {
  readonly sceneTarget: THREE.WebGLRenderTarget;
  private readonly fogTarget: THREE.WebGLRenderTarget;
  private readonly fogMaterial: THREE.ShaderMaterial;
  private readonly compositeMaterial: THREE.ShaderMaterial;
  private readonly fogDepthMaterial: THREE.ShaderMaterial;
  private readonly fogDepthTarget: THREE.WebGLRenderTarget;
  private readonly quadScene = new THREE.Scene();
  private readonly quad: THREE.Mesh;
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  /** Fog colour after the latency response, exposed for the scene's own FogExp2. */
  readonly fogColor = new THREE.Color();
  private readonly healthy = new THREE.Color();
  private readonly murky = new THREE.Color(0x6e6452);

  constructor() {
    this.sceneTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      depthTexture: new THREE.DepthTexture(1, 1, THREE.UnsignedIntType),
    });
    this.fogTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.fogDepthTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    const depthTex = this.sceneTarget.depthTexture;
    this.fogMaterial = new THREE.ShaderMaterial({
      vertexShader: fullscreenVertex,
      fragmentShader: fogFragment,
      depthTest: false,
      depthWrite: false,
      uniforms: {
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
      },
    });
    // Copies scene depth at fog resolution so the composite can compare depths when upsampling.
    this.fogDepthMaterial = new THREE.ShaderMaterial({
      vertexShader: fullscreenVertex,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDepth; varying vec2 vUv;
        void main() { gl_FragColor = vec4(texture2D(tDepth, vUv).r, 0.0, 0.0, 1.0); }`,
      depthTest: false,
      depthWrite: false,
      uniforms: { tDepth: { value: depthTex } },
    });
    this.compositeMaterial = new THREE.ShaderMaterial({
      vertexShader: fullscreenVertex,
      fragmentShader: compositeFragment,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tColor: { value: this.sceneTarget.texture },
        tDepth: { value: depthTex },
        tFog: { value: this.fogTarget.texture },
        tFogDepth: { value: this.fogDepthTarget.texture },
        uFogTexel: { value: new THREE.Vector2() },
        uExposure: { value: 1 },
      },
    });
    this.quad = fullscreenMesh(this.fogMaterial);
    this.quadScene.add(this.quad);
  }

  resize(width: number, height: number, pixelRatio: number): void {
    const w = Math.max(1, Math.round(width * pixelRatio));
    const h = Math.max(1, Math.round(height * pixelRatio));
    this.sceneTarget.setSize(w, h);
    const fw = Math.max(1, Math.round(w / 2));
    const fh = Math.max(1, Math.round(h / 2));
    this.fogTarget.setSize(fw, fh);
    this.fogDepthTarget.setSize(fw, fh);
    (this.compositeMaterial.uniforms["uFogTexel"]?.value as THREE.Vector2).set(1 / fw, 1 / fh);
    (this.fogMaterial.uniforms["uResolution"]?.value as THREE.Vector2).set(fw, fh);
  }

  get gpuBytes(): number {
    const s = this.sceneTarget;
    const f = this.fogTarget;
    return s.width * s.height * (8 + 4) + f.width * f.height * 8 * 2;
  }

  /** Fog colour/density follow average latency: calm teal when healthy, murky brown-grey when slow. */
  updateFog(latency: number, sunDir: THREE.Vector3, seconds: number, camera: THREE.Camera): void {
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
  }

  render(renderer: THREE.WebGLRenderer): void {
    this.quad.material = this.fogDepthMaterial;
    renderer.setRenderTarget(this.fogDepthTarget);
    renderer.render(this.quadScene, this.quadCamera);
    this.quad.material = this.fogMaterial;
    renderer.setRenderTarget(this.fogTarget);
    renderer.render(this.quadScene, this.quadCamera);
    const exposure = this.compositeMaterial.uniforms["uExposure"];
    if (exposure) exposure.value = params.exposure;
    this.quad.material = this.compositeMaterial;
    renderer.setRenderTarget(null);
    renderer.render(this.quadScene, this.quadCamera);
  }

  dispose(): void {
    this.sceneTarget.depthTexture?.dispose();
    this.sceneTarget.dispose();
    this.fogTarget.dispose();
    this.fogDepthTarget.dispose();
    this.fogMaterial.dispose();
    this.fogDepthMaterial.dispose();
    this.compositeMaterial.dispose();
    this.quad.geometry.dispose();
  }
}
