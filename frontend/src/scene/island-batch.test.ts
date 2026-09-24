import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { IslandBatch, MAX_ISLANDS, tagIsland } from "./island-batch";

const VERTEX = "#include <common>\n#include <beginnormal_vertex>\n#include <begin_vertex>\n";
const FRAGMENT = "#include <common>\n#include <emissivemap_fragment>\n";

function compile(material: THREE.Material): { vertexShader: string; fragmentShader: string; uniforms: Record<string, unknown> } {
  const shader = { vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms: {} as Record<string, unknown> };
  material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
  return shader;
}

describe("IslandBatch", () => {
  it("stores placement and emissive per island in their own texels", () => {
    const batch = new IslandBatch();
    batch.setPlacement(3, 1.5, -2, 0.8, 0.25);
    batch.setEmissive(3, 1, 0.1, 0.2, 0.3);
    batch.setEmissive(3, 2, 0.4, 0.5, 0.6);
    expect(batch.placement(3)).toEqual([1.5, -2, expect.closeTo(0.8, 5), 0.25]);
    const data = batch.texture.image.data as Float32Array;
    const row = 3 * 3 * 4;
    expect(Array.from(data.slice(row + 4, row + 7)).map((v) => +v.toFixed(3))).toEqual([0.1, 0.2, 0.3]);
    expect(Array.from(data.slice(row + 8, row + 11)).map((v) => +v.toFixed(3))).toEqual([0.4, 0.5, 0.6]);
    // Neighbours untouched.
    expect(batch.placement(2)).toEqual([0, 0, 0, 0]);
    expect(batch.placement(4)).toEqual([0, 0, 0, 0]);
    batch.dispose();
  });

  it("ignores islands beyond the texture instead of writing out of bounds", () => {
    const batch = new IslandBatch();
    const data = batch.texture.image.data as Float32Array;
    const before = data.length;
    batch.setPlacement(MAX_ISLANDS, 1, 1, 1, 1);
    batch.setEmissive(MAX_ISLANDS + 5, 2, 1, 1, 1);
    expect(data.length).toBe(before);
    expect(Array.from(data).every((v) => v === 0)).toBe(true);
    batch.dispose();
  });

  it("patches placement into the vertex shader and emissive only where asked", () => {
    const batch = new IslandBatch();
    const plain = new THREE.MeshStandardMaterial();
    const signal = new THREE.MeshStandardMaterial();
    batch.patch(plain);
    batch.patch(signal, 1);
    batch.patch(signal, 1); // idempotent

    const p = compile(plain);
    expect(p.uniforms["uIslands"]).toEqual({ value: batch.texture });
    expect(p.vertexShader).toContain("attribute float aIsland;");
    expect(p.vertexShader).toContain("objectNormal = islandRot(islandTexel(0).w) * objectNormal;");
    expect(p.vertexShader).toContain("transformed = islandRot(islandT.w) * (transformed * islandT.z)");
    expect(p.vertexShader).not.toContain("vIslandEmissive");
    expect(p.fragmentShader).toBe(FRAGMENT);

    const s = compile(signal);
    expect(s.vertexShader.match(/attribute float aIsland;/g)).toHaveLength(1);
    expect(s.vertexShader).toContain("vIslandEmissive = islandTexel(1).rgb;");
    expect(s.fragmentShader).toContain("totalEmissiveRadiance = vIslandEmissive;");

    // Different programs for different rows; the depth material follows the islands too.
    expect(plain.customProgramCacheKey()).not.toBe(signal.customProgramCacheKey());
    expect(compile(batch.depthMaterial).vertexShader).toContain("islandTexel(0)");
    batch.dispose();
  });
});

describe("tagIsland", () => {
  it("de-indexes, keeps only the merged attributes and tags every vertex", () => {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const tagged = tagIsland(box, 7, false);
    expect(tagged.index).toBeNull();
    expect(Object.keys(tagged.attributes).sort()).toEqual(["aIsland", "normal", "position"]);
    const ids = tagged.getAttribute("aIsland");
    expect(ids.count).toBe(tagged.getAttribute("position").count);
    expect(Array.from(ids.array as Float32Array).every((v) => v === 7)).toBe(true);
    // The source geometry is not modified.
    expect(box.getAttribute("uv")).toBeDefined();
  });

  it("keeps vertex colours only when asked", () => {
    const g = new THREE.PlaneGeometry(1, 1).toNonIndexed();
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(g.getAttribute("position").count * 3), 3));
    expect(tagIsland(g, 0, true).getAttribute("color")).toBeDefined();
    expect(tagIsland(g, 0, false).getAttribute("color")).toBeUndefined();
  });
});
