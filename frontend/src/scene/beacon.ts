/**
 * The film's hero request: one warm light that the camera follows from the open water, through
 * the gateway and along the route (scene/story.ts). A tiny core plus the shared baked-glow sprite:
 * two draw calls, no textures of its own, identical on every tier. main.ts owns it and attaches it
 * to whichever render path is active (an Object3D has one parent, so attaching moves it).
 */
import * as THREE from "three";
import { glowMaterial } from "./glow";
import type { Vec3 } from "./story";

const WARM = 0xffe2b8;

export class Beacon {
  readonly root = new THREE.Group();
  private readonly core: THREE.Mesh;
  private readonly halo: THREE.Sprite;
  private fade = 0;

  constructor() {
    const coreMat = new THREE.MeshBasicMaterial({ color: WARM, fog: false, toneMapped: false });
    this.core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.14, 1), coreMat);
    const haloMat = glowMaterial(WARM, 0.9);
    haloMat.fog = false;
    haloMat.toneMapped = false;
    this.halo = new THREE.Sprite(haloMat);
    this.halo.scale.setScalar(1.3);
    this.root.add(this.core, this.halo);
    this.root.visible = false;
    this.root.renderOrder = 10;
  }

  private warmFrames = 0;

  /**
   * Draw it invisibly for a couple of frames (call after attaching it to a path). three.js compiles
   * shaders on first draw, against the real scene's settings; the beacon first appears mid-scroll
   * (chapter 2), so without this that frame would stall for a shader compile.
   */
  prewarm(): void {
    this.warmFrames = 2;
  }

  /** Place it (or hide it with null). Fades in and out over ~0.3 s instead of popping. */
  update(at: Vec3 | null, dt: number, seconds: number, reducedMotion: boolean): void {
    const k = 1 - Math.exp(-8 * dt);
    this.fade += ((at ? 1 : 0) - this.fade) * k;
    if (at) this.root.position.set(at.x, at.y, at.z);
    this.root.visible = this.fade > 0.02;
    if (!this.root.visible && this.warmFrames > 0) {
      this.warmFrames -= 1;
      this.root.visible = true;
      this.core.scale.setScalar(0.001);
      this.halo.scale.setScalar(0.001);
      (this.halo.material as THREE.SpriteMaterial).opacity = 0;
      return;
    }
    if (!this.root.visible) return;
    const pulse = reducedMotion ? 1 : 1 + 0.12 * Math.sin(seconds * 6);
    this.halo.scale.setScalar(1.3 * pulse * this.fade);
    this.core.scale.setScalar(Math.max(0.01, this.fade));
    (this.halo.material as THREE.SpriteMaterial).opacity = 0.9 * this.fade;
  }

  dispose(): void {
    this.core.geometry.dispose();
    (this.core.material as THREE.Material).dispose();
    (this.halo.material as THREE.Material).dispose();
  }
}
