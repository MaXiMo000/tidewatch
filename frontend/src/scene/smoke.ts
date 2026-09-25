/**
 * Chimney smoke for Cinematic: soft billboards rising, spreading and drifting downwind from every
 * lit chimney (an offline island's stove is cold: no smoke). One instanced draw call; the CPU only
 * copies each source's position into the puffs that belong to it, the GPU does the motion.
 */
import * as THREE from "three";
import { pinPositionAttribute } from "./instancing";

const MAX_SOURCES = 16;
const PUFFS = 12;

const vertexShader = /* glsl */ `
attribute vec4 aSrc;   // source xyz, w = lit * scale (0 = no smoke)
attribute vec2 aPuff;  // life phase, seed
uniform float uTime;
uniform vec2 uWind;
varying float vAlpha;
varying float vLife;
varying vec2 vUv;
#include <fog_pars_vertex>
void main() {
  float life = fract(uTime * 0.11 + aPuff.x);
  float k = max(aSrc.w, 0.0);
  vec3 p = aSrc.xyz;
  float s = aPuff.y * 6.2831;
  p.y += life * 1.9 * k;
  p.xz += uWind * life * life * 2.2 * k;
  p.xz += vec2(sin(s + uTime * 0.5), cos(s * 1.3 + uTime * 0.4)) * 0.14 * life * k;
  float size = mix(0.1, 1.0, pow(life, 0.8)) * k;
  float a = s + life * 1.5;
  vec2 corner = mat2(cos(a), -sin(a), sin(a), cos(a)) * position.xy;
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  mvPosition.xy += corner * size;
  gl_Position = projectionMatrix * mvPosition;
  vAlpha = step(0.001, k) * smoothstep(0.0, 0.1, life) * pow(1.0 - life, 1.4) * 0.34;
  vLife = life;
  vUv = position.xy;
  #include <fog_vertex>
}`;

const fragmentShader = /* glsl */ `
varying float vAlpha;
varying float vLife;
varying vec2 vUv;
#include <fog_pars_fragment>
void main() {
  float r = length(vUv) * 2.0;
  float lumps = 0.75 + 0.25 * sin(vUv.x * 9.0 + vLife * 4.0) * sin(vUv.y * 8.0 - vLife * 3.0);
  float a = vAlpha * smoothstep(1.0, 0.15, r) * lumps;
  if (a < 0.004) discard;
  // Warm where it leaves the stove, cool grey as it thins out in the dusk air.
  vec3 col = mix(vec3(0.34, 0.27, 0.22), vec3(0.2, 0.23, 0.25), smoothstep(0.0, 0.5, vLife));
  gl_FragColor = vec4(col, a);
  #include <fog_fragment>
}`;

export class Smoke {
  readonly mesh: THREE.Mesh;
  private readonly src: THREE.InstancedBufferAttribute;
  private readonly uniforms = {
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector2(0.55, 0.2) },
  };

  constructor() {
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute("position", quad.getAttribute("position"));
    const count = MAX_SOURCES * PUFFS;
    this.src = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
    this.src.setUsage(THREE.DynamicDrawUsage);
    const puff = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      puff[i * 2] = (i % PUFFS) / PUFFS; // evenly staggered: a continuous column
      puff[i * 2 + 1] = ((i * 7919) % 1000) / 1000;
    }
    geo.setAttribute("aSrc", this.src);
    geo.setAttribute("aPuff", new THREE.InstancedBufferAttribute(puff, 2));
    geo.instanceCount = 0;
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    Object.assign(material.uniforms, this.uniforms);
    this.mesh = new THREE.Mesh(geo, material);
    pinPositionAttribute(material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  /** `sources[i]`: xyz position, w = lit * scale. */
  update(sources: readonly THREE.Vector4[], count: number, seconds: number): void {
    this.uniforms.uTime.value = seconds;
    const n = Math.min(count, MAX_SOURCES);
    const arr = this.src.array as Float32Array;
    for (let s = 0; s < n; s++) {
      const v = sources[s];
      if (!v) continue;
      for (let k = 0; k < PUFFS; k++) {
        const o = (s * PUFFS + k) * 4;
        arr[o] = v.x;
        arr[o + 1] = v.y;
        arr[o + 2] = v.z;
        arr[o + 3] = v.w;
      }
    }
    this.src.needsUpdate = true;
    (this.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = n * PUFFS;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
