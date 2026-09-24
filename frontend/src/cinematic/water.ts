/**
 * Cinematic water: a real planar reflection (three's Reflector renders the mirrored scene into a
 * half-float target whose size scales with params.reflectionScale), distorted by three scrolling
 * layers of a procedural normal map; Schlick Fresnel against near-black swamp water; a sharp +
 * soft sun/moon glint that stretches into a column on the ripples. Ripples fade with distance so
 * the far water turns into a clean mirror (as in the reference) instead of aliasing.
 */
import * as THREE from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { params } from "../render/params";
import { sunDirection } from "./sky";

const vertexShader = /* glsl */ `
#include <fog_pars_vertex>
uniform mat4 textureMatrix;
varying vec4 vUvRefl;
varying vec3 vWorld;
void main() {
  vUvRefl = textureMatrix * vec4(position, 1.0);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const fragmentShader = /* glsl */ `
#include <fog_pars_fragment>
uniform sampler2D tDiffuse;
uniform sampler2D tNormal;
uniform vec3 color;
uniform vec3 uDeep;
uniform vec3 uTint;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uTime;
uniform float uRipple;
uniform float uGlint;
uniform sampler2D tWake;
uniform vec4 uWakeRect;
uniform vec3 uIslands[16];
uniform int uIslandCount;
uniform float uRain;
varying vec4 vUvRefl;
varying vec3 vWorld;

vec3 layer(vec2 uv) { return texture2D(tNormal, uv).xyz * 2.0 - 1.0; }

void main() {
  vec2 p = vWorld.xz;
  float dist = length(cameraPosition - vWorld);
  // Three drifting layers at different scales/directions, whiteout-blended.
  vec3 n1 = layer(p * 0.045 + vec2(uTime * 0.010, uTime * 0.004));
  vec3 n2 = layer(p * 0.11 + vec2(-uTime * 0.013, uTime * 0.009));
  vec3 n3 = layer(p * 0.33 + vec2(uTime * 0.021, -uTime * 0.017));
  vec3 nt = normalize(vec3(n1.xy + n2.xy * 0.7 + n3.xy * 0.4, n1.z * n2.z * n3.z));
  float near = 1.0 - smoothstep(12.0, 140.0, dist);
  float strength = uRipple * (0.25 + 0.75 * near);
  vec3 n = normalize(vec3(nt.x * strength, 1.0, nt.y * strength));

  // Boat wakes: height field -> slope -> extra ripple normal + foam along fresh trails.
  vec2 wuv = (p - uWakeRect.xy) / uWakeRect.zw + 0.5;
  float foam = 0.0;
  if (all(greaterThan(wuv, vec2(0.0))) && all(lessThan(wuv, vec2(1.0)))) {
    vec2 px = 1.0 / vec2(textureSize(tWake, 0));
    float h = texture2D(tWake, wuv).r;
    float hx = texture2D(tWake, wuv + vec2(px.x, 0.0)).r - texture2D(tWake, wuv - vec2(px.x, 0.0)).r;
    float hz = texture2D(tWake, wuv + vec2(0.0, px.y)).r - texture2D(tWake, wuv - vec2(0.0, px.y)).r;
    n = normalize(n + vec3(-hx, 0.0, -hz) * 6.0);
    foam += smoothstep(0.08, 0.5, h) * 0.55;
  }
  // Shore foam and lapping rings around each islet.
  for (int i = 0; i < 16; i++) {
    if (i >= uIslandCount) break;
    float d = length(p - uIslands[i].xy) - uIslands[i].z;
    float ring = exp(-max(d, 0.0) * 5.0) * step(-0.3, d);
    float lap = 0.5 + 0.5 * sin(d * 9.0 - uTime * 1.6 + uIslands[i].x);
    foam += ring * (0.35 + 0.35 * lap) * (0.6 + 0.4 * n1.x);
  }
  // Rain: dense, fast, fine ripples while a storm is on.
  if (uRain > 0.001) {
    vec3 r1 = layer(p * 1.9 + vec2(uTime * 0.6, -uTime * 0.45));
    vec3 r2 = layer(p * 2.7 - vec2(uTime * 0.5, uTime * 0.7));
    n = normalize(n + vec3(r1.x + r2.x, 0.0, r1.y + r2.y) * 0.18 * uRain);
  }

  vec3 v = normalize(cameraPosition - vWorld);
  float cosT = clamp(dot(n, v), 0.0, 1.0);
  float fresnel = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);

  vec2 uv = vUvRefl.xy / vUvRefl.w + n.xz * 0.018 * (0.3 + near);
  vec3 refl = texture2D(tDiffuse, uv).rgb;

  // Deep swamp water: almost black, faint teal body colour seen at steep angles.
  vec3 body = mix(uDeep, uTint, 0.35 * (1.0 - fresnel));
  vec3 col = mix(body, refl * color, clamp(fresnel * 1.2 + 0.1, 0.0, 1.0));

  // Glint: tight highlight + a wider sheen; ripple normals smear it into a column toward the viewer.
  vec3 r = reflect(-v, n);
  float s = max(dot(r, uSunDir), 0.0);
  col += uSunColor * uGlint * (pow(s, 1400.0) * 5.0 + pow(s, 140.0) * 1.1 + pow(s, 12.0) * 0.05);
  // Foam catches the sky light; kept soft and grey-green so it reads at dusk, not as snow.
  col = mix(col, vec3(0.42, 0.47, 0.44) * (0.55 + 0.45 * fresnel), clamp(foam, 0.0, 0.8) * 0.6);

  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}
`;

export class CinematicWater {
  readonly mesh: Reflector;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private width = 1;
  private height = 1;

  constructor(normalMap: THREE.Texture) {
    const geometry = new THREE.PlaneGeometry(3000, 3000, 1, 1);
    this.mesh = new Reflector(geometry, {
      textureWidth: 512,
      textureHeight: 512,
      clipBias: 0.002,
      multisample: 0,
      color: 0x8fa09a, // reflections darker/greener than the scene (murky water)
      shader: {
        name: "TidewatchWater",
        uniforms: THREE.UniformsUtils.merge([
          THREE.UniformsLib.fog,
          {
            color: { value: null },
            tDiffuse: { value: null },
            textureMatrix: { value: null },
            tNormal: { value: null },
            uDeep: { value: new THREE.Color() },
            uTint: { value: new THREE.Color() },
            uSunDir: { value: new THREE.Vector3() },
            uSunColor: { value: new THREE.Color(1.0, 0.86, 0.74) },
            uTime: { value: 0 },
            uRipple: { value: 0.18 },
            uGlint: { value: 1 },
            tWake: { value: null },
            uWakeRect: { value: new THREE.Vector4(0, 0, 1, 1) },
            uIslands: { value: Array.from({ length: 16 }, () => new THREE.Vector3()) },
            uIslandCount: { value: 0 },
            uRain: { value: 0 },
          },
        ]),
        vertexShader,
        fragmentShader,
      },
    });
    this.mesh.rotateX(-Math.PI / 2);
    const material = this.mesh.material as THREE.ShaderMaterial;
    material.fog = true;
    this.uniforms = material.uniforms;
    const tNormal = this.uniforms["tNormal"];
    if (tNormal) tNormal.value = normalMap;
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.applyScale();
  }

  private scaleApplied = -1;
  private applyScale(): void {
    this.scaleApplied = params.reflectionScale;
    const s = params.reflectionScale;
    this.mesh
      .getRenderTarget()
      .setSize(Math.max(64, Math.round(this.width * s)), Math.max(64, Math.round(this.height * s)));
  }

  get gpuBytes(): number {
    const rt = this.mesh.getRenderTarget();
    return rt.width * rt.height * (8 + 4); // RGBA16F colour + 24/8 depth-stencil
  }

  /** Wake field, islet shore circles (x, z, radius) and rain intensity from the drama layer. */
  setSurface(wake: THREE.Texture, rect: THREE.Vector4, islands: THREE.Vector3[], rain: number): void {
    const u = this.uniforms;
    if (u["tWake"]) u["tWake"].value = wake;
    if (u["uWakeRect"]) u["uWakeRect"].value = rect;
    const list = u["uIslands"]?.value as THREE.Vector3[] | undefined;
    if (list) {
      for (let i = 0; i < 16; i++) {
        const src = islands[i];
        if (src) list[i]?.copy(src);
      }
    }
    if (u["uIslandCount"]) u["uIslandCount"].value = Math.min(16, islands.length);
    if (u["uRain"]) u["uRain"].value = rain;
  }

  tick(seconds: number, camera: THREE.Camera): void {
    if (this.scaleApplied !== params.reflectionScale) this.applyScale();
    const u = this.uniforms;
    (u["uDeep"]?.value as THREE.Color).setHex(params.waterDeep);
    (u["uTint"]?.value as THREE.Color).setHex(params.waterTint);
    sunDirection(u["uSunDir"]?.value as THREE.Vector3);
    if (u["uTime"]) u["uTime"].value = seconds;
    if (u["uRipple"]) u["uRipple"].value = params.rippleStrength;
    if (u["uGlint"]) u["uGlint"].value = params.glint;
    this.mesh.position.set(camera.position.x, 0, camera.position.z);
  }

  dispose(): void {
    this.mesh.dispose();
  }
}
