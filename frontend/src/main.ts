/**
 * Bootstrap + the one render loop (docs/ARCHITECTURE.md s.4 "Render loop rules"):
 * socket -> store; each frame reads the store once, eases the world, renders; tier changes come
 * from the FPS governor or the user and are applied in one place (applyTier).
 */
import * as THREE from "three";
import "./style.css";
import { Hud, type HudState, type TierChoice } from "./hud/hud";
import { MetricsClient } from "./net/client";
import { initialTier, readDeviceInfo } from "./quality/gpu";
import { FpsGovernor } from "./quality/governor";
import { isTier, TIER_SETTINGS, type Tier } from "./quality/tiers";
import { CameraRig } from "./scene/camera";
import { PALETTE, SUN_DIRECTION } from "./scene/palette";
import { Sky } from "./scene/sky";
import { Water } from "./scene/water";
import { World } from "./scene/world";
import { store } from "./state/store";

const canvasEl = document.querySelector<HTMLCanvasElement>("#scene");
if (!canvasEl) throw new Error("required DOM node #scene is missing");
// Re-bind as a non-null const: TS does not carry the narrowing above into closures.
const canvas: HTMLCanvasElement = canvasEl;

const PREF_KEY = "tidewatch.quality"; // a display preference, never a credential
const IDLE_AFTER_MS = 20_000;
const IDLE_MAX_FPS = 30;

function readChoice(): TierChoice {
  const fromUrl = new URLSearchParams(location.search).get("quality");
  if (fromUrl === "auto" || isTier(fromUrl)) return fromUrl;
  try {
    const saved = localStorage.getItem(PREF_KEY);
    if (saved === "auto" || isTier(saved)) return saved;
  } catch {
    // storage blocked (private mode, sandbox): fall back to auto
  }
  return "auto";
}

function saveChoice(choice: TierChoice): void {
  try {
    localStorage.setItem(PREF_KEY, choice);
  } catch {
    // not persisted; still applied for this session
  }
}

const client = new MetricsClient({
  onSnapshot: (s) => {
    store.latest = s;
  },
  onState: (s) => {
    store.conn = s;
  },
});

let choice = readChoice();
const hud = new Hud(
  (next) => {
    choice = next;
    saveChoice(next);
    applyChoice(performance.now());
    updateHud(); // immediate feedback even if no frame renders (hidden tab, idle cap)
  },
  () => choice,
);

/**
 * Probe the GPU on a throwaway canvas: context attributes such as antialias are fixed at creation,
 * and asking the real canvas again would just return its first context.
 */
function detectTier(): Tier | null {
  const probe = document.createElement("canvas");
  const gl = probe.getContext("webgl2") ?? probe.getContext("webgl");
  if (!gl) return null;
  const tierGuess = initialTier(readDeviceInfo(gl));
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return tierGuess;
}

const probed = detectTier();
if (!probed) {
  hud.showFatal("WebGL unavailable - the 2D view arrives in M4");
  client.start();
  throw new Error("WebGL unavailable");
}
const detected: Tier = probed;
const startTier = choice === "auto" ? detected : choice;
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: TIER_SETTINGS[startTier].antialias,
  powerPreference: "default",
});

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(PALETTE.fog, 0.0095);
scene.add(new THREE.HemisphereLight(0xb7a3e6, 0x0b3a44, 1.1));
const sun = new THREE.DirectionalLight(PALETTE.sun, 1.6);
// Light from the sun's side of the sky, but higher than the visible sun so islands read clearly.
sun.position.set(SUN_DIRECTION.x * 60, 30, SUN_DIRECTION.z * 60);
scene.add(sun);

const sky = new Sky(TIER_SETTINGS[startTier].skyBands);
const water = new Water(TIER_SETTINGS[startTier].waterDetail);
const world = new World();
scene.add(sky.mesh, water.mesh, world.root);
const rig = new CameraRig();

const governor = new FpsGovernor(startTier, performance.now());
let tier: Tier = startTier;

function applyTier(next: Tier): void {
  tier = next;
  const t = TIER_SETTINGS[next];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, t.pixelRatioCap));
  water.setDetail(t.waterDetail);
  sky.setBands(t.skyBands);
  world.setGlow(t.glowSprites);
  document.documentElement.dataset["tier"] = next;
  resize();
}

function applyChoice(now: number): void {
  if (choice === "auto") {
    // Back to the device guess; the governor refines it from there.
    applyTier(detected);
    governor.setTier(detected, now);
    governor.setEnabled(true, now);
  } else {
    governor.setEnabled(false, now);
    governor.setTier(choice, now);
    applyTier(choice);
  }
}

function resize(): void {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  rig.resize(w, h);
  rig.frame(world.bounds.cx, world.bounds.cz, world.bounds.radius);
}

const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
function applyReducedMotion(): void {
  world.setReducedMotion(reducedMotionQuery.matches);
  rig.setReducedMotion(reducedMotionQuery.matches);
}
reducedMotionQuery.addEventListener("change", applyReducedMotion);
applyReducedMotion();

let lastInput = performance.now();
const markInput = (): void => {
  lastInput = performance.now();
};
for (const type of ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"] as const) {
  window.addEventListener(type, markInput, { passive: true });
}
window.addEventListener("resize", () => {
  markInput();
  resize();
});

let contextLost = false;
canvas.addEventListener("webglcontextlost", (e) => {
  e.preventDefault(); // allow the browser to restore it
  contextLost = true;
});
canvas.addEventListener("webglcontextrestored", () => {
  contextLost = false;
});

applyTier(startTier);
applyChoice(performance.now());
client.start();

type Overlay = import("./debug/overlay").DebugOverlay;
let overlay: Overlay | null = null;
if (import.meta.env.DEV && new URLSearchParams(location.search).has("debug")) {
  void import("./debug/overlay").then((m) => {
    overlay = new m.DebugOverlay();
  });
}

let lastRaf = performance.now();
let lastRender = 0;
let lastTopologyRadius = -1;
const start = performance.now();
const hudState: HudState = {
  conn: store.conn,
  seq: null,
  counts: null,
  heading: 0,
  tier,
  choice,
};

function updateHud(): void {
  hudState.conn = store.conn;
  hudState.seq = store.latest?.seq ?? null;
  hudState.counts = world.islandCount > 0 ? world.counts : null;
  hudState.heading = rig.heading;
  hudState.tier = tier;
  hudState.choice = choice;
  hud.update(hudState);
}

function frame(now: number): void {
  requestAnimationFrame(frame);
  const interval = now - lastRaf;
  lastRaf = now;
  if (document.hidden || contextLost) return;

  const changed = governor.sample(interval, now);
  if (changed && choice === "auto") applyTier(changed);

  const idle = now - lastInput > IDLE_AFTER_MS;
  const maxFps = Math.min(TIER_SETTINGS[tier].maxFps, idle ? IDLE_MAX_FPS : Infinity);
  // 1 ms slack so a 60 Hz display does not skip every other frame from jitter.
  if (now - lastRender < 1000 / maxFps - 1) return;
  const dt = Math.min((now - lastRender) / 1000, 0.1);
  lastRender = now;
  const t0 = performance.now();

  world.sync(store.latest);
  if (world.bounds.radius !== lastTopologyRadius) {
    lastTopologyRadius = world.bounds.radius;
    rig.frame(world.bounds.cx, world.bounds.cz, world.bounds.radius);
  }
  const seconds = (now - start) / 1000;
  const waterSeconds = reducedMotionQuery.matches ? seconds * 0.25 : seconds;
  world.tick(dt, seconds);
  rig.tick(dt);
  water.tick(waterSeconds, rig.camera);
  sky.tick(seconds, rig.camera);
  renderer.render(scene, rig.camera);

  updateHud();
  overlay?.frame(now, performance.now() - t0, renderer, tier);
}
requestAnimationFrame(frame);
