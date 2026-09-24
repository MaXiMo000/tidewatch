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
     Source: DemoSource (default)  |  PrometheusSource / OTel source (M5, read-only)
```

One public origin. The browser never talks to Prometheus, never holds upstream credentials, and
never receives raw upstream data.

## 2. Backend modules (`backend/app/`)

| Module | Responsibility |
| --- | --- |
| `config.py` | `Settings` (pydantic-settings, env prefix `TIDEWATCH_`), fail-fast validation (no wildcards, prod needs https + strong keys) |
| `schemas.py` | The **only** shapes allowed to reach a browser. Strict, bounded, `extra="forbid"` |
| `security.py` | Security-headers ASGI middleware, single-use `TicketStore`, `SlidingWindowLimiter`, `ConnectionLimiter`, constant-time API-key check |
| `demo.py` | `DemoSource`: synthetic 7-service graph with a scripted 90 s incident cycle |
| `hub.py` | `Hub`: one producer, per-client queues of max 2 frames, drop-oldest (latest-wins) |
| `main.py` | App factory, routes, WebSocket handler, middleware order |

A **Source** is anything with `async def stream() -> AsyncIterator[Snapshot]`. Adding a real data
source means implementing that protocol and returning already-validated `Snapshot` objects.

## 3. HTTP + WebSocket protocol (v1)

### `POST /api/v1/ws-ticket`
- Demo mode: open, rate-limited per IP (default 10/min).
- Live mode: requires `Authorization: Bearer <api key>` (M5 replaces this for browsers with real auth).
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
| `hud/hud.ts` | Status, text health summary, compass, quality control (textContent only) |
| `debug/overlay.ts` | `?debug=1` fps / CPU ms / draw calls / triangles - dev builds only |

Planned (M2+):

```
src/
  scene/     particles.ts  weather.ts
  story/     timeline.ts (GSAP master)  camera-path.ts  chapters.ts  overlays.ts
  live/      freefly.ts  panel.ts  feed.ts  fallback2d.ts
  audio/     ambience.ts (optional, off by default)
```

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
| Post | fog composite, ACES, split tone (Round 3: bloom, DOF, AO, grain, CA) | CSS vignette | CSS vignette |
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

## 6. Live data adapters (M5) - design

Goal: real metrics in, only allowlisted aggregates out.

1. **Poll on the server at a fixed interval**, independent of the number of viewers.
2. **Config-only endpoints.** The upstream URL comes from server config, never from a request.
   Resolve and validate the target: https only in prod, deny loopback/link-local/metadata
   (`169.254.169.254`) and private ranges unless explicitly allow-listed. This closes SSRF.
3. **Fixed queries.** PromQL is defined in code, parameterised only by service ids from an
   allowlist. No user-supplied query text anywhere.
4. **Explicit mapping** from upstream labels to public service ids (`config/services.yaml`-style).
   Unmapped series are dropped. Output only through `schemas.Snapshot`.
5. **Least privilege.** Read-only token for the metrics API; stored in env/secret manager; never
   logged; never returned. Rotate on suspicion.
6. **Limits.** Connect/read timeouts, max response bytes, max series count, circuit breaker with
   backoff; on failure publish last-known data flagged `stale` rather than erroring clients.
7. **Multi-instance.** Move `TicketStore`, rate limits and (optionally) the latest snapshot to Redis
   (`GETDEL` for tickets). Until then run a single backend instance.
8. **Emitting metrics from FastAPI apps.** Provide a tiny ASGI middleware that records only
   `(service, route_template, status_class, duration)` - never full URLs, query strings, headers, or bodies.

## 7. Deployment

`deploy/docker-compose.yml`: Caddy (public) + backend (private network). Backend container is
non-root, read-only filesystem, all capabilities dropped, `no-new-privileges`, memory/PID limits.
The backend network is `internal: true` (no route out; M5 adapters get a dedicated egress network).
The image installs only hash-verified wheels from `backend/requirements.lock`; base images are
pinned by digest. Frontend is built to static files and served by Caddy. Config only via
environment. `scripts/smoke_compose.py` checks the running stack (also run by the CI `compose` job).

## 8. Testing strategy

- **Backend:** unit tests for every security primitive and failure path (see `tests/test_security.py`);
  add property tests for schemas; SSRF tests for adapters; WebSocket load test with k6 in M6.
- **Frontend:** vitest for protocol, layout, governor, tier heuristics. Playwright smoke tests
  (`frontend/e2e/`, since M1) run in the CI `compose` job against the real HTTPS stack with the
  runner's installed Chrome: zero CSP violations/console errors, live data, a rendered canvas on
  every tier, keyboard tier control, reduced motion. Bundle budget checked in CI. Visual regression
  on chapter keyframes in M2; Lighthouse budget in M6.
- **Security:** ZAP baseline in CI (M6); CSP violations reported to a log endpoint in report-only phase.
