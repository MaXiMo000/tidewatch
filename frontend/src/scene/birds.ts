/**
 * A small flock of herons skimming low across the far channel now and then: dark silhouettes over
 * the moonlit water, the clearest "this world is alive" cue in an otherwise still frame. One instanced draw call of
 * ~10-triangle birds; the CPU moves the flock (a handful of matrix writes per frame) and the vertex
 * shader beats the wings. Hidden under prefers-reduced-motion.
 */
import * as THREE from "three";
import { pinPositionAttribute } from "./instancing";
import type { ViewBase } from "../render/path";
import { mulberry32 } from "./random";

const MAX_BIRDS = 9;
/** Seconds between the starts of two passes, and how fast the flock flies (world units/s). */
const CYCLE_S = 42;
const SPEED = 5;

/** One bird, facing +z, wings along x. Wing vertices flap by |x| in the shader. */
function birdGeometry(): THREE.BufferGeometry {
  const p: number[] = [];
  const tri = (a: number[], b: number[], c: number[]): void => {
    p.push(...a, ...b, ...c);
  };
  // Body (a thin diamond) and a forked tail.
  tri([0, 0, 0.5], [-0.06, 0, 0], [0.06, 0, 0]);
  tri([-0.06, 0, 0], [0, 0, -0.4], [0.06, 0, 0]);
  tri([0, 0, -0.35], [-0.12, 0, -0.62], [0.12, 0, -0.62]);
  for (const s of [-1, 1]) {
    // Bent wing: inner panel to the wrist, then a swept outer panel to the tip.
    const rf = [0.05 * s, 0, 0.16];
    const rb = [0.05 * s, 0, -0.12];
    const ef = [0.48 * s, 0, 0.1];
    const eb = [0.46 * s, 0, -0.12];
    const tip = [1.0 * s, 0, -0.24];
    tri(rf, rb, eb);
    tri(rf, eb, ef);
    tri(ef, eb, tip);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  return g;
}

export class Birds {
  readonly mesh: THREE.InstancedMesh;
  private readonly uTime = { value: 0 };
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly forward = new THREE.Vector3(0, 0, 1);
  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly side = new THREE.Vector3();

  constructor() {
    const material = new THREE.MeshBasicMaterial({ color: 0x0b0d10, side: THREE.DoubleSide });
    material.onBeforeCompile = (shader) => {
      shader.uniforms["uTime"] = this.uTime;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uTime;")
        .replace(
          "#include <begin_vertex>",
          /* glsl */ `#include <begin_vertex>
          {
            float ph = float(gl_InstanceID) * 1.93;
            // Bursts of flapping between glides, like a heron's slow beat.
            float beat = sin(uTime * 5.2 + ph);
            float glide = smoothstep(-0.2, 0.6, sin(uTime * 0.45 + ph * 0.7));
            float w = abs(transformed.x);
            transformed.y += beat * glide * w * 0.55 + (1.0 - glide) * w * 0.12;
            transformed.y -= step(0.47, w) * (w - 0.47) * beat * glide * 0.4; // wrist bend
          }`,
        );
    };
    material.customProgramCacheKey = () => "tw-birds";
    this.mesh = new THREE.InstancedMesh(birdGeometry(), material, MAX_BIRDS);
    pinPositionAttribute(material);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }

  /** Places the flock for time `t` (seconds) relative to the camera's base view. */
  tick(t: number, view: ViewBase, reducedMotion: boolean): void {
    this.uTime.value = t;
    const cycle = Math.floor(t / CYCLE_S);
    const rnd = mulberry32(0xb1d5 + cycle);
    // Each pass: crosses the view laterally, beyond the archipelago, low over the water (the frame
    // looks down the channel; the sky is only a sliver at the top).
    const u = this.dir.copy(view.target).sub(view.eye).setY(0).normalize();
    const v = this.side.set(-u.z, 0, u.x);
    const depth = view.eye.distanceTo(view.target) + 8 + rnd() * 22;
    const halfWidth = depth * view.spread * 1.25 + 6;
    const dirSign = rnd() < 0.5 ? -1 : 1;
    const height = 2.5 + rnd() * 3.5;
    const drift = (rnd() - 0.5) * 0.35; // not perfectly parallel to the frame
    this.from.copy(view.eye).addScaledVector(u, depth).addScaledVector(v, -dirSign * halfWidth).setY(height);
    this.to.copy(view.eye).addScaledVector(u, depth * (1 + drift)).addScaledVector(v, dirSign * halfWidth).setY(height + rnd() * 2);
    const flight = (2 * halfWidth) / SPEED;
    const local = t - cycle * CYCLE_S;
    const n = 4 + Math.floor(rnd() * (MAX_BIRDS - 3));
    if (reducedMotion || local > flight || rnd() < 0.2) {
      this.mesh.count = 0; // between passes, and some cycles skip entirely
      return;
    }
    const k = local / flight;
    this.dir.copy(this.to).sub(this.from).normalize();
    this.q.setFromUnitVectors(this.forward, this.dir);
    const lateral = this.side.crossVectors(this.up, this.dir).normalize();
    for (let i = 0; i < n; i++) {
      // Loose V: each bird trails the leader, alternating sides, with a little wander.
      const rank = Math.ceil(i / 2);
      const sideSign = i % 2 === 0 ? 1 : -1;
      const wander = Math.sin(t * 0.7 + i * 2.1) * 0.35;
      this.p.lerpVectors(this.from, this.to, k)
        .addScaledVector(this.dir, -rank * 1.6)
        .addScaledVector(lateral, sideSign * rank * 1.3 + wander)
        .setY(this.p.y + Math.sin(t * 0.9 + i) * 0.25 + rank * 0.15);
      this.s.setScalar(0.55 + ((i * 37) % 10) * 0.02);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}
