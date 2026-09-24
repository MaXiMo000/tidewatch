/**
 * Cheap stylised water (docs/PERFORMANCE.md "fake expensive effects"): a single quad, depth
 * gradient + Fresnel sky tint. High/Medium add procedurally animated normals and a sun glint;
 * Low compiles without them (WATER_DETAIL define), so it pays nothing for the effect.
 * No planar reflection on any tier yet; High may add one later.
 */
import * as THREE from "three";
import { PALETTE, SUN_DIRECTION } from "./palette";

const vertexShader = /* glsl */ `
#include <fog_pars_vertex>
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const fragmentShader = /* glsl */ `
#include <fog_pars_fragment>
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uSky;
uniform vec3 uSun;
uniform vec3 uSunDir;
uniform float uTime;
varying vec3 vWorld;

void main() {
  vec3 n = vec3(0.0, 1.0, 0.0);
#if WATER_DETAIL
  vec2 p = vWorld.xz;
  float t = uTime;
  // Fade the ripples out with distance: far away they only alias into blotches.
  float near = 1.0 - smoothstep(25.0, 90.0, length(cameraPosition.xz - p));
  n.x += near * (0.07 * sin(p.x * 0.55 + t * 0.9) + 0.045 * sin(p.y * 1.25 - t * 1.3 + p.x * 0.35));
  n.z += near * (0.07 * cos(p.y * 0.62 - t * 0.8) + 0.045 * cos(p.x * 1.05 + t * 1.1 - p.y * 0.3));
  n = normalize(n);
#endif
  vec3 v = normalize(cameraPosition - vWorld);
  float fresnel = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 3.0);
  vec3 col = mix(uShallow, uDeep, smoothstep(4.0, 60.0, length(vWorld.xz)));
  col = mix(col, uSky, fresnel * 0.55);
#if WATER_DETAIL
  vec3 r = reflect(-v, n);
  col += uSun * pow(max(dot(r, uSunDir), 0.0), 90.0) * 0.9;
#endif
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export class Water {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly material: THREE.ShaderMaterial;

  constructor(detail: boolean) {
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      fog: true,
      defines: { WATER_DETAIL: detail ? 1 : 0 },
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uDeep: { value: new THREE.Color(PALETTE.waterDeep) },
          uShallow: { value: new THREE.Color(PALETTE.waterShallow) },
          uSky: { value: new THREE.Color(PALETTE.skyHorizon).lerp(new THREE.Color(PALETTE.fog), 0.8) },
          uSun: { value: new THREE.Color(PALETTE.sun) },
          uSunDir: {
            value: new THREE.Vector3(SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z).normalize(),
          },
          uTime: { value: 0 },
        },
      ]),
    });
    // Large enough that its edge is always deep in the fog; follows the camera (see tick).
    const geometry = new THREE.PlaneGeometry(2000, 2000, 1, 1);
    geometry.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geometry, this.material);
  }

  setDetail(detail: boolean): void {
    const value = detail ? 1 : 0;
    if (this.material.defines["WATER_DETAIL"] === value) return;
    this.material.defines["WATER_DETAIL"] = value;
    this.material.needsUpdate = true;
  }

  /** Ripples and the depth gradient use world coordinates, so moving the quad changes nothing. */
  tick(seconds: number, camera: THREE.Camera): void {
    const u = this.material.uniforms["uTime"];
    if (u) u.value = seconds;
    this.mesh.position.set(camera.position.x, 0, camera.position.z);
  }
}
