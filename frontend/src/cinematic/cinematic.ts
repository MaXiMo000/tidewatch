/**
 * Cinematic (High) render path. This module and everything it imports is a separate chunk that
 * main.ts loads with a dynamic import ONLY when the tier is Cinematic, after the first stylised
 * frame is on screen. Balanced/Simple never fetch it.
 *
 * Everything is procedural (no model/texture downloads): no third-party assets, no decoders, and
 * no CSP relaxation. See docs/ARCHITECTURE.md "Cinematic asset pipeline".
 */
import * as THREE from "three";
import { params } from "../render/params";
import type { PathInfo, RenderPath } from "../render/path";
import type { Tier } from "../quality/tiers";
import type { WorldModel } from "../scene/model";
import { makeWaterNormalMap } from "./noise";
import { CinematicPost } from "./post";
import { CinematicSky, sunDirection } from "./sky";
import { CinematicWater } from "./water";

export type Progress = (fraction: number, label: string) => void;

const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

class CinematicPath implements RenderPath {
  readonly name = "cinematic" as const;
  readonly shot = { elevation: 0.12, distance: 0.72, targetY: 1.2 };

  private readonly scene = new THREE.Scene();
  private readonly envScene = new THREE.Scene();
  private readonly sky: CinematicSky;
  private readonly envSky: CinematicSky;
  private readonly water: CinematicWater;
  private readonly post = new CinematicPost();
  private readonly sun = new THREE.DirectionalLight(0xffd2b8, 2.2);
  private readonly hemi = new THREE.HemisphereLight(0x8f86b8, 0x0c1f1c, 0.35);
  private readonly fog = new THREE.FogExp2(0x5f8f86, 0.004);
  private readonly pmrem: THREE.PMREMGenerator;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private envKey = "";
  private readonly sunDir = new THREE.Vector3();
  private readonly normalMap: THREE.DataTexture;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly model: WorldModel,
  ) {
    this.normalMap = makeWaterNormalMap(256);
    this.sky = new CinematicSky();
    this.envSky = new CinematicSky();
    this.envScene.add(this.envSky.mesh);
    this.water = new CinematicWater(this.normalMap);
    this.scene.fog = this.fog;
    this.scene.add(this.sky.mesh, this.water.mesh, this.sun, this.sun.target, this.hemi);
    this.pmrem = new THREE.PMREMGenerator(renderer);
  }

  /** Staged build so the loading bar moves and the main thread is never blocked for long. */
  async build(camera: THREE.PerspectiveCamera, progress: Progress): Promise<void> {
    progress(0.35, "Composing the sky");
    await nextFrame();
    this.refreshEnvironment();
    progress(0.6, "Compiling shaders");
    await nextFrame();
    this.renderer.setRenderTarget(this.post.sceneTarget);
    await this.renderer.compileAsync(this.scene, camera, this.scene);
    this.renderer.setRenderTarget(null);
    progress(0.95, "Mist settling");
    await nextFrame();
  }

  /** Re-renders the PMREM environment when the sky parameters change (dev tuning), never per frame. */
  private refreshEnvironment(): void {
    const key = `${params.sunElevationDeg}|${params.sunAzimuthDeg}|${params.skyHorizon}|${params.skyMid}|${params.skyZenith}|${params.cloudCover}`;
    if (key === this.envKey) return;
    this.envKey = key;
    this.envSky.mesh.position.set(0, 0, 0);
    this.envSky.syncParams();
    this.envTarget?.dispose();
    this.envTarget = this.pmrem.fromScene(this.envScene, 0, 0.1, 1000);
    this.scene.environment = this.envTarget.texture;
  }

  applyTier(tier: Tier): void {
    void tier; // only one tier uses this path
  }

  private reducedMotion = false;
  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
  }

  resize(width: number, height: number): void {
    const pr = this.renderer.getPixelRatio();
    this.post.resize(width, height, pr);
    this.water.resize(Math.round(width * pr), Math.round(height * pr));
  }

  frame(dt: number, seconds: number, camera: THREE.PerspectiveCamera): void {
    void dt;
    const t = this.reducedMotion ? seconds * 0.3 : seconds;
    sunDirection(this.sunDir);
    this.refreshEnvironment();
    this.sun.position.copy(this.sunDir).multiplyScalar(80).add(camera.position);
    this.sun.target.position.copy(camera.position);
    this.sky.tick(t, this.model.storm, camera);
    this.water.tick(t, camera);
    this.post.updateFog(this.model.latency, this.sunDir, t, camera);
    this.fog.color.copy(this.post.fogColor);

    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setRenderTarget(this.post.sceneTarget);
    this.renderer.clear();
    this.renderer.render(this.scene, camera);
    const r = this.renderer.info.render;
    this.lastCalls = r.calls;
    this.lastTriangles = r.triangles;
    this.post.render(this.renderer);
  }
  private lastCalls = 0;
  private lastTriangles = 0;

  info(): PathInfo {
    const envBytes = 256 * 256 * 6 * 8 * 1.5; // PMREM cube-UV atlas, half float, with mips
    const normalBytes = 256 * 256 * 4 * 1.33;
    return {
      calls: this.lastCalls + 3,
      triangles: this.lastTriangles + 3,
      gpuBytes: this.post.gpuBytes + this.water.gpuBytes + envBytes + normalBytes,
    };
  }

  dispose(): void {
    this.post.dispose();
    this.water.dispose();
    this.envTarget?.dispose();
    this.pmrem.dispose();
    this.normalMap.dispose();
    this.sky.material.dispose();
    this.envSky.material.dispose();
    this.sky.mesh.geometry.dispose();
    this.envSky.mesh.geometry.dispose();
  }
}

export async function createCinematicPath(
  renderer: THREE.WebGLRenderer,
  model: WorldModel,
  camera: THREE.PerspectiveCamera,
  progress: Progress,
): Promise<RenderPath> {
  progress(0.15, "Generating water");
  await nextFrame();
  const path = new CinematicPath(renderer, model);
  await path.build(camera, progress);
  return path;
}
