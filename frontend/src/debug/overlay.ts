/**
 * Dev-only performance overlay (docs/PERFORMANCE.md "Measurement"): `?debug=1` on the dev server.
 * main.ts imports this behind `import.meta.env.DEV`, so production bundles never contain it.
 */
import type { WebGLRenderer } from "three";

export class DebugOverlay {
  private readonly node: HTMLPreElement;
  private frames = 0;
  private workMs = 0;
  private since = 0;

  constructor() {
    this.node = document.createElement("pre");
    this.node.id = "debug-overlay";
    document.body.append(this.node);
  }

  /** Call once per rendered frame with the CPU time spent in update + render. */
  frame(now: number, workMs: number, renderer: WebGLRenderer, tier: string): void {
    this.frames += 1;
    this.workMs += workMs;
    if (this.since === 0) this.since = now;
    const elapsed = now - this.since;
    if (elapsed < 500) return;
    const info = renderer.info.render;
    this.node.textContent = [
      `fps       ${((this.frames * 1000) / elapsed).toFixed(0)}`,
      `cpu ms    ${(this.workMs / this.frames).toFixed(2)}`,
      `calls     ${info.calls}`,
      `triangles ${info.triangles}`,
      `tier      ${tier}`,
      `dpr       ${renderer.getPixelRatio().toFixed(2)}`,
    ].join("\n");
    this.frames = 0;
    this.workMs = 0;
    this.since = now;
  }
}
