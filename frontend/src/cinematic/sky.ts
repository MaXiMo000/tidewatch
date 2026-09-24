/**
 * Cinematic sky: HDR (linear, values > 1 near the sun) dusk gradient, a low sun/moon behind broken
 * clouds, and fbm clouds on a virtual plane, lit from below and from the sun side. The same shader
 * is rendered into a PMREM environment so PBR materials pick up the dusk light.
 */
import * as THREE from "three";
import { params } from "../render/params";
import { GLSL_NOISE } from "./noise";

const vertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

const fragmentShader = /* glsl */ `
${GLSL_NOISE}
uniform vec3 uZenith;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec3 uCloudLight;
uniform vec3 uCloudShadow;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uCover;
uniform float uTime;
uniform float uStorm;
uniform float uFlash;
varying vec3 vDir;

vec3 skyColour(vec3 d) {
  float h = d.y;
  float sunAmt = max(dot(d, uSunDir), 0.0);
  // Horizon glow is wider toward the sun: the classic dusk asymmetry.
  float glowWidth = mix(0.05, 0.22, pow(sunAmt, 2.0));
  vec3 c = mix(uHorizon, uMid, smoothstep(0.0, glowWidth, h));
  c = mix(c, uZenith, smoothstep(0.12, 0.7, h));
  c += uSunColor * (smoothstep(0.99994, 0.99997, sunAmt) * 3.2 + pow(sunAmt, 3000.0) * 0.2 + pow(sunAmt, 60.0) * 0.12 + pow(sunAmt, 5.0) * 0.12);
  return c;
}

void main() {
  vec3 d = normalize(vDir);
  vec3 col = skyColour(d);

  if (d.y > 0.0) {
    // Clouds on a plane: perspective from 1/y, drifting slowly.
    vec2 p = d.xz / (d.y + 0.06) * 0.9 + vec2(uTime * 0.006, uTime * 0.002);
    // Large masses shaped by a slow low-frequency field, detail from the fbm.
    float n = twFbm2(p * 1.3) * 0.75 + twNoise2(p * 0.35 + 3.1) * 0.35;
    float cover = clamp(uCover + uStorm * 0.35, 0.0, 1.0);
    float density = smoothstep(1.0 - cover, 1.0 - cover + 0.32, n);
    // Thinner towards the horizon haze.
    density *= smoothstep(0.0, 0.10, d.y);
    float sunAmt = max(dot(d, uSunDir), 0.0);
    // Lit from below by a low sun: undersides warm near the sun, violet-grey away from it.
    float thin = 1.0 - density;
    // Undersides lit by a sun just below the clouds: strong near the sun, fading fast away from it;
    // a lower band near the horizon catches the glow from all directions.
    float light = 1.35 * pow(sunAmt, 8.0) + 0.22 * (1.0 - smoothstep(0.02, 0.2, d.y));
    light *= 0.2 + 0.8 * thin * thin; // thick cores stay dark, thin parts catch the light
    // Self-shadowing hint: sample the density a little toward the sun.
    float toward = twFbm2((p + normalize(uSunDir.xz + 1e-4) * 0.25) * 1.3);
    light *= 1.0 - 0.45 * smoothstep(0.4, 0.8, toward);
    vec3 cloud = mix(uCloudShadow, uCloudLight, clamp(light, 0.0, 1.0));
    // Silver lining: thin cloud edges facing the sun glow.
    float edge = density * (1.0 - density) * 4.0;
    cloud += uSunColor * edge * pow(sunAmt, 6.0) * 1.4;
    // Storm (M3 hook): darker, heavier clouds.
    cloud = mix(cloud, uCloudShadow * 0.45, uStorm * 0.7);
    // Lightning lights the cloud bodies from inside, cold white-violet.
    cloud += vec3(0.75, 0.78, 1.0) * uFlash * (0.4 + density) * 1.6;
    // Low haze band: sky and far water meet in the same soft glow instead of a hard line.
    col = mix(col, cloud, density * 0.96);
  }
  col = mix(col, uHorizon * 0.55 + uCloudShadow * 0.45, (1.0 - smoothstep(-0.01, 0.035, d.y)) * 0.6);
  gl_FragColor = vec4(col, 1.0);
}
`;

/** Azimuth of the camera's base view; the sun is placed relative to it (see params). */
let viewAzimuth = 0;
export function setViewAzimuth(radians: number): void {
  viewAzimuth = radians;
}

export function sunDirection(target: THREE.Vector3): THREE.Vector3 {
  const el = THREE.MathUtils.degToRad(params.sunElevationDeg);
  const az = viewAzimuth + THREE.MathUtils.degToRad(params.sunAzimuthDeg);
  return target.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
}

export class CinematicSky {
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  readonly material: THREE.ShaderMaterial;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uZenith: { value: new THREE.Color() },
        uMid: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uCloudLight: { value: new THREE.Color() },
        uCloudShadow: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3() },
        uSunColor: { value: new THREE.Color(1.0, 0.86, 0.74) },
        uCover: { value: 0.6 },
        uTime: { value: 0 },
        uStorm: { value: 0 },
        uFlash: { value: 0 },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    this.syncParams();
  }

  /** Copies tunable params into uniforms (cheap; called every frame). */
  syncParams(): void {
    const u = this.material.uniforms;
    (u["uZenith"]?.value as THREE.Color).setHex(params.skyZenith);
    (u["uMid"]?.value as THREE.Color).setHex(params.skyMid);
    (u["uHorizon"]?.value as THREE.Color).setHex(params.skyHorizon).multiplyScalar(1.25);
    (u["uCloudLight"]?.value as THREE.Color).setHex(params.cloudLight).multiplyScalar(1.1);
    (u["uCloudShadow"]?.value as THREE.Color).setHex(params.cloudShadow);
    sunDirection(u["uSunDir"]?.value as THREE.Vector3);
    if (u["uCover"]) u["uCover"].value = params.cloudCover;
  }

  tick(seconds: number, storm: number, camera: THREE.Camera, flash = 0): void {
    const u = this.material.uniforms;
    if (u["uFlash"]) u["uFlash"].value = flash;
    if (u["uTime"]) u["uTime"].value = seconds;
    if (u["uStorm"]) u["uStorm"].value = storm;
    this.syncParams();
    this.mesh.position.copy(camera.position);
  }
}
