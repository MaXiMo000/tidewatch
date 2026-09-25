/**
 * Procedural surface detail for Cinematic's islet materials, at zero triangle cost: a fragment
 * pattern in island-local space (so it sticks to the model while islands turn and scale) that
 * modulates albedo and roughness and bumps the normal.
 *   wood     clapboard / deck planks: seams, staggered plank ends, grain, per-plank tone
 *   roof     lapped shingles with a shadowed lower edge, moss creeping over up-facing tiles
 *   stone    ashlar courses around the structure, mortar joints, grime and moss near the water
 *   stripes  the lighthouse: stone courses plus classic red/white bands
 *   rock     islet rock: grain, cracks and moss speckle over the baked vertex colours
 * Must be applied BEFORE IslandBatch.patch (the batch chains onto this onBeforeCompile). Reads the
 * raw `position` / `normal` attributes, which are island-local before the batch transform.
 */
import type * as THREE from "three";

export type Surface = "wood" | "roof" | "stone" | "stripes" | "rock";

const KIND: Record<Surface, number> = { wood: 0, roof: 1, stone: 2, stripes: 3, rock: 4 };

const FRAGMENT_COMMON = /* glsl */ `
varying vec3 vSurfP;
varying vec3 vSurfN;
float twHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float twNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(twHash(i), twHash(i + vec2(1.0, 0.0)), f.x),
             mix(twHash(i + vec2(0.0, 1.0)), twHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float twFbm(vec2 p) { return 0.55 * twNoise(p) + 0.3 * twNoise(p * 2.3 + 17.0) + 0.15 * twNoise(p * 5.1 + 3.0); }
/** Bump from a scalar height (three's perturbNormalArb, in view space). */
vec3 twBump(vec3 surfPos, vec3 surfNorm, float h, float scale) {
  vec3 dpdx = dFdx(surfPos);
  vec3 dpdy = dFdy(surfPos);
  float dhx = dFdx(h) * scale;
  float dhy = dFdy(h) * scale;
  vec3 r1 = cross(dpdy, surfNorm);
  vec3 r2 = cross(surfNorm, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
  return normalize(abs(det) * surfNorm - grad);
}
`;

/** GLSL computing twH (0..1 height), twTone (albedo multiplier), twMoss (0..1), twRough (delta). */
const PATTERN = /* glsl */ `
  vec3 sp = vSurfP;
  vec3 sn = normalize(vSurfN);
  float twH = 0.5;
  float twTone = 1.0;
  float twMoss = 0.0;
  float twRough = 0.0;
  vec3 twTint = vec3(1.0);
  bool up = sn.y > 0.7;
  // Along-the-face coordinate for flat faces, and around-the-axis for round ones.
  float planarU = abs(sn.x) > abs(sn.z) ? sp.z : sp.x;
  float polarU = atan(sp.z, sp.x) * max(length(sp.xz), 0.05);
#if TW_SURFACE == 0
  {
    float u = up ? sp.x : planarU;
    float v = up ? sp.z : sp.y;
    float w = up ? 0.11 : 0.075;
    float row = floor(v / w);
    float fv = fract(v / w);
    float off = twHash(vec2(row, 3.0)) * 3.0;
    float seg = floor((u + off) / 0.8);
    float fu = fract((u + off) / 0.8);
    float seam = smoothstep(0.0, 0.1, fv) * smoothstep(1.0, 0.88, fv) * smoothstep(0.0, 0.015, fu);
    float grain = twNoise(vec2(u * 2.5 + seg * 5.0, v * 90.0 + row * 7.0));
    twTone = mix(0.7, 1.2, twHash(vec2(row, seg))) * (0.82 + 0.36 * grain) * mix(0.35, 1.0, seam);
    // Clapboard walls: each board laps the one below (a sloped bevel), decks are flat boards.
    twH = seam * 0.55 + grain * 0.12 + (up ? 0.0 : fv * 0.35);
    twRough = 0.08 * (1.0 - grain);
    twMoss = up ? 0.0 : smoothstep(0.55, 0.9, twFbm(sp.xz * 3.0 + sp.y)) * smoothstep(0.9, 0.2, sp.y) * 0.6;
  }
#elif TW_SURFACE == 1
  {
    float u = planarU;
    float v = sp.y;
    float rowH = 0.075;
    float row = floor(v / rowH);
    float fv = fract(v / rowH);
    float tileW = 0.1;
    float fu = fract(u / tileW + (mod(row, 2.0) * 0.5));
    float tile = floor(u / tileW + (mod(row, 2.0) * 0.5));
    float gap = smoothstep(0.0, 0.06, fu) * smoothstep(1.0, 0.94, fu);
    twH = fv * 0.8 * gap;
    twTone = mix(0.65, 1.2, twHash(vec2(row, tile))) * mix(0.45, 1.0, smoothstep(0.0, 0.25, fv)) * mix(0.5, 1.0, gap);
    twMoss = smoothstep(0.5, 0.85, twFbm(vec2(u, v) * 4.0)) * clamp(sn.y * 1.5, 0.0, 1.0);
  }
#elif TW_SURFACE == 2 || TW_SURFACE == 3
  {
    float u = polarU;
    float courseH = 0.16;
    float row = floor(sp.y / courseH);
    float fv = fract(sp.y / courseH);
    float blockL = 0.28;
    float fu = fract(u / blockL + twHash(vec2(row, 1.0)) * 0.6 + mod(row, 2.0) * 0.5);
    float block = floor(u / blockL + twHash(vec2(row, 1.0)) * 0.6 + mod(row, 2.0) * 0.5);
    float joint = smoothstep(0.0, 0.07, fv) * smoothstep(1.0, 0.93, fv) * smoothstep(0.0, 0.04, fu) * smoothstep(1.0, 0.96, fu);
    float pit = twFbm(vec2(u, sp.y) * 14.0);
    twH = joint * (0.7 + 0.3 * pit);
    twTone = mix(0.78, 1.15, twHash(vec2(row, block))) * mix(0.55, 1.0, joint) * (0.9 + 0.2 * pit);
    twRough = 0.05;
    // Grime and moss low down, where the swamp splashes it.
    twTone *= mix(0.55, 1.0, smoothstep(0.1, 1.1, sp.y));
    twMoss = smoothstep(0.45, 0.8, twFbm(vec2(u, sp.y) * 3.0)) * smoothstep(1.3, 0.3, sp.y) + (up ? 0.35 : 0.0);
  #if TW_SURFACE == 3
    // Red bands on the lighthouse (not on the lantern room or the base course).
    float band = step(0.5, fract((sp.y - 0.55) / 0.72)) * step(0.55, sp.y) * step(sp.y, 2.75);
    twTint = mix(vec3(1.0), vec3(1.25, 0.28, 0.22), band);
    twMoss *= 0.4;
  #endif
  }
#else
  {
    float g = twFbm(sp.xz * 5.0 + sp.y * 3.0);
    float crack = smoothstep(0.02, 0.0, abs(twNoise(sp.xz * 2.2 + sp.y) - 0.5) - 0.01);
    twH = g * 0.8 - crack * 0.5;
    twTone = (0.75 + 0.5 * g) * (1.0 - crack * 0.45);
    twMoss = smoothstep(0.55, 0.75, twFbm(sp.xz * 7.0)) * smoothstep(0.35, 0.8, sn.y) * 0.8;
    twRough = -0.25 * smoothstep(0.25, 0.1, sp.y); // wet at the waterline
  }
#endif
`;

/**
 * Adds the surface pattern to a (Cinematic, MeshStandardMaterial) islet material. `bump` is the
 * height scale in world units (seams are a centimetre or two deep).
 */
export function withSurface(material: THREE.MeshStandardMaterial, surface: Surface, bump = 0.012): void {
  const previous = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vSurfP;\nvarying vec3 vSurfN;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSurfP = position;\nvSurfN = normal;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n#define TW_SURFACE ${KIND[surface]}\n${FRAGMENT_COMMON}`)
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        ${PATTERN}
        diffuseColor.rgb *= twTone * twTint;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.13, 0.19, 0.08) * (0.7 + 0.6 * twH), clamp(twMoss, 0.0, 1.0));`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        "#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + twRough + twMoss * 0.1, 0.05, 1.0);",
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>\nnormal = twBump(-vViewPosition, normal, twH, ${bump.toFixed(4)});`,
      );
  };
  const key = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${key()}|tw-surface-${surface}`;
  material.needsUpdate = true;
}
