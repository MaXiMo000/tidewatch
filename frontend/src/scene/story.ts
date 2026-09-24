/**
 * The scroll movie (docs/PLAN.md s.3) as pure functions of scroll progress `p` in [0, 1]:
 * which chapter is showing, the route one request takes through the archipelago, where that
 * request is, and where the camera looks. No DOM, no three.js, no allocation in the per-frame
 * functions (they write into caller-owned objects), so it is unit-tested and cheap on scroll.
 *
 * The route comes from the live topology (demo: gateway -> api -> queue -> worker -> db; live mode:
 * internet -> an app -> its database), so the same film plays over whatever the stream shows.
 * Under prefers-reduced-motion `p` snaps to one still shot per chapter: the camera cuts, never glides.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Pose {
  eye: Vec3;
  target: Vec3;
}

export interface Chapter {
  readonly id: string;
  readonly start: number;
  readonly end: number;
  /** The still used for this chapter under reduced motion. */
  readonly still: number;
}

/** Storyboard ranges from docs/PLAN.md s.3. The ids are the DOM section ids. */
export const CHAPTERS: readonly Chapter[] = [
  { id: "chapter-aerial", start: 0, end: 0.12, still: 0.05 },
  { id: "chapter-request", start: 0.12, end: 0.3, still: 0.26 },
  { id: "chapter-hops", start: 0.3, end: 0.55, still: 0.43 },
  { id: "chapter-storm", start: 0.55, end: 0.75, still: 0.66 },
  { id: "chapter-failure", start: 0.75, end: 0.9, still: 0.84 },
  { id: "live", start: 0.9, end: 1, still: 1 },
];

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Smooth 0..1 ramp between a and b (Hermite). */
export function smoothstep(a: number, b: number, v: number): number {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}

export function chapterIndex(p: number): number {
  const q = clamp01(p);
  for (let i = CHAPTERS.length - 1; i > 0; i--) {
    if (q >= (CHAPTERS[i]?.start ?? 1)) return i;
  }
  return 0;
}

/** Reduced motion: every p inside a chapter maps to that chapter's still. */
export function stillFor(p: number): number {
  return CHAPTERS[chapterIndex(p)]?.still ?? 0;
}

export interface RouteNode {
  id: string;
  kind: string;
  x: number;
  z: number;
}

export interface RouteEdge {
  src: string;
  dst: string;
  rps: number;
}

const MAX_HOPS = 5;
const MAX_EXPANSIONS = 5000;

/**
 * The request's path: from the gateway (or any root) along edges, the longest simple path up to
 * 5 islands, preferring one that ends at a database (the storm chapter's slow service), then the
 * busiest. Deterministic: ties break by id. Bounded work for any graph size.
 */
export function planRoute(nodes: readonly RouteNode[], edges: readonly RouteEdge[]): string[] {
  if (nodes.length === 0) return [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map<string, RouteEdge[]>();
  const hasParent = new Set<string>();
  for (const e of edges) {
    if (!byId.has(e.src) || !byId.has(e.dst) || e.src === e.dst) continue;
    const list = out.get(e.src) ?? [];
    list.push(e);
    out.set(e.src, list);
    hasParent.add(e.dst);
  }
  for (const list of out.values()) {
    list.sort((a, b) => b.rps - a.rps || (a.dst < b.dst ? -1 : a.dst > b.dst ? 1 : 0));
  }
  const sorted = [...nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const gateway = sorted.find((n) => n.kind === "gateway");
  const start = gateway ?? sorted.find((n) => !hasParent.has(n.id)) ?? sorted[0];
  if (!start) return [];

  let best: string[] = [start.id];
  let bestScore = -Infinity;
  let expansions = 0;
  const score = (path: string[], rps: number): number => {
    const last = byId.get(path[path.length - 1] ?? "");
    return path.length * 1e9 + (last?.kind === "database" ? 1e8 : 0) + rps;
  };
  const walk = (path: string[], rps: number): void => {
    expansions += 1;
    const s = score(path, rps);
    if (s > bestScore) {
      bestScore = s;
      best = [...path];
    }
    if (path.length >= MAX_HOPS || expansions > MAX_EXPANSIONS) return;
    for (const e of out.get(path[path.length - 1] ?? "") ?? []) {
      if (path.includes(e.dst)) continue;
      path.push(e.dst);
      walk(path, rps + e.rps);
      path.pop();
    }
  };
  walk([start.id], 0);
  return best;
}

export interface StoryPlan {
  /** Island positions along the route, at the height the request travels. */
  readonly route: readonly Vec3[];
  readonly centre: Vec3;
  readonly radius: number;
  /** Where the request appears, out on the water beyond the first island. */
  readonly entry: Vec3;
}

const TRAVEL_Y = 0.7;

/**
 * `arriveFrom` (Cinematic): the request arrives from that point's direction (the channel mouth),
 * so chapter 2 stays inside the clear channel; by default it comes in from the open sea outside.
 */
export function makePlan(
  route: readonly { x: number; z: number }[],
  cx: number,
  cz: number,
  radius: number,
  arriveFrom: { x: number; z: number } | null = null,
): StoryPlan {
  const pts = route.map((r) => ({ x: r.x, y: TRAVEL_Y, z: r.z }));
  const first = pts[0] ?? { x: cx, y: TRAVEL_Y, z: cz };
  let dx = arriveFrom ? arriveFrom.x - first.x : first.x - cx;
  let dz = arriveFrom ? arriveFrom.z - first.z : first.z - cz;
  const len = Math.hypot(dx, dz);
  // Requests flow along +x (scene/layout.ts), so arrive from -x when the gateway sits at the centre.
  if (len < 1e-3) {
    dx = -1;
    dz = 0;
  } else {
    dx /= len;
    dz /= len;
  }
  const reach = arriveFrom ? Math.min(radius * 0.8, len * 0.6) : radius * 0.8;
  return {
    route: pts,
    centre: { x: cx, y: 0, z: cz },
    radius,
    entry: { x: first.x + dx * reach, y: TRAVEL_Y, z: first.z + dz * reach },
  };
}

/** The request is on screen from its arrival until it reaches the last island. */
const REQUEST_IN = 0.14;
const AT_GATEWAY = 0.3;
const AT_LAST = 0.55;
const REQUEST_OUT = 0.6;

/**
 * Position of the hero request at progress p (writes `out`); false when it is not on screen.
 * Chapter 2 carries it from the open water to the first island, chapter 3 hop by hop along the
 * route with a small arc over each channel; it rests on the last island into the storm.
 */
export function requestAt(p: number, plan: StoryPlan, out: Vec3): boolean {
  const route = plan.route;
  if (route.length === 0 || p < REQUEST_IN || p > REQUEST_OUT) return false;
  let a: Vec3;
  let b: Vec3;
  let s: number;
  if (p < AT_GATEWAY) {
    a = plan.entry;
    b = route[0] as Vec3;
    s = smoothstep(REQUEST_IN, AT_GATEWAY, p);
  } else if (p < AT_LAST && route.length > 1) {
    const hops = route.length - 1;
    const f = ((p - AT_GATEWAY) / (AT_LAST - AT_GATEWAY)) * hops;
    const i = Math.min(hops - 1, Math.floor(f));
    a = route[i] as Vec3;
    b = route[i + 1] as Vec3;
    s = smoothstep(0, 1, f - i);
  } else {
    const last = route[route.length - 1] as Vec3;
    out.x = last.x;
    out.y = last.y;
    out.z = last.z;
    return true;
  }
  out.x = a.x + (b.x - a.x) * s;
  out.z = a.z + (b.z - a.z) * s;
  out.y = a.y + (b.y - a.y) * s + Math.sin(Math.PI * s) * 0.8;
  return true;
}

/** How much the free (live) camera owns the shot: 0 during the film, 1 once it has ended. */
export function liveWeight(p: number): number {
  return smoothstep(0.86, 0.97, p);
}

const AERIAL_AZIMUTH = -0.75;
const AERIAL_DRIFT = 0.04; // rad/s: the aerial shot turns slowly, like the orbit it hands over to
const tmpA: Pose = { eye: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } };
const tmpB: Pose = { eye: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } };
const tmpP: Vec3 = { x: 0, y: 0, z: 0 };

function orbit(out: Pose, centre: Vec3, ty: number, azimuth: number, elevation: number, dist: number): void {
  const flat = Math.cos(elevation) * dist;
  out.target.x = centre.x;
  out.target.y = centre.y + ty;
  out.target.z = centre.z;
  out.eye.x = centre.x + Math.sin(azimuth) * flat;
  out.eye.y = centre.y + ty + Math.sin(elevation) * dist;
  out.eye.z = centre.z + Math.cos(azimuth) * flat;
}

function aerial(out: Pose, plan: StoryPlan, seconds: number, anchor: Pose | null): void {
  if (!anchor) {
    orbit(out, plan.centre, 0, AERIAL_AZIMUTH + AERIAL_DRIFT * seconds, 1.0, plan.radius * 2.7);
    return;
  }
  // Corridor: raised over the channel mouth; the eye stays put (trees close in beside it) and
  // the gaze pans slowly across the archipelago instead.
  const pan = Math.sin(seconds * AERIAL_DRIFT * 2) * plan.radius * 0.25;
  const dx = anchor.target.x - anchor.eye.x;
  const dz = anchor.target.z - anchor.eye.z;
  const len = Math.hypot(dx, dz) || 1;
  out.eye.x = anchor.eye.x;
  out.eye.y = anchor.eye.y + plan.radius * 0.35;
  out.eye.z = anchor.eye.z;
  out.target.x = plan.centre.x - (dz / len) * pan;
  out.target.y = 0;
  out.target.z = plan.centre.z + (dx / len) * pan;
}

/**
 * Corridor shot: the eye on the line from the channel mouth (anchor eye) to `focus`, `dist` from
 * it, lifted by `raise`. That segment lies inside the live view's frustum, which Cinematic's
 * foliage keeps clear by construction, so the film never flies through a tree.
 */
function toward(out: Pose, anchor: Pose, focus: Vec3, dist: number, raise: number): void {
  const dx = anchor.eye.x - focus.x;
  const dy = anchor.eye.y - focus.y;
  const dz = anchor.eye.z - focus.z;
  const k = Math.min(1, dist / (Math.hypot(dx, dy, dz) || 1));
  out.eye.x = focus.x + dx * k;
  out.eye.y = focus.y + dy * k + raise;
  out.eye.z = focus.z + dz * k;
  out.target.x = focus.x;
  out.target.y = focus.y;
  out.target.z = focus.z;
}

/**
 * A raised tracking shot on the request, from the same side as the live camera (so the film hands
 * over without swinging round) and high enough to look over neighbouring islands, not through them.
 */
function follow(out: Pose, plan: StoryPlan, p: number, anchor: Pose | null): void {
  requestAt(Math.min(Math.max(p, REQUEST_IN), AT_LAST), plan, tmpP);
  if (anchor) toward(out, anchor, tmpP, plan.radius * 0.9, plan.radius * 0.12);
  else orbit(out, tmpP, 0, AERIAL_AZIMUTH, 0.72, plan.radius * 0.85);
}

function stormAzimuth(plan: StoryPlan): number {
  const last = plan.route[plan.route.length - 1] ?? plan.centre;
  // Start the circle on the side the request came from.
  return Math.atan2(last.x - plan.centre.x, last.z - plan.centre.z) + Math.PI * 0.75;
}

/** Chapter 4: circle the slow service (the route's last island) as the weather turns. */
function storm(out: Pose, plan: StoryPlan, p: number, anchor: Pose | null): void {
  const last = plan.route[plan.route.length - 1] ?? plan.centre;
  const u = smoothstep(0.55, 0.78, p);
  if (anchor) {
    tmpP.x = last.x;
    tmpP.y = last.y + 0.8;
    tmpP.z = last.z;
    // Creep in on it instead of circling (circling would leave the clear channel).
    toward(out, anchor, tmpP, plan.radius * (0.75 - 0.15 * u), plan.radius * 0.08);
    return;
  }
  orbit(out, last, 0.8, stormAzimuth(plan) + u * 1.1, 0.38, plan.radius * 0.6);
}

/** Chapter 5: pull back wide to watch the failure spread and the recovery begin. */
function wide(out: Pose, plan: StoryPlan, anchor: Pose | null): void {
  if (anchor) {
    out.eye.x = anchor.eye.x;
    out.eye.y = anchor.eye.y + plan.radius * 0.25;
    out.eye.z = anchor.eye.z;
    out.target.x = plan.centre.x;
    out.target.y = 0;
    out.target.z = plan.centre.z;
    return;
  }
  orbit(out, plan.centre, 0, stormAzimuth(plan) + 1.1, 0.62, plan.radius * 2.3);
}

function mix(out: Pose, a: Pose, b: Pose, t: number): void {
  out.eye.x = a.eye.x + (b.eye.x - a.eye.x) * t;
  out.eye.y = a.eye.y + (b.eye.y - a.eye.y) * t;
  out.eye.z = a.eye.z + (b.eye.z - a.eye.z) * t;
  out.target.x = a.target.x + (b.target.x - a.target.x) * t;
  out.target.y = a.target.y + (b.target.y - a.target.y) * t;
  out.target.z = a.target.z + (b.target.z - a.target.z) * t;
}

/**
 * The film's camera at progress p (writes `out`). Continuous in p: each shot hands over to the
 * next with a short cross-fade, so scrubbing never jumps. `seconds` only drives the aerial drift.
 * From p ~0.86 main.ts blends this toward the live camera with liveWeight(p).
 *
 * `anchor` (Cinematic): the live view's composed eye/target. Cinematic's forest is planted around
 * that one view, so with an anchor every shot stays inside its clear channel (see toward()).
 * Without one (Balanced/Simple: open water, trees only far out) the camera roams freely.
 */
export function storyPose(p: number, plan: StoryPlan, seconds: number, out: Pose, anchor: Pose | null = null): void {
  const q = clamp01(p);
  if (q < 0.1) {
    aerial(out, plan, seconds, anchor);
  } else if (q < 0.17) {
    aerial(tmpA, plan, seconds, anchor);
    follow(tmpB, plan, q, anchor);
    mix(out, tmpA, tmpB, smoothstep(0.1, 0.17, q));
  } else if (q < 0.53) {
    follow(out, plan, q, anchor);
  } else if (q < 0.6) {
    follow(tmpA, plan, q, anchor);
    storm(tmpB, plan, q, anchor);
    mix(out, tmpA, tmpB, smoothstep(0.53, 0.6, q));
  } else if (q < 0.74) {
    storm(out, plan, q, anchor);
  } else if (q < 0.82) {
    storm(tmpA, plan, q, anchor);
    wide(tmpB, plan, anchor);
    mix(out, tmpA, tmpB, smoothstep(0.74, 0.82, q));
  } else {
    wide(out, plan, anchor);
  }
}
