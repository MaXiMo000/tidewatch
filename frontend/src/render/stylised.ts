/**
 * Balanced (Medium) and Simple (Low) render path: the SAME world as Cinematic - the same islets and
 * kind-specific structures, the same health pulse/flicker, the same request boats - drawn cheaply:
 * flat Lambert materials, a procedural sky, shader water with a fake reflection, FogExp2, one
 * instanced silhouette treeline, no post-processing (the vignette is CSS). No downloads; lives in
 * the main bundle so the first frame never waits.
 *
 * Simple drops the glow billboards, water detail and most trees, and renders at 30 fps.
 */
import * as THREE from "three";
import { TIER_SETTINGS, type Tier } from "../quality/tiers";
import { Boats } from "../scene/boats";
import { Islands } from "../scene/islands";
import type { WorldModel } from "../scene/model";
import { PALETTE, SUN_DIRECTION } from "../scene/palette";
import { Silhouettes } from "../scene/silhouettes";
import { Sky } from "../scene/sky";
import { Water } from "../scene/water";
import { Channels } from "../scene/world";
import type { PathInfo, RenderPath, ViewBase } from "./path";

export class StylisedPath implements RenderPath {
  readonly name = "stylised" as const;
  readonly shot = { elevation: 0.3, distance: 0.85, targetY: 0.8, sweep: 0 };

  private readonly scene = new THREE.Scene();
  private readonly sky: Sky;
  private readonly water: Water;
  private readonly islands = new Islands("flat");
  private readonly boats = new Boats();
  private readonly channels: Channels;
  private readonly trees = new Silhouettes(120);
  private treeCount = 0;
  private boatBudget = 40;
  private readonly fog = new THREE.FogExp2(PALETTE.fog, 0.0095);
  private reducedMotion = false;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly model: WorldModel,
    tier: Tier,
  ) {
    this.scene.fog = this.fog;
    this.scene.add(new THREE.HemisphereLight(0xb7a3e6, 0x0b3a44, 1.25));
    const sun = new THREE.DirectionalLight(PALETTE.sun, 1.5);
    // From the sun's side of the sky but higher than the visible sun, so islands read clearly.
    sun.position.set(SUN_DIRECTION.x * 60, 30, SUN_DIRECTION.z * 60);
    this.scene.add(sun);
    this.sky = new Sky(TIER_SETTINGS[tier].skyBands);
    this.water = new Water(TIER_SETTINGS[tier].waterDetail);
    this.channels = new Channels(model);
    this.scene.add(
      this.sky.mesh,
      this.water.mesh,
      this.channels.root,
      this.islands.root,
      this.boats.mesh,
      this.trees.mesh,
    );
    this.applyTier(tier);
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
  }

  applyTier(tier: Tier): void {
    const t = TIER_SETTINGS[tier];
    this.water.setDetail(t.waterDetail);
    this.sky.setBands(t.skyBands);
    this.islands.setGlows(t.glowSprites);
    this.treeCount = t.silhouettes;
    this.boatBudget = tier === "low" ? 16 : 40;
  }

  resize(): void {
    // Nothing tier-sized to reallocate: no render targets on this path.
  }

  frame(dt: number, seconds: number, camera: THREE.PerspectiveCamera, view: ViewBase): void {
    void dt;
    const t = this.reducedMotion ? seconds * 0.3 : seconds;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.islands.update(this.model, view.eye, t, this.reducedMotion);
    this.boats.update(this.model, this.boatBudget);
    this.boats.tick(t);
    this.channels.update();
    // Outside the orbit radius (camera distance ~ radius / tan(fov/2)), so trees never block islands.
    const orbit = camera.position.distanceTo(view.target);
    this.trees.update(this.model, orbit, this.treeCount);
    this.water.tick(this.reducedMotion ? seconds * 0.25 : seconds, camera);
    this.sky.tick(seconds, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, camera);
  }

  info(): PathInfo {
    const r = this.renderer.info.render;
    return { calls: r.calls, triangles: r.triangles, gpuBytes: 64 * 64 * 4 };
  }

  dispose(): void {
    this.islands.dispose();
    this.boats.dispose();
    this.channels.dispose();
    this.trees.dispose();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const m = o.material as THREE.Material | THREE.Material[];
        for (const mat of Array.isArray(m) ? m : [m]) mat.dispose();
      }
    });
  }
}
