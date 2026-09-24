/**
 * Dusk sky: one back-faced sphere with a vertical gradient, a soft sun glow and N faint cloud
 * bands (tier-dependent, compiled in via a define). No textures, one draw call.
 */
import * as THREE from "three";
import { PALETTE, SUN_DIRECTION } from "./palette";

const vertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // always at the far plane
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec3 uFog;
uniform vec3 uSun;
uniform vec3 uSunDir;
uniform float uTime;
varying vec3 vDir;

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.25, h));
  col = mix(col, uTop, smoothstep(0.2, 0.75, h));
  // At and below the horizon the sky is pure fog colour, which is exactly what fully fogged water
  // renders as, so the water plane's far edge is invisible.
  col = mix(col, uFog, smoothstep(0.03, 0.0, h));
  float sun = max(dot(d, uSunDir), 0.0);
  col += uSun * (pow(sun, 48.0) * 0.9 + pow(sun, 6.0) * 0.18);
#if SKY_BANDS > 0
  for (int i = 0; i < SKY_BANDS; i++) {
    float fi = float(i);
    float y = 0.06 + fi * 0.07;
    float wave = sin(atan(d.z, d.x) * (3.0 + fi) + uTime * 0.01 * (fi + 1.0) + fi * 1.7);
    float band = smoothstep(0.035, 0.0, abs(h - y - wave * 0.012));
    col = mix(col, uHorizon * 0.9 + uSun * 0.1, band * 0.22);
  }
#endif
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export class Sky {
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly material: THREE.ShaderMaterial;

  constructor(bands: number) {
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      defines: { SKY_BANDS: bands },
      uniforms: {
        uTop: { value: new THREE.Color(PALETTE.skyTop) },
        uMid: { value: new THREE.Color(PALETTE.skyMid) },
        uHorizon: { value: new THREE.Color(PALETTE.skyHorizon) },
        uFog: { value: new THREE.Color(PALETTE.fog) },
        uSun: { value: new THREE.Color(PALETTE.sun) },
        uSunDir: {
          value: new THREE.Vector3(SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z).normalize(),
        },
        uTime: { value: 0 },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(500, 24, 12), this.material);
    this.mesh.renderOrder = -1;
    this.mesh.frustumCulled = false;
  }

  setBands(bands: number): void {
    if (this.material.defines["SKY_BANDS"] === bands) return;
    this.material.defines["SKY_BANDS"] = bands;
    this.material.needsUpdate = true;
  }

  /**
   * The dome is centred on the camera so each fragment's direction is the true view ray; from any
   * other point the sphere's facets show up as a jagged horizon.
   */
  tick(seconds: number, camera: THREE.Camera): void {
    const u = this.material.uniforms["uTime"];
    if (u) u.value = seconds;
    this.mesh.position.copy(camera.position);
  }
}
