/**
 * Baked glow: one small radial-gradient texture drawn once on a canvas, shared by every glow
 * sprite. Replaces bloom post-processing on all tiers (docs/PERFORMANCE.md technique 2).
 * No image files, no network, no blob: URLs.
 */
import * as THREE from "three";

let shared: THREE.CanvasTexture | null = null;

export function glowTexture(): THREE.CanvasTexture {
  if (shared) return shared;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.25, "rgba(255,255,255,0.55)");
    g.addColorStop(0.6, "rgba(255,255,255,0.12)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  shared = new THREE.CanvasTexture(canvas);
  shared.colorSpace = THREE.SRGBColorSpace;
  return shared;
}

export function glowMaterial(color: number, opacity: number): THREE.SpriteMaterial {
  return new THREE.SpriteMaterial({
    map: glowTexture(),
    color,
    opacity,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}
