/**
 * The lighthouse's sweeping beam: two opposed shafts of light turning slowly from the lamp room,
 * brightest at the lens and fading with distance and toward their edges. Each shaft is ONE flat
 * ribbon that turns about its own axis to face the camera (the classic light-shaft trick): a
 * single layer of fill, never a cone the camera can end up inside (a cone version cost ~40 ms a
 * frame on an integrated GPU when it swept past the viewer). Additive, one instanced draw call for
 * every lighthouse; dark when its island is offline. The sweep turns in the vertex shader (a time
 * uniform): the instance buffer only changes when a lamp moves, never per frame.
 */
import * as THREE from "three";
import { pinPositionAttribute } from "./instancing";

const MAX_LAMPS = 4;
const LENGTH = 13;
const WIDTH_END = 2.6;
const TURN_RAD_PER_S = 0.55;

const vertexShader = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying float vSide;
#include <fog_pars_vertex>
void main() {
  // position.x: 0 at the lens .. 1 at the far end; position.y: -0.5 .. 0.5 across.
  // Instance: lamp position + width scale. Pairs of instances share a lamp, half a turn apart.
  vec3 lamp = instanceMatrix[3].xyz;
  float widthScale = instanceMatrix[1].y;
  float a = uTime * ${TURN_RAD_PER_S.toFixed(3)} + float(gl_InstanceID / 2) * 1.7 + float(gl_InstanceID % 2) * 3.14159265;
  vec3 axis = normalize(vec3(cos(a), -0.05, -sin(a))); // slightly down, like a lens aimed at the water
  vec3 along = lamp + axis * position.x * ${LENGTH.toFixed(1)};
  vec3 toCam = normalize(cameraPosition - along);
  vec3 side = cross(axis, toCam);
  float sideLen = length(side);
  side = sideLen > 1e-4 ? side / sideLen : vec3(0.0, 1.0, 0.0);
  float width = mix(0.12, ${WIDTH_END.toFixed(1)}, position.x) * widthScale;
  vec3 world = along + side * position.y * width;
  vec4 mvPosition = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  vUv = position.xy;
  // Seen end-on the ribbon collapses to a line: fade it rather than let it flicker.
  vSide = smoothstep(0.05, 0.35, sideLen);
  #include <fog_vertex>
}`;

const fragmentShader = /* glsl */ `
uniform vec3 uColor;
varying vec2 vUv;
varying float vSide;
#include <fog_pars_fragment>
void main() {
  float x = vUv.x;
  float across = 1.0 - pow(abs(vUv.y) * 2.0, 1.6);
  float a = pow(1.0 - x, 2.4) * smoothstep(0.0, 0.03, x) * across * vSide;
  gl_FragColor = vec4(uColor * a, 1.0);
  // Additive light fades INTO fog (to nothing), not toward the fog colour.
  #if defined(USE_FOG) && defined(FOG_EXP2)
    gl_FragColor.rgb *= exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #endif
}`;

export class Beams {
  readonly mesh: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly uTime = { value: 0 };
  /** Last written lamp values (x, y, z, width per lamp) and count: skip the upload when unchanged. */
  private readonly written = new Float32Array(MAX_LAMPS * 4);
  private writtenCount = -1;

  constructor() {
    const geometry = new THREE.PlaneGeometry(1, 1, 8, 1);
    geometry.translate(0.5, 0, 0); // x: 0..1 from the lens outward
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uColor: { value: new THREE.Color(0.34, 0.28, 0.2) } }]),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: true,
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, MAX_LAMPS * 2);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    material.uniforms["uTime"] = this.uTime;
    pinPositionAttribute(material);
  }

  /** `lamps[i]`: lamp xyz, w = lit * scale (0: dark). */
  update(lamps: readonly THREE.Vector4[], count: number, seconds: number): void {
    this.uTime.value = seconds;
    let n = 0;
    let changed = false;
    for (let i = 0; i < Math.min(count, MAX_LAMPS); i++) {
      const l = lamps[i];
      if (!l || l.w < 0.05) continue;
      const w = Math.min(l.w, 1.4);
      const o = n * 4;
      if (
        Math.abs(this.written[o]! - l.x) > 1e-3 ||
        Math.abs(this.written[o + 1]! - l.y) > 1e-3 ||
        Math.abs(this.written[o + 2]! - l.z) > 1e-3 ||
        Math.abs(this.written[o + 3]! - w) > 0.01
      ) {
        this.written.set([l.x, l.y, l.z, w], o);
        this.m.makeScale(1, w, 1).setPosition(l.x, l.y, l.z);
        this.mesh.setMatrixAt(n * 2, this.m);
        this.mesh.setMatrixAt(n * 2 + 1, this.m);
        changed = true;
      }
      n += 1;
    }
    if (n !== this.writtenCount) changed = true;
    this.writtenCount = n;
    this.mesh.count = n * 2;
    if (changed) this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}
