/**
 * Procedural foliage textures, drawn once on canvases while the loading bar shows: a cypress
 * leaf-cluster card and a hanging Spanish-moss card, both alpha-tested. No image files, no network.
 * A seeded PRNG keeps them identical on every load (stable screenshots, no shimmering reloads).
 */
import * as THREE from "three";

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(draw: (ctx: CanvasRenderingContext2D, size: number) => void, size: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

/**
 * A clump of bald-cypress foliage: a dense, slightly lumpy core that frays into feathery needle
 * sprays at the edge. Tips are lighter so backlight catches them. 512 px so it holds up close.
 */
export function leafClusterTexture(): THREE.CanvasTexture {
  return canvasTexture((ctx, s) => {
    const rnd = mulberry32(0xc1c1);
    ctx.clearRect(0, 0, s, s);
    const cx = s / 2;
    const cy = s * 0.5;
    // Core: overlapping lumpy blobs -> a solid mass at distance (mip levels).
    for (let i = 0; i < 140; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.pow(rnd(), 0.7) * s * 0.3;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r * 0.72;
      const rad = s * (0.025 + rnd() * 0.05);
      const g = 18 + Math.floor(rnd() * 26);
      ctx.fillStyle = `rgba(${g - 4},${g + 16},${g - 2},0.96)`;
      ctx.beginPath();
      ctx.ellipse(x, y, rad, rad * (0.55 + rnd() * 0.4), rnd() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    // Sprays: flat feathery twigs radiating out and drooping, needles alternating both sides.
    const sprays = 70;
    for (let i = 0; i < sprays; i++) {
      const a = rnd() * Math.PI * 2;
      const r0 = s * (0.12 + rnd() * 0.2);
      let x = cx + Math.cos(a) * r0;
      let y = cy + Math.sin(a) * r0 * 0.72;
      const len = s * (0.08 + rnd() * 0.13);
      const dir = a + (rnd() - 0.5) * 0.7;
      const droop = 0.2 + rnd() * 0.5;
      const steps = 16;
      for (let k = 0; k < steps; k++) {
        const t = k / steps;
        const dx = Math.cos(dir) * (len / steps);
        const dy = Math.sin(dir) * (len / steps) + droop * (len / steps) * t * 2;
        x += dx;
        y += dy;
        const needle = s * 0.022 * (1 - t * 0.55);
        const nx = -dy / Math.hypot(dx, dy);
        const ny = dx / Math.hypot(dx, dy);
        const light = Math.floor(22 + t * 34 + rnd() * 14);
        ctx.strokeStyle = `rgba(${light - 2},${light + 22},${light + 2},${0.9 - t * 0.2})`;
        ctx.lineWidth = Math.max(1, s * 0.0045);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + nx * needle + dx * 0.6, y + ny * needle + dy * 0.6);
        ctx.moveTo(x, y);
        ctx.lineTo(x - nx * needle + dx * 0.6, y - ny * needle + dy * 0.6);
        ctx.stroke();
      }
    }
  }, 512);
}

/** Hanging Spanish moss: wavy grey-green strands, longest in the middle, fraying at the tips. */
export function mossTexture(): THREE.CanvasTexture {
  return canvasTexture((ctx, s) => {
    const rnd = mulberry32(0x5a55);
    ctx.clearRect(0, 0, s, s);
    const strands = 70;
    for (let i = 0; i < strands; i++) {
      const x0 = s * (0.15 + rnd() * 0.7);
      const centre = 1 - Math.abs(x0 / s - 0.5) * 1.6;
      const len = s * (0.35 + rnd() * 0.6) * (0.5 + 0.5 * centre);
      const grey = 95 + Math.floor(rnd() * 55);
      ctx.strokeStyle = `rgba(${grey},${grey + 12},${grey - 6},${0.55 + rnd() * 0.4})`;
      ctx.lineWidth = Math.max(1, s * (0.004 + rnd() * 0.006));
      ctx.beginPath();
      ctx.moveTo(x0, 0);
      const phase = rnd() * 6.28;
      for (let y = 0; y <= len; y += s * 0.02) {
        ctx.lineTo(x0 + Math.sin(y * 0.05 + phase) * s * 0.012, y);
      }
      ctx.stroke();
    }
  }, 128);
}
