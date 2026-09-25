/**
 * Weather for the stylised (Balanced/Simple) path, from the shared model's eased values
 * (rules in weather-rules.ts): fog thickens and turns murky with latency, mist settles over each
 * slow island, dark storm clouds gather over each failing one, and lightning strikes while a
 * storm is on. Mist and clouds are ONE instanced, camera-facing, alpha-blended billboard mesh
 * (one draw call); the soft puff shape is computed in the shader, so there are no textures.
 * Cinematic has its own, heavier version (cinematic/drama.ts).
 */
import * as THREE from "three";
import { pinPositionAttribute } from "./instancing";
import type { WorldModel } from "./model";
import { PALETTE } from "./palette";
import { unitNoise } from "./layout";
import { isletScale, SILHOUETTE_TOP, silhouetteFor } from "./silhouette";
import { fogDensityScale, LightningClock, mistAmount } from "./weather-rules";

const MAX = 192;
const PUFFS_PER_ISLAND = 3;
const MIST = new THREE.Color(0xbccbc4);
const CLOUD = new THREE.Color(0x2c2a3a);
const MURK = new THREE.Color(0x3b3a45);

export class Weather {
  readonly mesh: THREE.Mesh;
  /** 0..1 current lightning flash (the path brightens its lights and fog with it). */
  flash = 0;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly pos: THREE.InstancedBufferAttribute;
  private readonly col: THREE.InstancedBufferAttribute;
  private readonly lightning = new LightningClock();
  private readonly baseFog = new THREE.Color(PALETTE.fog);

  constructor() {
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.setIndex(quad.getIndex());
    this.geo.setAttribute("position", quad.getAttribute("position"));
    this.pos = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4); // xyz + size
    this.col = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4); // rgb + opacity
    this.pos.setUsage(THREE.DynamicDrawUsage);
    this.col.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute("aPos", this.pos);
    this.geo.setAttribute("aCol", this.col);
    this.geo.instanceCount = 0;
    const material = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        attribute vec4 aPos; attribute vec4 aCol; varying vec4 vCol; varying vec2 vUv;
        void main() {
          vCol = aCol;
          vUv = position.xy;
          vec4 mv = viewMatrix * vec4(aPos.xyz, 1.0);
          mv.xy += position.xy * aPos.w * vec2(1.6, 1.0); // wider than tall, like cloud banks
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec4 vCol; varying vec2 vUv;
        void main() {
          float r = length(vUv * vec2(1.0, 1.3)) * 2.0;
          float a = smoothstep(1.0, 0.0, r);
          // Darker, denser core: reads as a cloud bank rather than a flat disc.
          vec3 c = vCol.rgb * (0.75 + 0.25 * r);
          gl_FragColor = vec4(c, vCol.a * a * a);
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(this.geo, material);
    pinPositionAttribute(material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
  }

  /** Update fog, puffs and lightning. `fog` is the scene fog; `baseDensity` its healthy density. */
  update(
    model: WorldModel,
    fog: THREE.FogExp2,
    baseDensity: number,
    seconds: number,
    reducedMotion: boolean,
  ): void {
    fog.density = baseDensity * fogDensityScale(model.latency, model.storm);
    fog.color.copy(this.baseFog).lerp(MURK, Math.min(1, model.latency * 0.7 + model.storm * 0.5));
    this.flash = this.lightning.tick(seconds, model.storm, reducedMotion);
    if (this.flash > 0) fog.color.lerp(MIST, this.flash * 0.5);

    let n = 0;
    {
      const drift = reducedMotion ? 0 : seconds;
      for (const isl of model.islands.values()) {
        const h = SILHOUETTE_TOP[silhouetteFor(isl)] * isletScale(isl.scale);
        const mist = mistAmount(isl.p95) * (1 - isl.weight.offline);
        const storm = isl.weight.failing;
        for (let k = 0; k < PUFFS_PER_ISLAND && n + 2 <= MAX; k++) {
          const ox = unitNoise(isl.id, k) * 1.6 + Math.sin(drift * 0.15 + k * 2.1) * 0.4;
          const oz = unitNoise(isl.id, k + 7) * 1.6;
          if (mist > 0.01) {
            // Low banks hugging the islet, thickest at the waterline.
            this.pos.setXYZW(n, isl.place.x + ox, 0.35 + k * 0.3, isl.place.z + oz, 4.2 + k * 0.7);
            this.col.setXYZW(n, MIST.r, MIST.g, MIST.b, mist * 0.75);
            n += 1;
          }
          if (storm > 0.01) {
            this.pos.setXYZW(n, isl.place.x + ox * 1.3, h + 2.0 + k * 0.4, isl.place.z + oz * 1.3, 5.2 + k * 0.9);
            this.col.setXYZW(n, CLOUD.r, CLOUD.g, CLOUD.b, storm * 0.62);
            n += 1;
          }
        }
      }
    }
    this.geo.instanceCount = n;
    this.pos.needsUpdate = true;
    this.col.needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
