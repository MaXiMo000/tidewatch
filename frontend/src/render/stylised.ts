/**
 * Balanced (Medium) and Simple (Low) render path: the SAME world as Cinematic - the same islets and
 * kind-specific structures, the same health pulse/flicker, the same request boats - drawn cheaply:
 * flat Lambert materials, a procedural sky, shader water with a fake reflection, FogExp2, one
 * instanced silhouette treeline, no post-processing (the vignette is CSS). No downloads; lives in
 * the main bundle so the first frame never waits.
 *
 * Balanced also gets the living details (a heron flock, chimney smoke, the lighthouse beam: one
 * draw call each). Simple drops those, the glow billboards, water detail and most trees, and renders
 * at 30 fps.
 * Weather (M3, scene/weather.ts) is on every tier: latency fog, mist, storm clouds, lightning.
 */
import * as THREE from "three";
import { TIER_SETTINGS, type Tier } from "../quality/tiers";
import { Beams } from "../scene/beam";
import { Birds } from "../scene/birds";
import { Boats } from "../scene/boats";
import { Islands } from "../scene/islands";
import type { WorldModel } from "../scene/model";
import { PALETTE, SUN_DIRECTION } from "../scene/palette";
import { Silhouettes } from "../scene/silhouettes";
import { Sky } from "../scene/sky";
import { Smoke } from "../scene/smoke";
import { Water } from "../scene/water";
import { Weather } from "../scene/weather";
import { Channels } from "../scene/world";
import type { PathInfo, RenderPath, ViewBase } from "./path";

const FOG_DENSITY = 0.0095;
const HEMI = 1.25;
const SUN = 1.5;

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
  private readonly fog = new THREE.FogExp2(PALETTE.fog, FOG_DENSITY);
  private readonly weather = new Weather();
  private readonly hemi = new THREE.HemisphereLight(0xb7a3e6, 0x0b3a44, HEMI);
  private readonly sun = new THREE.DirectionalLight(PALETTE.sun, SUN);
  private readonly birds = new Birds();
  private readonly smoke = new Smoke();
  private readonly beams = new Beams();
  private readonly emitters: THREE.Vector4[] = [];
  private living = true;
  private reducedMotion = false;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly model: WorldModel,
    tier: Tier,
  ) {
    this.scene.fog = this.fog;
    this.scene.add(this.hemi);
    // From the sun's side of the sky but higher than the visible sun, so islands read clearly.
    this.sun.position.set(SUN_DIRECTION.x * 60, 30, SUN_DIRECTION.z * 60);
    this.scene.add(this.sun);
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
      this.weather.mesh,
      this.birds.mesh,
      this.smoke.mesh,
      this.beams.mesh,
    );
    this.applyTier(tier);
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
  }

  private attached: THREE.Object3D | null = null;
  attach(object: THREE.Object3D): void {
    this.attached = object;
    this.scene.add(object);
  }

  applyTier(tier: Tier): void {
    const t = TIER_SETTINGS[tier];
    this.water.setDetail(t.waterDetail);
    this.sky.setBands(t.skyBands);
    this.islands.setGlows(t.glowSprites);
    this.treeCount = t.silhouettes;
    this.boatBudget = tier === "low" ? 16 : 40;
    this.living = tier !== "low";
    for (const m of [this.birds.mesh, this.smoke.mesh, this.beams.mesh]) m.visible = this.living;
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
    if (this.living) {
      this.birds.tick(t, view, this.reducedMotion);
      this.smoke.update(this.emitters, this.islands.emitters("smoke", this.emitters), t);
      this.beams.update(this.emitters, this.islands.emitters("lamps", this.emitters), t);
    }
    // Weather from the data: fog/mist with latency, clouds + lightning over failing islands.
    this.weather.update(this.model, this.fog, FOG_DENSITY, seconds, this.reducedMotion);
    const storm = Math.min(1, this.model.storm * 1.5);
    this.hemi.intensity = HEMI * (1 - storm * 0.35) + this.weather.flash * 2.2;
    this.sun.intensity = SUN * (1 - storm * 0.5) + this.weather.flash * 1.5;
    // Outside the orbit radius (camera distance ~ radius / tan(fov/2)), so trees never block islands.
    // From the composition anchor, not the moving camera: the film's shots must not replant them.
    const orbit = view.eye.distanceTo(view.target);
    this.trees.update(this.model, orbit, this.treeCount);
    this.water.tick(this.reducedMotion ? seconds * 0.25 : seconds, camera);
    this.sky.tick(seconds, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, camera);
  }

  weatherFlash(): number {
    return this.weather.flash;
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
    this.weather.dispose();
    this.birds.dispose();
    this.smoke.dispose();
    this.beams.dispose();
    // A shared object (the film's beacon) belongs to main.ts: never dispose it here.
    if (this.attached?.parent === this.scene) this.scene.remove(this.attached);
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const m = o.material as THREE.Material | THREE.Material[];
        for (const mat of Array.isArray(m) ? m : [m]) mat.dispose();
      }
    });
  }
}
