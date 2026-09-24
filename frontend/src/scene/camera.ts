/**
 * Camera until M2's scroll path: a slow cinematic drift around the archipelago plus subtle pointer
 * parallax, framed per render path (Cinematic sits low over the water, stylised higher so the
 * layout reads). Always drifting, EXCEPT under prefers-reduced-motion: then the camera holds still
 * and pointer parallax is off (the OS setting outranks the cinematic brief).
 */
import * as THREE from "three";
import type { RenderPath } from "../render/path";

const DRIFT_RAD_PER_S = 0.03;
const SWEEP_PERIOD_S = 110;
const DEFAULT_BASE_AZIMUTH = -0.75;
const PARALLAX_RAD = 0.06;

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private baseAzimuth = DEFAULT_BASE_AZIMUTH;
  private azimuth = DEFAULT_BASE_AZIMUTH;
  private islands: { x: number; z: number }[] = [];
  private sweepPhase = 0;
  /** Composition anchor (no drift, no parallax), shared with render paths for placement. */
  readonly base = { eye: new THREE.Vector3(), target: new THREE.Vector3(), spread: 0.6 };
  private readonly target = new THREE.Vector3();
  private distance = 24;
  private reducedMotion = false;
  private shot: RenderPath["shot"] = { elevation: 0.34, distance: 0.9, targetY: 0.6, sweep: 0 };
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
    if (shot.sweep > 0) this.azimuth = this.baseAzimuth;
  }

  /** Pointer position in -1..1 (x right, y up). */
  setPointer(x: number, y: number): void {
    this.pointer.set(x, y);
  }

  /** Frame the world: distance so the layout radius fits the narrower field of view. */
  frame(cx: number, cz: number, radius: number, islands: { x: number; z: number }[] = []): void {
    this.target.x = cx;
    this.target.z = cz;
    this.radius = radius;
    this.islands = islands;
    this.refit();
  }

  /** Azimuth of the base view direction (eye -> target), radians, atan2(x, z) convention. */
  get viewAzimuth(): number {
    return Math.atan2(this.base.target.x - this.base.eye.x, this.base.target.z - this.base.eye.z);
  }

  /**
   * Composed shots: pick the base azimuth whose view best separates the islands (largest minimum
   * angular gap, nothing hugging the frame edges), with a mild preference for the default so the
   * choice is stable. Deterministic for a given topology and aspect.
   */
  private chooseBaseAzimuth(flat: number, hFov: number): number {
    if (this.shot.sweep <= 0 || this.islands.length < 2) return DEFAULT_BASE_AZIMUTH;
    let best = DEFAULT_BASE_AZIMUTH;
    let bestScore = -Infinity;
    const angles: number[] = [];
    for (let k = 0; k < 36; k++) {
      const az = DEFAULT_BASE_AZIMUTH + (k / 36) * Math.PI * 2;
      const ex = this.target.x + Math.sin(az) * flat;
      const ez = this.target.z + Math.cos(az) * flat;
      const fwd = Math.atan2(this.target.x - ex, this.target.z - ez);
      angles.length = 0;
      let edge = Infinity;
      for (const isl of this.islands) {
        let a = Math.atan2(isl.x - ex, isl.z - ez) - fwd;
        a = Math.atan2(Math.sin(a), Math.cos(a));
        angles.push(a);
        edge = Math.min(edge, hFov / 2 - Math.abs(a));
      }
      angles.sort((p, q) => p - q);
      let gap = Infinity;
      for (let i = 1; i < angles.length; i++) gap = Math.min(gap, (angles[i] ?? 0) - (angles[i - 1] ?? 0));
      const turn = Math.abs(Math.atan2(Math.sin(az - DEFAULT_BASE_AZIMUTH), Math.cos(az - DEFAULT_BASE_AZIMUTH)));
      const score = gap - Math.max(0, 0.08 - edge) * 2 - turn * 0.01;
      if (score > bestScore) {
        bestScore = score;
        best = az;
      }
    }
    return best;
  }

  /** Portrait frames are narrow: look down a little more so islands separate vertically. */
  private get elevation(): number {
    return this.shot.elevation + (this.camera.aspect < 1 && this.shot.sweep > 0 ? 0.12 : 0);
  }

  private refit(): void {
    this.target.y = this.shot.targetY;
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    this.distance = (this.radius * this.shot.distance) / Math.tan(Math.min(vFov, hFov) / 2);
    const flat = Math.cos(this.elevation) * this.distance;
    this.baseAzimuth = this.chooseBaseAzimuth(flat, hFov);
    this.base.target.copy(this.target);
    this.base.spread = Math.tan(hFov / 2);
    this.base.eye.set(
      this.target.x + Math.sin(this.baseAzimuth) * flat,
      this.target.y + Math.sin(this.elevation) * this.distance,
      this.target.z + Math.cos(this.baseAzimuth) * flat,
    );
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
    this.refit();
  }

  tick(dtSeconds: number): void {
    if (!this.reducedMotion) {
      if (this.shot.sweep > 0) {
        this.sweepPhase += (dtSeconds * Math.PI * 2) / SWEEP_PERIOD_S;
        this.azimuth = this.baseAzimuth + this.shot.sweep * Math.sin(this.sweepPhase);
      } else {
        this.azimuth += DRIFT_RAD_PER_S * dtSeconds;
      }
    }
    const k = 1 - Math.exp(-2 * dtSeconds);
    const px = this.reducedMotion ? 0 : this.pointer.x;
    const py = this.reducedMotion ? 0 : this.pointer.y;
    this.parallax.x += (px - this.parallax.x) * k;
    this.parallax.y += (py - this.parallax.y) * k;
    const az = this.azimuth + this.parallax.x * PARALLAX_RAD;
    const el = Math.max(0.03, this.elevation + this.parallax.y * PARALLAX_RAD * 0.5);
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
