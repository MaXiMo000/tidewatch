/**
 * Every lantern and status glow in ONE instanced, camera-facing billboard mesh (was one Sprite
 * draw call each, twice per frame with the reflection pass). Per-instance position, size, colour
 * and opacity live in dynamic attributes the islands rewrite each frame (~30 instances).
 */
import * as THREE from "three";

const MAX = 128;

export class GlowBatch {
  readonly mesh: THREE.Mesh;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly pos: THREE.InstancedBufferAttribute;
  private readonly col: THREE.InstancedBufferAttribute;
  private n = 0;

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
          mv.xy += position.xy * aPos.w;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec4 vCol; varying vec2 vUv;
        void main() {
          float r = length(vUv) * 2.0;
          float a = exp(-r * r * 4.5) + 0.35 * exp(-r * r * 40.0);
          gl_FragColor = vec4(vCol.rgb * a * vCol.a, 0.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(this.geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  begin(): void {
    this.n = 0;
  }

  push(p: THREE.Vector3, size: number, colour: THREE.Color, opacity: number): void {
    if (this.n >= MAX) return;
    this.pos.setXYZW(this.n, p.x, p.y, p.z, size);
    this.col.setXYZW(this.n, colour.r, colour.g, colour.b, opacity);
    this.n += 1;
  }

  end(): void {
    this.geo.instanceCount = this.n;
    this.pos.needsUpdate = true;
    this.col.needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
