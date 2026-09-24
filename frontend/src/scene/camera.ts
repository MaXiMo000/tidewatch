/**
 * M1 camera: a slow idle orbit around the archipelago (the scroll-driven path arrives in M2, free
 * fly in M4). Reduced motion stops the orbit; the view stays readable either way.
 */
import * as THREE from "three";

const ORBIT_RAD_PER_S = 0.035;
const ELEVATION = 0.34; // radians above the horizon: low enough to keep the dusk sky in view

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private azimuth = -0.35;
  private readonly target = new THREE.Vector3();
  private distance = 24;
  private reducedMotion = false;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 1200);
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
  }

  /** Frame the world: distance so the layout radius fits the narrower field of view. */
  frame(cx: number, cz: number, radius: number): void {
    this.target.set(cx, 0.6, cz);
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    this.distance = (radius * 0.9) / Math.tan(Math.min(vFov, hFov) / 2);
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
  }

  tick(dtSeconds: number): void {
    if (!this.reducedMotion) this.azimuth += ORBIT_RAD_PER_S * dtSeconds;
    const flat = Math.cos(ELEVATION) * this.distance;
    this.camera.position.set(
      this.target.x + Math.sin(this.azimuth) * flat,
      this.target.y + Math.sin(ELEVATION) * this.distance,
      this.target.z + Math.cos(this.azimuth) * flat,
    );
    this.camera.lookAt(this.target);
  }

  /** Compass heading in degrees, 0 = looking north (-z), clockwise. */
  get heading(): number {
    const deg = THREE.MathUtils.radToDeg(Math.PI - this.azimuth);
    return ((deg % 360) + 360) % 360;
  }
}
