/**
 * Balanced (Medium) and Simple (Low) render path: procedural sky shader, shader water with a fake
 * reflection, exponential fog, low-poly islands. No downloaded assets, no post-processing passes
 * (the vignette is CSS). Lives in the main bundle so the first frame never waits for a download.
 */
import * as THREE from "three";
import { TIER_SETTINGS, type Tier } from "../quality/tiers";
import type { WorldModel } from "../scene/model";
import { PALETTE, SUN_DIRECTION } from "../scene/palette";
import { Sky } from "../scene/sky";
import { Water } from "../scene/water";
import { World } from "../scene/world";
import type { PathInfo, RenderPath } from "./path";

export class StylisedPath implements RenderPath {
  readonly name = "stylised" as const;
  readonly shot = { elevation: 0.34, distance: 0.9, targetY: 0.6 };

  private readonly scene = new THREE.Scene();
  private readonly sky: Sky;
  private readonly water: Water;
  private readonly world: World;
  private readonly fog = new THREE.FogExp2(PALETTE.fog, 0.0095);
  private reducedMotion = false;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    model: WorldModel,
    tier: Tier,
  ) {
    this.scene.fog = this.fog;
    this.scene.add(new THREE.HemisphereLight(0xb7a3e6, 0x0b3a44, 1.1));
    const sun = new THREE.DirectionalLight(PALETTE.sun, 1.6);
    // From the sun's side of the sky but higher than the visible sun, so islands read clearly.
    sun.position.set(SUN_DIRECTION.x * 60, 30, SUN_DIRECTION.z * 60);
    this.scene.add(sun);
    this.sky = new Sky(TIER_SETTINGS[tier].skyBands);
    this.water = new Water(TIER_SETTINGS[tier].waterDetail);
    this.world = new World(model);
    this.scene.add(this.sky.mesh, this.water.mesh, this.world.root);
    this.applyTier(tier);
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
    this.world.setReducedMotion(reduced);
  }

  applyTier(tier: Tier): void {
    const t = TIER_SETTINGS[tier];
    this.water.setDetail(t.waterDetail);
    this.sky.setBands(t.skyBands);
    this.world.setGlow(t.glowSprites);
  }

  resize(): void {
    // Nothing tier-sized to reallocate: no render targets on this path.
  }

  frame(dt: number, seconds: number, camera: THREE.PerspectiveCamera): void {
    void dt;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.world.update(seconds);
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
    this.world.dispose();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const m = o.material as THREE.Material | THREE.Material[];
        for (const mat of Array.isArray(m) ? m : [m]) mat.dispose();
      }
    });
  }
}
