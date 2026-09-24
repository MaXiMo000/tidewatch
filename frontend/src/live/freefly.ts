/**
 * Live mode's free camera: an orbit you steer. Drag (mouse) or two fingers (touch) to turn,
 * pinch or W/S to move in and out, A/D to circle, R/F to tilt, Shift+drag to slide along the
 * water, 0 or Home to hand back to the automatic drift. Pure state + clamping (unit-tested);
 * main.ts wires the input and applies pose() over the live rig while engaged.
 *
 * Limits come from the render path: Balanced/Simple may circle the whole archipelago; Cinematic
 * stays close to its composed view, inside the channel its forest keeps clear.
 */
import type { Pose, Vec3 } from "../scene/story";

export interface FlyLimits {
  /** Allowed yaw either side of the starting yaw (Infinity = all the way round). */
  readonly yawRange: number;
  readonly pitchMin: number;
  readonly pitchMax: number;
  /** Distance limits as multiples of the starting distance. */
  readonly nearFactor: number;
  readonly farFactor: number;
  /** How far the orbit centre may slide, as a multiple of the world radius. */
  readonly panFactor: number;
}

export const OPEN_WATER: FlyLimits = {
  yawRange: Infinity,
  pitchMin: 0.08,
  pitchMax: 1.35,
  nearFactor: 0.35,
  farFactor: 2.2,
  panFactor: 1,
};

export const CHANNEL: FlyLimits = {
  yawRange: 0.3,
  pitchMin: 0.04,
  pitchMax: 0.45,
  nearFactor: 0.55,
  farFactor: 1.1,
  panFactor: 0.12,
};

export type FlyKey = "in" | "out" | "left" | "right" | "up" | "down";

const TURN_PER_S = 1.2; // rad/s for held keys
const ZOOM_PER_S = 0.9; // e-folds per second
const TILT_PER_S = 0.8;

export class FreeFly {
  engaged = false;
  private yaw = 0;
  private pitch = 0.3;
  private dist = 20;
  private readonly centre: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly home: Vec3 = { x: 0, y: 0, z: 0 };
  private yaw0 = 0;
  private dist0 = 20;
  private radius = 10;
  private limits: FlyLimits = OPEN_WATER;
  private readonly held = new Set<FlyKey>();

  /** Take over from the camera's current pose (call on the first drag/key in live mode). */
  engage(from: Pose, radius: number, limits: FlyLimits): void {
    const dx = from.eye.x - from.target.x;
    const dy = from.eye.y - from.target.y;
    const dz = from.eye.z - from.target.z;
    this.dist = this.dist0 = Math.max(1, Math.hypot(dx, dy, dz));
    this.yaw = this.yaw0 = Math.atan2(dx, dz);
    this.pitch = Math.asin(Math.min(1, Math.max(-1, dy / this.dist)));
    this.centre.x = this.home.x = from.target.x;
    this.centre.y = this.home.y = from.target.y;
    this.centre.z = this.home.z = from.target.z;
    this.radius = radius;
    this.limits = limits;
    this.engaged = true;
    this.clamp();
  }

  /** Back to the automatic camera. */
  release(): void {
    this.engaged = false;
    this.held.clear();
  }

  /** Turn by a drag: dx, dy in radians. */
  turn(dYaw: number, dPitch: number): void {
    this.yaw += dYaw;
    this.pitch += dPitch;
    this.clamp();
  }

  /** Zoom by a factor (< 1 = closer). */
  zoom(factor: number): void {
    this.dist *= factor;
    this.clamp();
  }

  /** Slide the orbit centre along the water, in screen-aligned units (right, forward). */
  pan(right: number, forward: number): void {
    const s = Math.sin(this.yaw);
    const c = Math.cos(this.yaw);
    this.centre.x += right * c - forward * s;
    this.centre.z += -right * s - forward * c;
    this.clamp();
  }

  setKey(key: FlyKey, down: boolean): void {
    if (down) this.held.add(key);
    else this.held.delete(key);
  }

  get moving(): boolean {
    return this.held.size > 0;
  }

  /** Apply held keys for dt seconds. */
  tick(dt: number): void {
    if (!this.engaged || this.held.size === 0) return;
    const h = this.held;
    if (h.has("left")) this.yaw -= TURN_PER_S * dt;
    if (h.has("right")) this.yaw += TURN_PER_S * dt;
    if (h.has("up")) this.pitch += TILT_PER_S * dt;
    if (h.has("down")) this.pitch -= TILT_PER_S * dt;
    if (h.has("in")) this.dist *= Math.exp(-ZOOM_PER_S * dt);
    if (h.has("out")) this.dist *= Math.exp(ZOOM_PER_S * dt);
    this.clamp();
  }

  pose(out: Pose): void {
    const flat = Math.cos(this.pitch) * this.dist;
    out.target.x = this.centre.x;
    out.target.y = this.centre.y;
    out.target.z = this.centre.z;
    out.eye.x = this.centre.x + Math.sin(this.yaw) * flat;
    out.eye.y = this.centre.y + Math.sin(this.pitch) * this.dist;
    out.eye.z = this.centre.z + Math.cos(this.yaw) * flat;
  }

  private clamp(): void {
    const l = this.limits;
    if (Number.isFinite(l.yawRange)) {
      this.yaw = Math.min(this.yaw0 + l.yawRange, Math.max(this.yaw0 - l.yawRange, this.yaw));
    }
    this.pitch = Math.min(l.pitchMax, Math.max(l.pitchMin, this.pitch));
    this.dist = Math.min(this.dist0 * l.farFactor, Math.max(this.dist0 * l.nearFactor, this.dist));
    const max = this.radius * l.panFactor;
    const ox = this.centre.x - this.home.x;
    const oz = this.centre.z - this.home.z;
    const off = Math.hypot(ox, oz);
    if (off > max) {
      this.centre.x = this.home.x + (ox / off) * max;
      this.centre.z = this.home.z + (oz / off) * max;
    }
  }
}
