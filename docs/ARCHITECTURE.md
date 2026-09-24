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
| `main.ts` | Placeholder scene (M0). Replaced by the modules below |

Planned (M1+):

```
src/
  scene/     renderer.ts  world.ts (islands)  water.ts  sky.ts  particles.ts  weather.ts
  story/     timeline.ts (GSAP master)  camera-path.ts  chapters.ts  overlays.ts
  live/      freefly.ts  panel.ts  feed.ts  fallback2d.ts
  quality/   tiers.ts  governor.ts (FPS monitor)  gpu.ts (detect-gpu)
  audio/     ambience.ts (optional, off by default)
```

### Render loop rules
- One `requestAnimationFrame` loop; skip when `document.hidden`; drop to low fps when idle.
- Read `store.latest` once per frame; **interpolate** between 1 Hz snapshots so values never pop.
- No allocations per frame in the hot path (reuse vectors/colours); `InstancedMesh` for anything repeated.
- All DOM text set with `textContent`. No HTML built from data.

## 5. Quality tiers

| | High | Medium | Low |
| --- | --- | --- | --- |
| Pixel ratio cap | 2 | 1.5 | 1 |
| Water | shader + optional planar reflection | shader, fake reflection | flat gradient + Fresnel |
| Post-processing | bloom + grain + vignette | vignette | none (CSS vignette) |
| Particles | 2000 | 800 | 250 |
| Fog/clouds | layered | single layer | single layer |
| Shadows | off (baked glow instead) | off | off |
| Target fps | 60 | 60 | 30 |

`detect-gpu` picks the starting tier; `quality/governor.ts` samples frame time and steps **down**
(and, with hysteresis, back up). Users can override in a settings menu. A 2D fallback dashboard covers
no-WebGL and below-minimum devices.

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
- **Frontend:** vitest for protocol/client/store; Playwright smoke test (page loads, canvas renders,
  HUD says `live`) in M1; visual regression on chapter keyframes in M2; Lighthouse budget in M6.
- **Security:** ZAP baseline in CI (M6); CSP violations reported to a log endpoint in report-only phase.
