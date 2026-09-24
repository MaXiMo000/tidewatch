/**
 * Art-direction parameters. The dev-only tuning panel (dev/tuning.ts) edits this object live; the
 * values here ARE the committed defaults. Render paths read it every frame (plain property reads).
 * Colours are sRGB hex, as picked on screen.
 */
export const params = {
  // light + sky
  exposure: 0.8,
  sunElevationDeg: 2.5,
  sunAzimuthDeg: 168,
  skyZenith: 0x06070f,
  skyMid: 0x3a2740,
  skyHorizon: 0xe79a80,
  cloudCover: 0.62,
  cloudLight: 0xf2987c,
  cloudShadow: 0x140f1c,
  // water
  waterDeep: 0x020807,
  waterTint: 0x0b2a26,
  reflectionScale: 0.5,
  rippleStrength: 0.08,
  glint: 1.0,
  // atmosphere
  fogColor: 0x23403b,
  fogDensity: 0.022,
  fogHeight: 2.2,
  shafts: 0.35,
  // world
  foliageDensity: 1.0,
  bloom: 0.6,
};

export type Params = typeof params;
