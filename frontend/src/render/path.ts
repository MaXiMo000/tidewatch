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

/** The camera's composition anchor: where it sits at the centre of its drift, and what it frames. */
export interface ViewBase {
  eye: THREE.Vector3;
  target: THREE.Vector3;
  /** tan(horizontal FOV / 2): how fast the visible width grows with depth (portrait is narrow). */
  spread: number;
}

export interface RenderPath {
  readonly name: "stylised" | "cinematic";
  /**
   * Camera framing for this path. `sweep` > 0: pendulum drift of that many radians around a fixed
   * base azimuth (composed shots, e.g. Cinematic's tree-lined channel); 0: slow full orbit.
   */
  readonly shot: { elevation: number; distance: number; targetY: number; sweep: number };
  applyTier(tier: Tier): void;
  setReducedMotion(reduced: boolean): void;
  resize(width: number, height: number): void;
  /** Update from the model and draw one frame to the screen. */
  frame(dtSeconds: number, seconds: number, camera: THREE.PerspectiveCamera, view: ViewBase): void;
  info(): PathInfo;
  dispose(): void;
}
