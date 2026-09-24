/**
 * Island batching: every islet and structure of the whole archipelago is merged per MATERIAL into
 * one mesh, so draw calls no longer grow with the number of services (41 islands: 121 -> ~8 calls
 * on Simple). Each vertex carries its island's index (`aIsland`); the per-island values that
 * change at runtime live in one small float texture the vertex shader reads with texelFetch:
 *   texel 0: x, z, scale, yaw     (placement; traffic scale eases every frame)
 *   texel 1: signal emissive rgb  (status light: colour x intensity, pulse / flicker)
 *   texel 2: window emissive rgb  (lantern windows: warm, dimming, red when failing, dark offline)
 * Materials are patched with onBeforeCompile (same program for every island); the depth material
 * used for Cinematic's shadows gets the same transform so shadows follow the islands.
 */
import * as THREE from "three";

/** Texture rows; the protocol caps a snapshot at 200 services (schemas.py, protocol.ts). */
export const MAX_ISLANDS = 256;
const TEXELS = 3;

export type EmissiveRow = 1 | 2;

const COMMON = /* glsl */ `
uniform highp sampler2D uIslands;
attribute float aIsland;
vec4 islandTexel(int col) { return texelFetch(uIslands, ivec2(col, int(aIsland + 0.5)), 0); }
mat3 islandRot(float yaw) {
  float c = cos(yaw);
  float s = sin(yaw);
  return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
}
`;

export class IslandBatch {
  readonly texture: THREE.DataTexture;
  private readonly data = new Float32Array(TEXELS * MAX_ISLANDS * 4);
  private readonly uniform: { value: THREE.DataTexture };
  private readonly patched = new WeakSet<THREE.Material>();
  readonly depthMaterial: THREE.MeshDepthMaterial;

  constructor() {
    this.texture = new THREE.DataTexture(this.data, TEXELS, MAX_ISLANDS, THREE.RGBAFormat, THREE.FloatType);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    this.uniform = { value: this.texture };
    this.depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    this.patch(this.depthMaterial);
  }

  /**
   * Make a material read its island's placement (and, for the signal / window materials, its
   * emissive colour) from the texture. Idempotent; the material must only be used by batch meshes.
   */
  patch(material: THREE.Material, emissiveRow?: EmissiveRow): void {
    if (this.patched.has(material)) return;
    this.patched.add(material);
    const uniform = this.uniform;
    const previous = material.onBeforeCompile.bind(material);
    material.onBeforeCompile = (shader, renderer) => {
      previous(shader, renderer);
      shader.uniforms["uIslands"] = uniform;
      const emissive = emissiveRow !== undefined;
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>\n${COMMON}${emissive ? "varying vec3 vIslandEmissive;" : ""}`,
        )
        .replace(
          "#include <beginnormal_vertex>",
          "#include <beginnormal_vertex>\nobjectNormal = islandRot(islandTexel(0).w) * objectNormal;",
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          vec4 islandT = islandTexel(0);
          transformed = islandRot(islandT.w) * (transformed * islandT.z) + vec3(islandT.x, 0.0, islandT.y);
          ${emissive ? `vIslandEmissive = islandTexel(${emissiveRow}).rgb;` : ""}`,
        );
      if (emissive) {
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>", "#include <common>\nvarying vec3 vIslandEmissive;")
          .replace(
            "#include <emissivemap_fragment>",
            "#include <emissivemap_fragment>\ntotalEmissiveRadiance = vIslandEmissive;",
          );
      }
    };
    const key = material.customProgramCacheKey.bind(material);
    material.customProgramCacheKey = () => `${key()}|tw-island${emissiveRow ?? 0}`;
    material.needsUpdate = true;
  }

  setPlacement(i: number, x: number, z: number, scale: number, yaw: number): void {
    if (i >= MAX_ISLANDS) return;
    const o = (i * TEXELS) * 4;
    this.data[o] = x;
    this.data[o + 1] = z;
    this.data[o + 2] = scale;
    this.data[o + 3] = yaw;
  }

  setEmissive(i: number, row: EmissiveRow, r: number, g: number, b: number): void {
    if (i >= MAX_ISLANDS) return;
    const o = (i * TEXELS + row) * 4;
    this.data[o] = r;
    this.data[o + 1] = g;
    this.data[o + 2] = b;
  }

  /** Upload this frame's values (one small texture, ~12 KB). */
  commit(): void {
    this.texture.needsUpdate = true;
  }

  /** Read back a placement (tests). */
  placement(i: number): [number, number, number, number] {
    const o = i * TEXELS * 4;
    return [this.data[o] ?? 0, this.data[o + 1] ?? 0, this.data[o + 2] ?? 0, this.data[o + 3] ?? 0];
  }

  dispose(): void {
    this.texture.dispose();
    this.depthMaterial.dispose();
  }
}

/**
 * Tag a geometry's vertices with their island index and strip attributes the batch does not use,
 * so geometries from different structures can be merged per material.
 */
export function tagIsland(geometry: THREE.BufferGeometry, island: number, keepColour: boolean): THREE.BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  for (const name of Object.keys(g.attributes)) {
    if (name !== "position" && name !== "normal" && !(keepColour && name === "color")) g.deleteAttribute(name);
  }
  if (!g.getAttribute("normal")) g.computeVertexNormals();
  const n = g.getAttribute("position").count;
  g.setAttribute("aIsland", new THREE.BufferAttribute(new Float32Array(n).fill(island), 1));
  return g;
}
