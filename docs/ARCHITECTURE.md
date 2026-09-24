# Architecture

## 1. Overview

```
                    Internet
                        |
                 [ Caddy :443 ]  TLS, HSTS, strict CSP, static frontend
                   /            \
        /api/* , /ws/*           / (static: dist/)
                 |
        [ FastAPI backend ]  (private network, no published port)
           |        |
        Hub (1 producer -> N bounded queues)
           |
     Source: DemoSource (default)  |  LiveSource (M5: polls the watched apps' /tidewatch/metrics)
```

One public origin. The browser never talks to the watched apps, never holds their tokens, and
never receives raw upstream data.

## 2. Backend modules (`backend/app/`)

| Module | Responsibility |
| --- | --- |
| `config.py` | `Settings` (pydantic-settings, env prefix `TIDEWATCH_`), fail-fast validation (no wildcards, prod needs https + strong keys) |
| `schemas.py` | The **only** shapes allowed to reach a browser. Strict, bounded, `extra="forbid"` |
| `security.py` | Security-headers ASGI middleware, single-use `TicketStore`, `SlidingWindowLimiter`, `ConnectionLimiter`, constant-time API-key check |
| `demo.py` | `DemoSource`: synthetic 7-service graph with a scripted 90 s incident cycle |
| `live.py` | `LiveSource`: polls each watched app's metrics add-on (only while someone watches), validates and maps the payloads to `Snapshot` (s.6) |
| `hub.py` | `Hub`: one producer, per-client queues of max 2 frames, drop-oldest (latest-wins); `watchers()` count |
| `main.py` | App factory, routes, WebSocket handler, middleware order |

A **Source** is anything with `async def stream() -> AsyncIterator[Snapshot]`. Adding a real data
source means implementing that protocol and returning already-validated `Snapshot` objects.

## 3. HTTP + WebSocket protocol (v1)

### `GET /api/v1/info`
- `{"mode": "demo" | "live", "sources": [{"id": "aninest", "name": "AniNest"}, ...]}` (strict
  `InfoResponse`; `sources` empty in demo). The HUD uses it once at start for the caption
  ("Live · AniNest, LabLedger, Quiz-App") and island display names.

### `POST /api/v1/ws-ticket`
- Demo mode: open, rate-limited per IP (default 10/min).
- Live mode: requires `Authorization: Bearer <api key>`, unless `TIDEWATCH_LIVE_PUBLIC=true`
  (owner risk acceptance, SECURITY.md s.8): then open like demo mode.
- Response: `{"ticket": "<43-char urlsafe>", "expires_in": 30}`. Ticket is single-use, 30 s TTL.
- Errors: `401` (live, bad/missing key), `429` (rate limit), `503` (ticket store full).

### `WS /ws/v1/stream`
1. Handshake must carry an `Origin` header that exactly matches `allowed_origins`; otherwise the
   server closes before accepting (browsers then see a failed connection). Missing Origin is rejected.
2. Per-IP and global connection caps -> close `1013` when exceeded.
3. Client's **first message** (within `ws_auth_timeout_seconds`, <= `ws_max_message_bytes`):
   `{"type":"auth","ticket":"..."}`. Invalid, oversized, late, or reused ticket -> close `1008`/`1009`.
4. Server then pushes `Snapshot` text frames at `tick_hz`:

```json
{ "v": 1, "type": "snapshot", "seq": 42, "ts_ms": 1790000000000,
  "services": [ { "id": "api", "kind": "service", "rps": 381.2, "p95_ms": 61.4,
                  "error_rate": 0.0021, "status": "ok" } ],
  "edges":    [ { "src": "gateway", "dst": "api", "rps": 377.0 } ] }
```
   `status` is `ok | degraded | failing | offline`; `offline` means a live source could not be
   reached (or sent nothing valid) for more than 2 polls.
5. Client messages after auth are ignored except for size/rate enforcement (keep-alive only).

Close codes: `1000` normal, `1008` policy violation (auth/origin), `1009` message too big,
`1013` try again later (capacity). Version the protocol with `v`; breaking changes bump it and the
backend serves both during a deprecation window.

**Keep `backend/app/schemas.py` and `frontend/src/net/protocol.ts` in sync** - change both in the same PR.

## 4. Frontend modules (`frontend/src/`)

| Module | Responsibility |
| --- | --- |
| `net/protocol.ts` | zod schemas mirroring the backend; the trust boundary for network data |
| `net/client.ts` | ticket fetch -> WS -> first-message auth -> validated snapshots; backoff + jitter reconnect |
| `state/store.ts` | Latest snapshot + connection state. Sockets write; render loop reads |
| `main.ts` | Bootstrap and the single render loop; applies tier changes in one place |
| `quality/tiers.ts` | The tier table below (pixel-ratio cap, fps cap, water/sky/glow detail, particle budget) |
| `quality/gpu.ts` | Initial tier guess from renderer string, cores, memory, pointer type (probed on a throwaway canvas) |
| `quality/governor.ts` | FPS governor: down after ~2 s slow, up after 15 s good, exponential retry back-off |
| `scene/layout.ts` | Deterministic island positions from topology (longest-path columns), order-independent |
| `scene/world.ts` | Islands (size = traffic, crown/glow = status), lanterns, channels; `sync()` per snapshot, `tick()` per frame |
| `scene/water.ts`, `sky.ts`, `glow.ts`, `palette.ts`, `camera.ts` | Tiered water shader, camera-centred dusk dome, shared glow texture, colours, idle orbit |
| `hud/hud.ts` | Title, live status + compass strip, health summary, quality menu (keyboard), place panel, hints, legend, caption, toasts (textContent only) |
| `hud/inspector.ts` | Island labels (focusable buttons, collision layout), screen-space picking (same on every tier), stats card |
| `hud/copy.ts` | HUD wording: status words, per-kind subtitles, number formats |
| `scene/islands.ts` | Islets + kind-specific structures, per-island health animation (amber pulse, red flicker), one instanced glow batch; "pbr" (Cinematic) or "flat" (Balanced/Simple, one merged mesh per islet) |
| `scene/boats.ts` | Requests as GPU-animated boats on every channel (count follows rps); boats into an erroring island sink (per-instance `aSink`); Cinematic adds wakes |
| `scene/silhouette.ts`, `glows.ts`, `random.ts` | Kind -> structure + label heights; instanced billboards; seeded PRNG |
| `scene/story.ts` | The scroll film as pure functions of progress p: chapters, the request's route (from the live topology), its position, the camera shot; reduced-motion stills |
| `scene/weather.ts` | Balanced/Simple weather: latency fog, mist banks, storm clouds (one instanced billboard draw call), lightning light boost |
| `scene/weather-rules.ts` | Pure data -> weather rules: fog scale, mist amount, sink share, `LightningClock` (>= 2.5 s apart), `Shake` |
| `live/freefly.ts` | Live-view camera you steer: clamped orbit state (pure, tested), per-path limits |
| `live/feed.ts` | Snapshot diff -> event feed (`#event-feed`) and the screen-reader status sentence (`#sr-status`) |
| `live/photo.ts` | Photo mode: overlays hidden, canvas -> PNG download right after a rendered frame |
| `live/fallback2d.ts` | 2D view (accessible table from snapshots) and the "3D is struggling" detector |
| `audio/ambience.ts` | Optional Web Audio ambience, lazy chunk, off by default, no audio files |
| `scene/beacon.ts` | The film's hero request: one warm light (2 draw calls), attached to the active render path |
| `hud/story.ts` | Film DOM: scroll progress, current chapter (`html[data-chapter]`, rail `aria-current`), route names in the chapter text |
| `debug/overlay.ts` | `?debug=1` fps / CPU ms / draw calls / triangles - dev builds only |

### The scroll film (M2)
- **Native scroll, no scroll library.** The page is tall (`#story`: six chapter `<section>`s sized so
  an anchor jump lands on the storyboard's p); the canvas and HUD are fixed. Chapters are plain
  anchors (`#chapter-hops`, `#live`): keyboard, back button, deep links and screen readers work, and
  nothing hijacks the wheel or iOS momentum. `scroll-behavior: smooth` only without reduced motion.
- **Read once per frame.** The render loop reads `scrollY` (the range is cached on resize) and
  eases its own copy of p (~0.15 s), so wheel steps glide. No scroll listeners do work.
- **Camera:** `storyPose(p)` gives the shot (aerial drift -> tracking shot on the request -> the
  slow island -> wide), continuous in p; `rig.applyStory()` blends it into the live camera from
  p 0.86 to 0.97. Balanced/Simple roam freely (open water); **Cinematic** passes its composed view
  as an anchor, so every shot stays inside the channel its forest keeps clear (unit-tested).
- **Reduced motion:** p snaps to one still per chapter, so the camera cuts between stills and
  never glides; the aerial does not drift.
- **Route:** the longest path from the gateway (max 5 islands, ending at a database if possible):
  `gateway -> api -> queue -> worker -> db` in the demo, `internet -> app -> db` in live mode.

### Render loop rules
- One `requestAnimationFrame` loop; skip when `document.hidden`; drop to low fps when idle.
- Read `store.latest` once per frame; **interpolate** between 1 Hz snapshots so values never pop.
- No allocations per frame in the hot path (reuse vectors/colours); `InstancedMesh` for anything repeated.
- All DOM text set with `textContent`. No HTML built from data.

## 5. Quality tiers: same world, three render paths

| | Cinematic (High) | Balanced (Medium) | Simple (Low) |
| --- | --- | --- | --- |
| Code | `src/cinematic/` - separate lazy chunk, imported only on High after first paint | `render/stylised.ts` (main bundle) | same as Balanced |
| Sky | HDR dusk dome, fbm clouds lit from below, small moon/sun; PMREM environment | gradient shader + 1 cloud band | gradient shader |
| Lighting | ACES tone mapping (post), 1 directional light + 1 soft PCF shadow cascade, hemisphere + PMREM | hemisphere + directional, no shadows | same |
| Water | planar reflection (Reflector, half-float, `reflectionScale`), 3 normal layers, Fresnel, glint column | shader with fake (sky) reflection, animated normals | flat gradient + Fresnel |
| Atmosphere | half-res raymarched height fog (noise, HG scatter), colour/density follow p95 | FogExp2 | FogExp2 |
| World | mossy islets with kind-specific structures (lighthouse, tower, stilt hall, beacon, vault, jetty, workshop), instanced cypress + moss + knees, lily pads, reeds | low-poly islands, instanced silhouette treeline (90) | same, 30 trees, no glow sprites |
| Post | bloom (lanterns/glint only), half-res height fog, depth AO + light shafts, subtle DOF, ACES, teal/pink grade, light CA, vignette, grain, lightning flash | CSS vignette | CSS vignette |
| Requests / health | boats + wakes, shore foam, amber pulse / red flicker, storm clouds, rain, lightning, fireflies | boats, amber pulse / red flicker | boats, pulse/flicker, no glow |
| Pixel ratio cap / target fps | 2 / 60 | 1.5 / 60 | 1 / 30 |

Shared by all paths: `scene/model.ts` (layout, eased values, counts, latency, storm), the camera
rig and the HUD. The Cinematic camera does a slow pendulum drift around a composed base azimuth
(chosen to separate the islands; the sun is placed relative to it so the glint faces the viewer);
stylised paths orbit. Under prefers-reduced-motion the camera holds still.

### Cinematic asset pipeline

Everything is generated on the device at load time, behind the progress bar: the water normal map
(periodic value noise), leaf-cluster and Spanish-moss cards (seeded canvas drawings), islet rock
(displaced icosphere with vertex colours), structures (primitives merged per material), cypress
trunks (flared lathe) and all placement (seeded PRNG). There are **no downloaded models or
textures**, so there is no glTF/KTX2 parsing of untrusted files, no Draco/Basis/Meshopt decoder,
and **no CSP change** (`'wasm-unsafe-eval'` is not needed). If real assets are ever added they must
follow the asset rules in `docs/PLAN.md` (CC0/permissive, committed with SOURCES.md + licences,
self-hosted decoders, size limits, no external references).

`quality/gpu.ts` guesses the starting tier; `quality/governor.ts` samples the rAF interval and steps
**down** after ~2 s below ~48 fps, and back **up** only after 15 s at ~55+ fps, with a doubling
back-off on a tier it fell from. Users override with the HUD quality button (auto/high/medium/low,
kept in `localStorage` as a display preference) or `?quality=`. Low and idle (20 s without input)
render at 30 fps. A 2D fallback dashboard (M4) covers no-WebGL and below-minimum devices.

`quality/detect.ts` then refines the start tier with **detect-gpu** (owner decision), its benchmark
JSON served from our own origin (`/benchmarks/*.json`, emitted by a Vite plugin from the npm
package) and loaded through `loadBenchmarks` with a name allowlist and size cap - the library's
unpkg.com default is never used. Phones and tablets are never auto-promoted to Cinematic.

## 6. Live data (M5): metrics add-ons + `LiveSource`

Goal: real metrics in, only allowlisted aggregates out. No Prometheus: each watched app serves
its own aggregates and Tidewatch polls them (owner decision, `docs/M5-LIVE-PLAN.md`).

```
AniNest API  ─┐  GET /tidewatch/metrics   (Bearer token per app, aggregates only)
Quiz-App API ─┼────────────────────────►  LiveSource (polls only while someone watches)
LabLedger API ┘                            ─► validate ─► map ─► schemas.Snapshot ─► browsers
```

1. **The add-on** (`addons/`, vendored into each app): rolling 60 s window of 1 s buckets per
   series (the app's HTTP traffic + up to 8 dependencies: db, cache, queue, ai, anime-api...);
   count, 5xx count, p95 from a 32-bucket log histogram. Records only (duration, ok) - never
   URLs, routes, bodies, headers or user ids. Route exists only when the app has
   `TIDEWATCH_METRICS_TOKEN`; constant-time token check. Contract in `addons/README.md`.
2. **Config-only endpoints.** `TIDEWATCH_LIVE_SOURCES` (JSON `[{id, name, url}]`) and
   `TIDEWATCH_SOURCE_TOKENS` (JSON `{id: token}`, one per source) are validated at startup: https
   in prod, no userinfo/query/fragment, ids `[a-z0-9]{1,15}` and not `internet`, 1..8 sources.
3. **SSRF.** Every poll resolves the host and refuses non-public addresses (loopback, private,
   link-local/metadata, CGNAT, multicast) unless `TIDEWATCH_LIVE_ALLOW_PRIVATE` (dev only); the
   request goes to the checked IP with Host/SNI set to the name; no redirects, no env proxies.
4. **Limits.** 3 s connect / 5 s read, 64 KB streamed cap, identity encoding only, strict payload
   model (`extra="forbid"`, bounded numbers, errors <= count, unique dep ids, max 8).
5. **Only while watched.** The Hub's `watchers()` count gates polling: with no viewers nothing is
   polled, so Render free apps are not kept awake; the first viewer triggers an immediate poll.
   Interval `TIDEWATCH_LIVE_POLL_SECONDS` (default 10, 5..120).
6. **Mapping** (the only thing that leaves): island `internet` (gateway, the lighthouse) -> one
   `service` island per app (config id, config display name) -> one island `<app>-<dep>` per
   dependency, of the kind the add-on declared. Edge rps = request rate. Status per island:
   error rate > 5% or p95 > 1500 ms = failing; > 1% or > 400 ms = degraded; else ok. Third-party
   `service` dependencies (an LLM, an external API) are judged by error rate only - seconds per
   call is normal for them. Unreachable / timeout / 401 / invalid payload: keep the last good
   numbers for 2 polls, then `offline` (topology is kept, so islands do not jump around).
7. **Logging.** `live source <id>: <outcome>` from a fixed vocabulary, once per change. Never
   tokens, URLs with credentials, or response bodies.
8. **Multi-instance.** Still single-instance: `TicketStore`, rate limits and the poller are in
   memory. Moving them to Redis (`GETDEL` for tickets) is future work.

## 7. Deployment

`deploy/docker-compose.yml`: Caddy (public) + backend (private network). Backend container is
non-root, read-only filesystem, all capabilities dropped, `no-new-privileges`, memory/PID limits.
The backend network is `internal: true` (no route out; M5 adapters get a dedicated egress network).
The image installs only hash-verified wheels from `backend/requirements.lock`; base images are
pinned by digest. Frontend is built to static files and served by Caddy. Config only via
environment. `scripts/smoke_compose.py` checks the running stack (also run by the CI `compose` job).

**Render (M5, the public deployment):** `render.yaml` + `deploy/render/` - one free Docker web
service. The image builds the frontend, installs the backend from the hash-checked lock and copies
the pinned Caddy binary; `start.sh` runs Caddy on `$PORT` (plain HTTP, Render terminates TLS; same
headers/CSP as `deploy/Caddyfile`, HSTS kept) and uvicorn on 127.0.0.1, derives allowed
hosts/origins and the CSP `wss://` host from `RENDER_EXTERNAL_HOSTNAME`, and exits if either
process dies. Client IP: Caddy trusts only private ranges (`trusted_proxies_strict`, rightmost
untrusted `X-Forwarded-For` entry) and hands uvicorn exactly one value, so per-IP limits work and
cannot be spoofed by prepending entries (`scripts/smoke_render.py`, CI). Free plan: sleeps after
~15 min idle, ~1 min cold start (accepted).

## 8. Testing strategy

- **Backend:** unit tests for every security primitive and failure path (see `tests/test_security.py`);
  add property tests for schemas; SSRF tests for adapters; WebSocket load test with k6 in M6.
- **Frontend:** vitest for protocol, layout, governor, tier heuristics. Playwright smoke tests
  (`frontend/e2e/`, since M1) run in the CI `compose` job against the real HTTPS stack with the
  runner's installed Chrome: zero CSP violations/console errors, live data, a rendered canvas on
  every tier, keyboard tier control, reduced motion. Bundle budget checked in CI. Visual regression
  on chapter keyframes in M2; Lighthouse budget in M6.
- **Security:** ZAP baseline in CI (M6); CSP violations reported to a log endpoint in report-only phase.
