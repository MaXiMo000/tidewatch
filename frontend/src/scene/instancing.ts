/**
 * Chrome on Windows draws WebGL through ANGLE on Direct3D 11, which takes a slow path when a
 * per-instance attribute (instanceMatrix, aSrc, ...) ends up in attribute slot 0. three.js lets the
 * driver pick slots, and instance attributes often sort first. Measured: one small instanced mesh
 * cost ~35 ms a frame this way; pinning `position` to slot 0 brought it back to ~0. Call this on
 * every material drawn with instancing.
 */
import type * as THREE from "three";

export function pinPositionAttribute(material: THREE.Material): void {
  // Read by three's program builder for every material, though only typed on ShaderMaterial.
  (material as THREE.Material & { index0AttributeName?: string }).index0AttributeName = "position";
}
