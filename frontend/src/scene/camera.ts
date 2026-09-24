/**
 * Camera until M2's scroll path: a slow cinematic drift around the archipelago plus subtle pointer
 * parallax, framed per render path (Cinematic sits low over the water, stylised higher so the
 * layout reads). Always drifting, EXCEPT under prefers-reduced-motion: then the camera holds still
 * and pointer parallax is off (the OS setting outranks the cinematic brief).
 */
import * as THREE from "three";
import type { RenderPath } from "../render/path";

const DRIFT_RAD_PER_S = 0.03;
const PARALLAX_RAD = 0.06;

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private azimuth = -0.35;
  private readonly target = new THREE.Vector3();
  private distance = 24;
  private reducedMotion = false;
  private shot: RenderPath["shot"] = { elevation: 0.34, distance: 0.9, targetY: 0.6 };
  private radius = 10;
  private readonly pointer = new THREE.Vector2();
  private readonly parallax = new THREE.Vector2();

  constructor() {
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.3, 2000);
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
  }

  setShot(shot: RenderPath["shot"]): void {
    this.shot = shot;
    this.refit();
  }

  /** Pointer position in -1..1 (x right, y up). */
  setPointer(x: number, y: number): void {
    this.pointer.set(x, y);
  }

  /** Frame the world: distance so the layout radius fits the narrower field of view. */
  frame(cx: number, cz: number, radius: number): void {
    this.target.x = cx;
    this.target.z = cz;
    this.radius = radius;
    this.refit();
  }

  private refit(): void {
    this.target.y = this.shot.targetY;
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    this.distance = (this.radius * this.shot.distance) / Math.tan(Math.min(vFov, hFov) / 2);
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
    this.refit();
  }

  tick(dtSeconds: number): void {
    if (!this.reducedMotion) this.azimuth += DRIFT_RAD_PER_S * dtSeconds;
    const k = 1 - Math.exp(-2 * dtSeconds);
    const px = this.reducedMotion ? 0 : this.pointer.x;
    const py = this.reducedMotion ? 0 : this.pointer.y;
    this.parallax.x += (px - this.parallax.x) * k;
    this.parallax.y += (py - this.parallax.y) * k;
    const az = this.azimuth + this.parallax.x * PARALLAX_RAD;
    const el = Math.max(0.03, this.shot.elevation + this.parallax.y * PARALLAX_RAD * 0.5);
    const flat = Math.cos(el) * this.distance;
    this.camera.position.set(
      this.target.x + Math.sin(az) * flat,
      this.target.y + Math.sin(el) * this.distance,
      this.target.z + Math.cos(az) * flat,
    );
    this.camera.lookAt(this.target);
  }

  /** Compass heading in degrees, 0 = looking north (-z), clockwise. */
  get heading(): number {
    const deg = THREE.MathUtils.radToDeg(Math.PI - this.azimuth);
    return ((deg % 360) + 360) % 360;
  }
}
