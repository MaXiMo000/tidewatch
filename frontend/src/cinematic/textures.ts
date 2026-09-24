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

/** A clump of feathery cypress sprays: many thin needle-leaf strokes radiating from twigs. */
export function leafClusterTexture(): THREE.CanvasTexture {
  return canvasTexture((ctx, s) => {
    const rnd = mulberry32(0xc1c1);
    ctx.clearRect(0, 0, s, s);
    // Dense rounded core made of overlapping soft blobs, so clumps read as masses, not fronds.
    for (let i = 0; i < 90; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * s * 0.3;
      const x = s / 2 + Math.cos(a) * r;
      const y = s * 0.47 + Math.sin(a) * r * 0.75;
      const rad = s * (0.03 + rnd() * 0.05);
      const shade = 12 + Math.floor(rnd() * 22);
      ctx.fillStyle = `rgba(${shade + 4},${shade + 18 + Math.floor(rnd() * 10)},${shade + 6},0.95)`;
      ctx.beginPath();
      ctx.ellipse(x, y, rad, rad * (0.6 + rnd() * 0.4), rnd() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    const sprays = 34;
    for (let i = 0; i < sprays; i++) {
      // Sprays start near the centre-top and droop outward.
      const a = rnd() * Math.PI * 2;
      const r = s * (0.18 + rnd() * 0.14);
      const x0 = s / 2 + Math.cos(a) * r;
      const y0 = s * 0.42 + Math.sin(a) * r * 0.7;
      const len = s * (0.08 + rnd() * 0.12);
      const dir = a + (rnd() - 0.5) * 0.8;
      const droop = 0.35 + rnd() * 0.4;
      const shade = 14 + Math.floor(rnd() * 26);
      for (let k = 0; k < 18; k++) {
        const t = k / 18;
        const x = x0 + Math.cos(dir) * len * t;
        const y = y0 + Math.sin(dir) * len * t + droop * len * t * t;
        const needle = s * 0.028 * (1 - t * 0.6);
        ctx.strokeStyle = `rgba(${shade + 6},${shade + 22 + Math.floor(rnd() * 14)},${shade + 8},${0.85 + rnd() * 0.15})`;
        ctx.lineWidth = Math.max(1, s * 0.006);
        ctx.beginPath();
        ctx.moveTo(x - needle, y - needle * 0.6);
        ctx.lineTo(x + needle, y + needle * 0.6);
        ctx.moveTo(x - needle, y + needle * 0.6);
        ctx.lineTo(x + needle, y - needle * 0.6);
        ctx.stroke();
      }
    }
    // Soft fill so the clump has a readable mass at a distance (mip levels).
    const g = ctx.createRadialGradient(s / 2, s * 0.45, 0, s / 2, s * 0.45, s * 0.36);
    g.addColorStop(0, "rgba(20,38,24,0.85)");
    g.addColorStop(1, "rgba(20,38,24,0)");
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    ctx.globalCompositeOperation = "source-over";
  }, 256);
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
