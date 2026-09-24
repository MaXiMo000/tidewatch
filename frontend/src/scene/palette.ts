/** Art direction from docs/PLAN.md section 2: deep teal water, violet-pink dusk, warm lanterns. */
export const PALETTE = {
  skyTop: 0x0b1030,
  skyMid: 0x3b2a63,
  skyHorizon: 0xe58aa6,
  fog: 0x3a2d57,
  sun: 0xffc9a3,
  waterDeep: 0x07303a,
  waterShallow: 0x15707a,
  sand: 0xc9b48f,
  rock: 0x9a8fb0,
  lantern: 0xffb45e,
  channel: 0x7fd6e6,
  status: { ok: 0x3fd0a5, degraded: 0xf2b134, failing: 0xff4d5e },
} as const;

/** Low evening sun, behind and to the left of the default camera. Unit vector. */
export const SUN_DIRECTION = { x: -0.55, y: 0.18, z: -0.82 } as const;
