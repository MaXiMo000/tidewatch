/**
 * Procedural noise for the Cinematic path: GLSL helpers, plus a tileable water normal map generated
 * on the CPU once (no image files, no network). Periodic value noise makes the map wrap seamlessly.
 */
import * as THREE from "three";

export const GLSL_NOISE = /* glsl */ `
float twHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float twHash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float twNoise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(twHash12(i), twHash12(i + vec2(1.0, 0.0)), u.x),
             mix(twHash12(i + vec2(0.0, 1.0)), twHash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float twNoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(twHash13(i), twHash13(i + vec3(1, 0, 0)), u.x),
                mix(twHash13(i + vec3(0, 1, 0)), twHash13(i + vec3(1, 1, 0)), u.x), u.y);
  float b = mix(mix(twHash13(i + vec3(0, 0, 1)), twHash13(i + vec3(1, 0, 1)), u.x),
                mix(twHash13(i + vec3(0, 1, 1)), twHash13(i + vec3(1, 1, 1)), u.x), u.y);
  return mix(a, b, u.z);
}
float twFbm2(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 6; i++) {
    v += a * twNoise2(p);
    p = r * p * 2.03 + 17.1;
    a *= 0.5;
  }
  return v;
}
float twFbm3(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * twNoise3(p);
    p = p * 2.1 + 11.3;
    a *= 0.5;
  }
  return v;
}
// Interleaved gradient noise: per-pixel jitter for raymarch start offsets (hides banding).
float twIgn(vec2 px) {
  return fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715))));
}
`;

function periodicValueNoise(size: number, period: number, seed: number): Float32Array {
  const grid = new Float32Array(period * period);
  let s = seed >>> 0;
  for (let i = 0; i < grid.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    grid[i] = s / 4294967296;
  }
  const out = new Float32Array(size * size);
  const g = (x: number, y: number): number =>
    grid[(((y % period) + period) % period) * period + (((x % period) + period) % period)] ?? 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * period;
      const fy = (y / size) * period;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const tx = fx - ix;
      const ty = fy - iy;
      const ux = tx * tx * (3 - 2 * tx);
      const uy = ty * ty * (3 - 2 * ty);
      const a = g(ix, iy) + (g(ix + 1, iy) - g(ix, iy)) * ux;
      const b = g(ix, iy + 1) + (g(ix + 1, iy + 1) - g(ix, iy + 1)) * ux;
      out[y * size + x] = a + (b - a) * uy;
    }
  }
  return out;
}

/**
 * Tileable ripple normal map (tangent space, RGB = normal * 0.5 + 0.5). Several octaves of periodic
 * noise, finite-difference normals. ~10 ms for 256x256, done once while the loading bar shows.
 */
export function makeWaterNormalMap(size = 256): THREE.DataTexture {
  const height = new Float32Array(size * size);
  const octaves: [number, number][] = [
    [8, 1.0],
    [16, 0.55],
    [32, 0.3],
    [64, 0.15],
  ];
  octaves.forEach(([period, amp], i) => {
    const n = periodicValueNoise(size, period, 0x5eed + i * 7919);
    for (let k = 0; k < height.length; k++) height[k] = (height[k] ?? 0) + (n[k] ?? 0) * amp;
  });
  const data = new Uint8Array(size * size * 4);
  const h = (x: number, y: number): number =>
    height[((y + size) % size) * size + ((x + size) % size)] ?? 0;
  const strength = 6;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength;
      const dy = (h(x, y + 1) - h(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const o = (y * size + x) * 4;
      data[o] = Math.round(((-dx / len) * 0.5 + 0.5) * 255);
      data[o + 1] = Math.round(((-dy / len) * 0.5 + 0.5) * 255);
      data[o + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}
