/**
 * Health drama for the Cinematic path. Everything is driven by the shared model's EASED values
 * (status weights, storm share, latency), so incidents build and recover smoothly - nothing pops
 * between 1 Hz snapshots.
 *
 *  - storm clouds: dark cloud billboards gather above each FAILING islet (opacity = its eased
 *    failing weight) and the whole sky darkens with the failing share
 *  - rain: GPU-animated streaks in a box around the view, intensity = storm
 *  - lightning: while a storm is on, a flash every 3-9 s (never more than one per 2.5 s, so far
 *    under the 3-flashes-per-second photosensitivity limit); disabled under reduced motion
 *  - fireflies: slow, warm GPU points over the banks when all is calm; they fade out in a storm
 */
import * as THREE from "three";
import { pinPositionAttribute } from "../scene/instancing";
import type { WorldModel } from "../scene/model";
import { mulberry32 } from "./textures";

function cloudTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const rnd = mulberry32(0xc10d);
    for (let i = 0; i < 60; i++) {
      const x = size * (0.2 + rnd() * 0.6);
      const y = size * (0.35 + rnd() * 0.35);
      const r = size * (0.08 + rnd() * 0.16);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, "rgba(255,255,255,0.35)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const RAIN = 2400;
const FIREFLIES = 160;

export class Drama {
  readonly root = new THREE.Group();
  /** 0..1 current lightning flash intensity (exposure + sky + light boost). */
  flash = 0;
  /** 0..1 eased rain intensity (the water uses it for ripples). */
  rain = 0;

  private readonly cloudTex = cloudTexture();
  private readonly clouds: { sprite: THREE.Sprite; id: string; base: number }[] = [];
  private cloudVersion = -1;
  private readonly rainMesh: THREE.Mesh;
  private readonly rainMat: THREE.ShaderMaterial;
  private readonly flies: THREE.Points;
  private readonly fliesMat: THREE.ShaderMaterial;
  private nextFlash = 4;
  private flashStart = -10;
  private lastFlash = -10;
  private readonly rnd = mulberry32(0x11f7);

  constructor() {
    // Rain: thin vertical streak quads; each instance falls through a 60 x 26 x 60 box.
    const streak = new THREE.PlaneGeometry(0.012, 0.5);
    const rainGeo = new THREE.InstancedBufferGeometry();
    rainGeo.setIndex(streak.getIndex());
    rainGeo.setAttribute("position", streak.getAttribute("position"));
    const seeds = new Float32Array(RAIN * 4);
    const r = mulberry32(0x2a1);
    for (let i = 0; i < RAIN; i++) seeds.set([r(), r(), r(), r()], i * 4);
    rainGeo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 4));
    rainGeo.instanceCount = RAIN;
    this.rainMat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        uniform float uTime; uniform vec3 uCentre; attribute vec4 aSeed; varying float vA;
        void main() {
          vec3 box = vec3(60.0, 26.0, 60.0);
          float y = fract(aSeed.y - uTime * (0.55 + aSeed.w * 0.25)) * box.y;
          vec3 base = uCentre + vec3((aSeed.x - 0.5) * box.x, y, (aSeed.z - 0.5) * box.z);
          // Camera-facing streak around the vertical axis.
          vec3 toCam = normalize(vec3(cameraPosition.x - base.x, 0.0, cameraPosition.z - base.z));
          vec3 right = vec3(toCam.z, 0.0, -toCam.x);
          vec3 world = base + right * position.x + vec3(0.12, 1.0, 0.0) * position.y;
          vA = 0.35 + 0.65 * aSeed.w;
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uAmount; varying float vA;
        void main() { gl_FragColor = vec4(vec3(0.62, 0.68, 0.72), 0.16 * vA * uAmount); }`,
      uniforms: { uTime: { value: 0 }, uCentre: { value: new THREE.Vector3() }, uAmount: { value: 0 } },
      transparent: true,
      depthWrite: false,
    });
    this.rainMesh = new THREE.Mesh(rainGeo, this.rainMat);
    pinPositionAttribute(this.rainMat);
    this.rainMesh.frustumCulled = false;
    this.rainMesh.visible = false;

    // Fireflies: points drifting on slow noise paths, blinking softly (< 0.5 Hz).
    const fp = new Float32Array(FIREFLIES * 3);
    const fs = new Float32Array(FIREFLIES);
    const fr = mulberry32(0xf1f1);
    for (let i = 0; i < FIREFLIES; i++) {
      fp.set([(fr() - 0.5) * 2, 0.4 + fr() * 3.2, (fr() - 0.5) * 2], i * 3);
      fs[i] = fr();
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute("position", new THREE.BufferAttribute(fp, 3));
    fg.setAttribute("aSeed", new THREE.BufferAttribute(fs, 1));
    this.fliesMat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        uniform float uTime; uniform vec4 uArea; uniform float uPixel; attribute float aSeed; varying float vB;
        void main() {
          vec3 p = vec3(uArea.x + position.x * uArea.z, position.y, uArea.y + position.z * uArea.w);
          float t = uTime * 0.25 + aSeed * 40.0;
          p += vec3(sin(t * 1.3) * 1.4, sin(t * 2.1) * 0.35, cos(t * 1.1) * 1.4);
          vB = pow(0.5 + 0.5 * sin(uTime * (0.6 + aSeed * 0.9) + aSeed * 30.0), 3.0);
          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_PointSize = uPixel * (0.9 + vB) / max(-mv.z, 1.0) * 40.0;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uAmount; varying float vB;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d) * vB * uAmount;
          gl_FragColor = vec4(vec3(1.0, 0.9, 0.45) * 6.0 * a, a);
        }`,
      uniforms: {
        uTime: { value: 0 },
        uArea: { value: new THREE.Vector4() },
        uPixel: { value: 1 },
        uAmount: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.flies = new THREE.Points(fg, this.fliesMat);
    this.flies.frustumCulled = false;
    this.root.add(this.rainMesh, this.flies);
  }

  get gpuBytes(): number {
    return 256 * 256 * 4;
  }

  /**
   * @param seconds animation clock; @param reducedMotion disables lightning and slows the rest.
   */
  update(model: WorldModel, seconds: number, dt: number, camera: THREE.Camera, pixelRatio: number, reducedMotion: boolean): void {
    this.syncClouds(model);
    for (const c of this.clouds) {
      const w = model.islands.get(c.id)?.weight.failing ?? 0;
      const m = c.sprite.material;
      m.opacity = w * c.base;
      c.sprite.visible = m.opacity > 0.01;
      if (!reducedMotion) c.sprite.material.rotation += dt * 0.01;
    }

    // Any failing service brings rain; more failing -> heavier. Eased by the model already.
    const target = model.storm > 0.02 ? Math.min(1, 0.45 + model.storm * 1.6) : 0;
    this.rain += (target - this.rain) * (1 - Math.exp(-dt * 0.8));
    this.rainMesh.visible = this.rain > 0.02;
    const ru = this.rainMat.uniforms;
    if (ru["uTime"]) ru["uTime"].value = reducedMotion ? seconds * 0.35 : seconds;
    if (ru["uAmount"]) ru["uAmount"].value = this.rain;
    (ru["uCentre"]?.value as THREE.Vector3).set(model.bounds.cx, 0, model.bounds.cz);

    // Lightning (never under reduced motion; at most one strike per 2.5 s).
    if (!reducedMotion && this.rain > 0.3 && seconds >= this.nextFlash && seconds - this.lastFlash > 2.5) {
      this.flashStart = seconds;
      this.lastFlash = seconds;
      this.nextFlash = seconds + 3 + this.rnd() * 6;
    }
    const age = seconds - this.flashStart;
    // A strike = a bright main flash + one smaller re-strike (both inside ~0.35 s: one "flash").
    this.flash = reducedMotion
      ? 0
      : Math.max(0, 1 - age / 0.12) * (age >= 0 ? 1 : 0) + Math.max(0, 0.55 - Math.abs(age - 0.22) / 0.08) * 0.8;

    const fu = this.fliesMat.uniforms;
    if (fu["uTime"]) fu["uTime"].value = reducedMotion ? seconds * 0.2 : seconds;
    if (fu["uAmount"]) fu["uAmount"].value = Math.max(0, 1 - this.rain * 1.5) * (1 - model.latency);
    if (fu["uPixel"]) fu["uPixel"].value = pixelRatio;
    const R = model.bounds.radius + 6;
    (fu["uArea"]?.value as THREE.Vector4).set(model.bounds.cx, model.bounds.cz, R, R);
    void camera;
  }

  private syncClouds(model: WorldModel): void {
    if (this.cloudVersion === model.topologyVersion) return;
    this.cloudVersion = model.topologyVersion;
    for (const c of this.clouds) {
      this.root.remove(c.sprite);
      c.sprite.material.dispose();
    }
    this.clouds.length = 0;
    const r = mulberry32(0xc1d + model.topologyVersion);
    for (const isl of model.islands.values()) {
      for (let k = 0; k < 4; k++) {
        const m = new THREE.SpriteMaterial({
          map: this.cloudTex,
          color: 0x15131a,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          fog: false,
          rotation: r() * Math.PI,
        });
        const sprite = new THREE.Sprite(m);
        sprite.position.set(isl.place.x + (r() - 0.5) * 6, 13 + r() * 5, isl.place.z + (r() - 0.5) * 6);
        const s = 12 + r() * 8;
        sprite.scale.set(s, s * 0.6, 1);
        sprite.visible = false;
        this.root.add(sprite);
        this.clouds.push({ sprite, id: isl.id, base: 0.75 + r() * 0.2 });
      }
    }
  }

  dispose(): void {
    for (const c of this.clouds) c.sprite.material.dispose();
    this.cloudTex.dispose();
    this.rainMesh.geometry.dispose();
    this.rainMat.dispose();
    this.flies.geometry.dispose();
    this.fliesMat.dispose();
  }
}
