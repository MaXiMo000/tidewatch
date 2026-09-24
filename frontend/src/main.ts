/**
 * Bootstrap + the one render loop (docs/ARCHITECTURE.md s.4):
 * socket -> store -> WorldModel (eased, shared) -> the active RenderPath draws it.
 * Scroll progress drives the film (scene/story.ts): the camera shot and the hero request, read
 * once per frame here - never from a scroll handler.
 *
 * First paint is always the stylised path (main bundle). If the tier is Cinematic, its chunk is
 * imported lazily AFTER that first frame, behind a progress bar, and swapped in when ready. Leaving
 * Cinematic swaps back and frees its GPU memory. Balanced/Simple never download the chunk.
 */
import * as THREE from "three";
import "./style.css";
import { prettyName, setDisplayNames } from "./hud/copy";
import { Hud, type HudState, type TierChoice } from "./hud/hud";
import { Inspector } from "./hud/inspector";
import { StoryUi } from "./hud/story";
import { MetricsClient } from "./net/client";
import { InfoSchema } from "./net/protocol";
import { detectStartTier } from "./quality/detect";
import { initialTier, readDeviceInfo } from "./quality/gpu";
import { FpsGovernor } from "./quality/governor";
import { isTier, TIER_SETTINGS, type Tier } from "./quality/tiers";
import type { RenderPath } from "./render/path";
import { StylisedPath } from "./render/stylised";
import { Beacon } from "./scene/beacon";
import { CameraRig } from "./scene/camera";
import { WorldModel } from "./scene/model";
import { Shake } from "./scene/weather-rules";
import {
  liveWeight,
  makePlan,
  planRoute,
  requestAt,
  stillFor,
  storyPose,
  type Pose,
  type StoryPlan,
  type Vec3,
} from "./scene/story";
import { store } from "./state/store";

const canvasEl = document.querySelector<HTMLCanvasElement>("#scene");
const labelLayer = document.querySelector<HTMLElement>("#island-labels");
const cardEl = document.querySelector<HTMLElement>("#island-card");
const loadingEl = document.querySelector<HTMLElement>("#hud-loading");
const loadingBar = document.querySelector<HTMLProgressElement>("#hud-loading-bar");
const loadingLabel = document.querySelector<HTMLElement>("#hud-loading-label");
if (!canvasEl || !loadingEl || !loadingBar || !loadingLabel || !labelLayer || !cardEl) {
  throw new Error("required DOM nodes are missing");
}
// Re-bind as non-null consts: TS does not carry the narrowing above into closures.
const canvas: HTMLCanvasElement = canvasEl;
const loading = { root: loadingEl, bar: loadingBar, label: loadingLabel };

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

const inspector = new Inspector(labelLayer, cardEl, (state) => hud.showToast(prettyName(state.id)));

window.addEventListener("keydown", (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
  if (typing || hud.menuOpen) return;
  if (e.key === "q" || e.key === "Q") hud.cycleQuality();
  else if (e.key === "l" || e.key === "L") inspector.labelsVisible = !inspector.labelsVisible;
  else if (e.key === "Escape") inspector.clear();
});

let renderer: THREE.WebGLRenderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    powerPreference: "high-performance",
  });
} catch {
  hud.showFatal("WebGL unavailable - the 2D view arrives in M4");
  client.start();
  throw new Error("WebGL unavailable");
}
// Counted once per frame by the loop: the reflection pass renders inside the main render.
renderer.info.autoReset = false;

/** Synchronous guess for the first frame; detect-gpu refines it asynchronously. */
let detected: Tier = initialTier(readDeviceInfo(renderer.getContext()));
const touchPrimary = window.matchMedia("(pointer: coarse) and (hover: none)").matches;
/** Phones and tablets are never promoted to Cinematic automatically (the user may still pick it). */
const autoCeiling: Tier = touchPrimary ? "medium" : "high";
if (detected === "high" && autoCeiling !== "high") detected = autoCeiling;

const model = new WorldModel();
const rig = new CameraRig();
const beacon = new Beacon();
const storyUi = new StoryUi();
let plan: StoryPlan | null = null;
const planFor = { topology: -1, path: "", eyeX: NaN, eyeZ: NaN };
const shot: Pose = { eye: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } };
const requestPos: Vec3 = { x: 0, y: 0, z: 0 };
const shake = new Shake();
const shakeOffset: Vec3 = { x: 0, y: 0, z: 0 };
let seenFailures = 0;
/** Scroll progress eased toward the real scroll position, so wheel steps glide instead of jump. */
let filmP = storyUi.progress();
const governor = new FpsGovernor(detected, performance.now());
governor.setCeiling(autoCeiling);

let tier: Tier = choice === "auto" ? detected : choice;
const stylised = new StylisedPath(renderer, model, tier === "high" ? "medium" : tier);
let path: RenderPath = stylised;
let cinematic: RenderPath | null = null;
let cinematicLoading: Promise<void> | null = null;

function setLoading(fraction: number | null, label = ""): void {
  loading.root.hidden = fraction === null;
  if (fraction !== null) {
    loading.bar.value = Math.round(fraction * 100);
    loading.label.textContent = label;
  }
}

function usePath(next: RenderPath): void {
  path = next;
  next.attach(beacon.root);
  beacon.prewarm();
  rig.setShot(next.shot);
  next.setReducedMotion(reducedMotionQuery.matches);
  document.documentElement.dataset["path"] = next.name;
  resize();
}

function ensureCinematic(): void {
  if (cinematic) {
    if (tier === "high") usePath(cinematic);
    return;
  }
  if (cinematicLoading) return;
  setLoading(0.05, "Loading cinematic view");
  cinematicLoading = import("./cinematic/cinematic")
    .then((m) =>
      m.createCinematicPath(renderer, model, rig.camera, (f, label) => setLoading(f, label)),
    )
    .then((p) => {
      cinematic = p;
      setLoading(null);
      // The tier may have changed while loading; only switch if still Cinematic.
      if (tier === "high") usePath(p);
    })
    .catch(() => {
      setLoading(null);
      hud.showNotice("Cinematic view failed to load - staying on Balanced");
      if (tier === "high") applyTier("medium");
    })
    .finally(() => {
      cinematicLoading = null;
    });
}

function applyTier(next: Tier): void {
  tier = next;
  const t = TIER_SETTINGS[next];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, t.pixelRatioCap));
  document.documentElement.dataset["tier"] = next;
  if (next === "high") {
    stylised.applyTier("medium"); // what shows while the chunk loads
    ensureCinematic();
  } else {
    stylised.applyTier(next);
    if (path !== stylised) usePath(stylised);
    if (cinematic) {
      cinematic.dispose(); // free its render targets; the module stays cached for a quick return
      cinematic = null;
    }
  }
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
  storyUi.measure();
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  rig.resize(w, h);
  path.resize(w, h);
}

const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
function applyReducedMotion(): void {
  rig.setReducedMotion(reducedMotionQuery.matches);
  stylised.setReducedMotion(reducedMotionQuery.matches);
  cinematic?.setReducedMotion(reducedMotionQuery.matches);
}
reducedMotionQuery.addEventListener("change", applyReducedMotion);
applyReducedMotion();

let lastInput = performance.now();
const markInput = (): void => {
  lastInput = performance.now();
};
for (const type of ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const) {
  window.addEventListener(type, markInput, { passive: true });
}
window.addEventListener(
  "pointermove",
  (e) => {
    markInput();
    rig.setPointer((e.clientX / window.innerWidth) * 2 - 1, 1 - (e.clientY / window.innerHeight) * 2);
    // Only pick islands when the pointer is over the scene, not over HUD controls.
    inspector.setPointer(e.target === canvas ? e.clientX : null, e.clientY);
  },
  { passive: true },
);
canvas.addEventListener("pointerdown", (e) => {
  inspector.setPointer(e.clientX, e.clientY);
});
canvas.addEventListener("click", () => inspector.click());
canvas.addEventListener("pointerleave", () => inspector.setPointer(null));
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

usePath(stylised);
applyChoice(performance.now());
// Web fonts change the chapter cards' height only inside fixed-height sections, but re-measure
// once they land anyway, in case a browser lays the page out differently.
void document.fonts?.ready.then(() => {
  storyUi.measure();
  // Only if the visitor has not scrolled yet: never yank someone back to the anchor.
  if (window.scrollY < 2) storyUi.followHash();
});

// Demo or live? Live captions the watched apps and names their islands. Failure keeps the demo
// copy. The stream starts after, so island labels are built with the right names.
void fetch("/api/v1/info", { credentials: "omit", cache: "no-store" })
  .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`info ${res.status}`))))
  .then((json: unknown) => {
    const info = InfoSchema.parse(json);
    setDisplayNames(info.sources);
    hud.setSource(info);
  })
  .catch(() => undefined)
  .finally(() => client.start());

// detect-gpu (self-hosted benchmarks) refines the start tier; only matters in auto mode.
void detectStartTier(renderer.getContext()).then(({ tier: guess, source }) => {
  document.documentElement.dataset["detect"] = source;
  detected = guess === "high" && autoCeiling !== "high" ? autoCeiling : guess;
  if (choice === "auto" && detected !== tier) applyChoice(performance.now());
});

type Overlay = import("./debug/overlay").DebugOverlay;
let overlay: Overlay | null = null;
if (import.meta.env.DEV) {
  const q = new URLSearchParams(location.search);
  if (q.has("debug")) {
    void import("./debug/overlay").then((m) => {
      overlay = new m.DebugOverlay();
    });
  }
  if (q.has("tune")) void import("./dev/tuning").then((m) => m.mountTuningPanel());
}

let lastRaf = performance.now();
let lastRender = 0;
let lastTopology = -1;
let framesOnPath = 0;
let lastPathName = "";
let lastReady = "";
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
  hudState.counts = model.islands.size > 0 ? model.counts : null;
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

  model.sync(store.latest);
  if (model.topologyVersion !== lastTopology) {
    lastTopology = model.topologyVersion;
    rig.frame(
      model.bounds.cx,
      model.bounds.cz,
      model.bounds.radius,
      [...model.islands.values()].map((i) => ({ x: i.place.x, z: i.place.z })),
    );
  }
  // The film's plan follows the topology, and the render path (Cinematic films inside its channel).
  const eye = rig.base.eye;
  const stale =
    planFor.topology !== model.topologyVersion ||
    planFor.path !== path.name ||
    Math.abs(planFor.eyeX - eye.x) > 0.05 ||
    Math.abs(planFor.eyeZ - eye.z) > 0.05;
  if (stale && model.islands.size > 0) {
    planFor.topology = model.topologyVersion;
    planFor.path = path.name;
    planFor.eyeX = eye.x;
    planFor.eyeZ = eye.z;
    const nodes = [...model.islands.values()].map((i) => ({ id: i.id, kind: i.kind, x: i.place.x, z: i.place.z }));
    const ids = planRoute(nodes, model.edges);
    const route = ids.map((id) => model.islands.get(id)?.place ?? { x: 0, z: 0 });
    const from = path.name === "cinematic" ? eye : null;
    plan = ids.length > 0 ? makePlan(route, model.bounds.cx, model.bounds.cz, model.bounds.radius, from) : null;
    storyUi.setRoute(ids.map(prettyName));
  }
  model.tick(dt);
  rig.tick(dt);

  // The film: reduced motion cuts to one still per chapter; otherwise the scroll position is eased.
  const reduced = reducedMotionQuery.matches;
  const scrollP = storyUi.progress();
  storyUi.setProgress(scrollP);
  filmP = reduced ? stillFor(scrollP) : filmP + (scrollP - filmP) * (1 - Math.exp(-7 * dt));
  const seconds = (now - start) / 1000;
  const live = liveWeight(filmP);
  if (plan && live < 1) {
    storyPose(filmP, plan, reduced ? 0 : seconds, shot, path.name === "cinematic" ? rig.base : null);
    rig.applyStory(shot, live);
  }
  // A service just started failing: a short shake (never under reduced motion, <= 1 per 2.5 s).
  if (model.failureEvents !== seenFailures) {
    seenFailures = model.failureEvents;
    shake.kick(seconds, 0.8, reduced);
  }
  shake.offset(seconds, dt, shakeOffset);
  rig.nudge(shakeOffset);
  const onScreen = plan !== null && requestAt(filmP, plan, requestPos);
  beacon.update(onScreen ? requestPos : null, dt, seconds, reduced);
  renderer.info.reset();
  path.frame(dt, (now - start) / 1000, rig.camera, rig.base);

  // Screenshot/E2E readiness: the intended path has drawn a few frames with live data.
  if (path.name !== lastPathName) {
    lastPathName = path.name;
    framesOnPath = 0;
  }
  if (model.islands.size > 0) framesOnPath += 1;
  const wanted = tier === "high" ? "cinematic" : "stylised";
  const ready = path.name === wanted && framesOnPath > 8 ? "1" : "0";
  if (ready !== lastReady) document.documentElement.dataset["ready"] = lastReady = ready;

  const inspection = inspector.update(model, rig.camera, canvas.clientWidth, canvas.clientHeight);
  hud.setPlace(inspection.state);
  updateHud();
  overlay?.frame(now, performance.now() - t0, renderer, tier, path.info().gpuBytes);
}
requestAnimationFrame(frame);
