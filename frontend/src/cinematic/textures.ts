/**
 * Procedural foliage textures, drawn once on canvases while the loading bar shows: a cypress
 * leaf-cluster card and a hanging Spanish-moss card, both alpha-tested. No image files, no network.
 * A seeded PRNG keeps them identical on every load (stable screenshots, no shimmering reloads).
 */
import * as THREE from "three";

export { mulberry32 } from "../scene/random";
import { mulberry32 } from "../scene/random";

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
 * A clump of bald-cypress foliage: layered pinnate sprays (a twig with needle pairs, feathering out
 * from a few branchlets), no solid core, so the card edge is ragged and light shows through gaps.
 * Back layers are drawn darker and front layers lighter, then the whole card is shaded top-lit,
 * which gives each flat card a sense of volume. 512 px so it holds up close.
 */
export function leafClusterTexture(): THREE.CanvasTexture {
  return canvasTexture((ctx, s) => {
    const rnd = mulberry32(0xc1c1);
    ctx.clearRect(0, 0, s, s);
    const cx = s / 2;
    const cy = s * 0.5;
    ctx.lineCap = "round";
    /** One flat spray: a gently curving twig with alternating needles, lighter toward the tip. */
    const spray = (x: number, y: number, dir: number, len: number, shade: number, width: number): void => {
      const steps = Math.max(6, Math.round(len / (s * 0.012)));
      const bend = (rnd() - 0.5) * 0.9;
      const droop = 0.15 + rnd() * 0.45;
      let a = dir;
      for (let k = 0; k < steps; k++) {
        const t = k / steps;
        a += bend / steps + droop * 0.05 * Math.cos(a); // cos(a) turns any heading toward "down"
        const dx = Math.cos(a) * (len / steps);
        const dy = Math.sin(a) * (len / steps);
        // Twig
        const light = shade + t * 38 + rnd() * 10;
        ctx.strokeStyle = `rgba(${Math.floor(light * 0.62)},${Math.floor(light * 0.78)},${Math.floor(light * 0.42)},0.95)`;
        ctx.lineWidth = Math.max(1, width * (1 - t * 0.6));
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + dx, y + dy);
        ctx.stroke();
        x += dx;
        y += dy;
        // Needle pair, swept forward, shortening toward the tip.
        const needle = s * (0.03 - t * 0.017) * (0.8 + rnd() * 0.4);
        const g = Math.floor(light + 6 + rnd() * 18);
        ctx.strokeStyle = `rgba(${Math.floor(g * 0.66)},${g},${Math.floor(g * 0.4)},${0.92 - t * 0.25})`;
        ctx.lineWidth = Math.max(1, s * 0.004);
        for (const side of [-1, 1]) {
          const na = a + side * (0.95 + rnd() * 0.25);
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + Math.cos(na) * needle, y + Math.sin(na) * needle);
          ctx.stroke();
        }
      }
    };
    // Three depth layers: back (dark, broad), middle, front (light, fewer). Each branchlet from
    // near the centre forks into several sprays, so the clump reads as foliage, not a blob.
    const layers = [
      { n: 16, shade: 34, reach: 0.34 },
      { n: 14, shade: 62, reach: 0.3 },
      { n: 10, shade: 92, reach: 0.24 },
    ];
    for (const layer of layers) {
      for (let i = 0; i < layer.n; i++) {
        const a = rnd() * Math.PI * 2;
        const r0 = s * rnd() * 0.08;
        const bx = cx + Math.cos(a) * r0;
        const by = cy + Math.sin(a) * r0 * 0.7;
        const forks = 2 + Math.floor(rnd() * 3);
        for (let f = 0; f < forks; f++) {
          const dir = a + (f - forks / 2) * 0.35 + (rnd() - 0.5) * 0.3;
          const along = s * layer.reach * (0.15 + f * 0.12) * rnd();
          spray(
            bx + Math.cos(a) * along,
            by + Math.sin(a) * along * 0.7,
            dir,
            s * layer.reach * (0.45 + rnd() * 0.45),
            layer.shade,
            s * 0.006,
          );
        }
      }
    }
    // Top-lit volume: brighten the upper half, deepen the underside (keeps alpha untouched).
    ctx.globalCompositeOperation = "source-atop";
    const shade = ctx.createLinearGradient(0, 0, 0, s);
    shade.addColorStop(0, "rgba(214,226,150,0.22)");
    shade.addColorStop(0.5, "rgba(0,0,0,0)");
    shade.addColorStop(1, "rgba(4,10,6,0.45)");
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, s, s);
    ctx.globalCompositeOperation = "source-over";
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
