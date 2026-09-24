/** Stylised (Balanced/Simple) palette, matched to the Cinematic swamp: teal mist, near-black water, violet-pink dusk. */
export const PALETTE = {
  skyTop: 0x0a0c1a,
  skyMid: 0x2e2340,
  skyHorizon: 0xd98a78,
  fog: 0x22393a,
  sun: 0xffc9a3,
  waterDeep: 0x041412,
  waterShallow: 0x0e3b39,
  sand: 0xc9b48f,
  rock: 0x9a8fb0,
  lantern: 0xffb45e,
  channel: 0x7fd6e6,
  status: { ok: 0x3fd0a5, degraded: 0xf2b134, failing: 0xff4d5e },
} as const;

/** Low evening sun, behind and to the left of the default camera. Unit vector. */
export const SUN_DIRECTION = { x: -0.55, y: 0.18, z: -0.82 } as const;
