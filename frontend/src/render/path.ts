/**
 * A render path draws the shared WorldModel. Simple/Balanced share the stylised path (in the main
 * bundle); Cinematic is a separate lazily imported chunk. main.ts owns the renderer, camera and loop
 * and swaps paths when the tier crosses the Cinematic boundary.
 */
import type * as THREE from "three";
import type { Tier } from "../quality/tiers";

export interface PathInfo {
  calls: number;
  triangles: number;
  /** Rough GPU memory held by this path's render targets and textures, in bytes. */
  gpuBytes: number;
}

export interface RenderPath {
  readonly name: "stylised" | "cinematic";
  /** Camera framing preferences for this path. */
  readonly shot: { elevation: number; distance: number; targetY: number };
  applyTier(tier: Tier): void;
  setReducedMotion(reduced: boolean): void;
  resize(width: number, height: number): void;
  /** Update from the model and draw one frame to the screen. */
  frame(dtSeconds: number, seconds: number, camera: THREE.PerspectiveCamera): void;
  info(): PathInfo;
  dispose(): void;
}
