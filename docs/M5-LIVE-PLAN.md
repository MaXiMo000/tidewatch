# M5 - Live data: owner decisions, design, task list

Status: **merged** (PR #16): steps 1-9 below are done; s.5 is the owner's part. State and evidence: `docs/HANDOVER.md` s.0.
Read `docs/HANDOVER.md` section 0 first, then this file.

## 1. Owner decisions (2026-09-24) - do not re-ask

| Question (PLAN.md s.6) | Decision |
| --- | --- |
| Data source | **No Prometheus** (the owner has never run it). Instrument the owner's own apps with a small metrics add-on each, and poll them. |
| Which apps | **AniNest**, **LabLedger**, **Quiz-App** (local clones in `C:\Users\ADMIN\Documents\Personal\`). LabLedger and Quiz-App are **not deployed/working until next month** - that is expected: they must show as "offline" islands, not errors. |
| Who sees it | **Public, aggregates only.** No login. This overrides SECURITY.md T5 / checklist item "Live mode is behind real authentication (OIDC)": record it as an explicit, dated owner risk acceptance in `docs/SECURITY.md` (what is exposed: per-app request rate, p95, error rate, dependency health; never URLs, routes, bodies, headers, user data). Live mode must still be switched on deliberately (`TIDEWATCH_MODE=live` + `TIDEWATCH_LIVE_PUBLIC=true`). |
| Hosting | **Render free** (the owner already uses Render). Sleeps after ~15 min idle; ~1 min cold start is accepted. |
| Changes to the 3 app repos | **Commit and push directly to `main`** (owner's choice; Render redeploys on push). Commit ONLY the new/changed files - all three repos have **uncommitted local changes that are not yours: never stage, stash, reset or discard them.** `git pull --ff-only` first. |

## 2. The three apps (as found)

| App | Repo | Stack | Deploy | Dependencies worth islands |
| --- | --- | --- | --- | --- |
| AniNest | `MaXiMo000/AniNest`, branch `master` | Express (ESM, `backend/src/server.js`), libSQL/Turso (`@libsql/client`), helmet, cors, express-rate-limit, pino | Render `aninest-backend` (plan **starter**, i.e. paid, always on) - `https://aninest-backend.onrender.com`, health `/api/health` | database (libSQL); external anime API(s) if it calls them (check `backend/src`) |
| Quiz-App | `MaXiMo000/Quiz-App`, branch `main` | Express (ESM, `backend/server.js`), mongoose, ioredis/redis, socket.io, axios, OpenAI/Gemini/Together | Render (URL seen in docs: `https://quiz-app-cp2h.onrender.com`) - down until next month | database (MongoDB via driver command monitoring), cache (Redis), AI API (optional) |
| LabLedger | `MaXiMo000/LabLedger`, branch `main` | FastAPI (`backend/app/main.py`), beanie/MongoDB, Redis + arq worker, httpx | Render `labledger-api` (free) - `https://labledger-api.onrender.com`, health `/api/health` - down until next month | database (pymongo `CommandListener`), queue/worker (Redis/arq) |

Do not probe these live URLs with curl without asking (the owner declined that once).

## 3. Design

```
AniNest API ─┐  GET /tidewatch/metrics  (Bearer token, aggregates only)
Quiz-App API ─┼──────────────────────────────►  Tidewatch backend LiveSource (polls ONLY while
LabLedger API ┘                                  someone watches) ─► schemas.Snapshot ─► browsers
```

### 3.1 Metrics contract (served by each app)
`GET /tidewatch/metrics` with `Authorization: Bearer <TIDEWATCH_METRICS_TOKEN>`.
- Token compared in constant time; if the env var is unset the route does not exist (404).
- Exempt from the app's rate limiter; no cookies/session; `Cache-Control: no-store`.
- Response (JSON, small, stable):
```json
{ "v": 1, "window_s": 60, "uptime_s": 1234,
  "http": { "count": 812, "errors": 3, "p95_ms": 84.1 },
  "deps": [ { "id": "db", "kind": "database", "count": 2410, "errors": 0, "p95_ms": 11.2 } ] }
```
- `errors` = 5xx responses (4xx are the client's fault). Dependency ids are fixed strings chosen in
  code (`db`, `cache`, `queue`, `ai`, `anime-api`), max 8.
- Recording: per request only `(status class, duration)` - never URL, route params, query, body,
  headers, user ids. Rolling 60 s window of 1 s buckets; p95 from a fixed log-spaced histogram
  (e.g. 32 buckets 1 ms..60 s) merged over the window. O(1) memory.

### 3.2 The add-ons (vendored single files, no new npm/pip dependencies)
- **Node (AniNest, Quiz-App)**: `tidewatch-metrics.js` (ESM): `metricsMiddleware()` (timing on
  `res.on('finish')`), `metricsRoute(app)` (mount the endpoint), `track(depId, kind, fn)` for any
  async dependency call. MongoDB: `monitorCommands: true` + client `commandSucceeded/commandFailed`
  events (durations for every query, no per-model hooks). libSQL: wrap `client.execute`/`batch`.
  Redis (ioredis): time `sendCommand` or skip if invasive.
- **Python (LabLedger)**: `tidewatch_metrics.py`: pure ASGI middleware, route registration,
  `track()` async context manager, pymongo `monitoring.CommandListener` for MongoDB.
- Tests in each app's own framework (AniNest: check what it uses; Quiz-App: jest; LabLedger:
  pytest): window math, p95, auth (401 without/with wrong token, 404 when unset), nothing
  identifying in the output.

### 3.3 Tidewatch backend (`backend/app/`)
- **Protocol**: add status `"offline"` to `schemas.Status` AND `frontend/src/net/protocol.ts`
  (same PR). Add `GET /api/v1/info` -> `InfoResponse {mode: "demo"|"live", sources: int}`
  (strict schema) so the HUD can say "Live" instead of the demo caption.
- **Config** (`config.py`, env prefix `TIDEWATCH_`):
  - `live_sources`: JSON list of `{id, name, url}` (url = full metrics URL; ids match
    `ServiceId`). Validation: https only in prod; no userinfo/query/fragment; exact hosts.
  - `source_tokens`: JSON map id -> token (SecretStr); every source must have one.
  - `live_public: bool = False` - required to serve live data without API keys (owner risk
    acceptance); keep the existing rule "live needs api_keys" unless `live_public` is true.
  - `live_poll_seconds` (default 10, bounds 5..120), `live_allow_private` (default false; dev
    only, to poll localhost apps).
- **LiveSource** (`app/live.py`), implementing the existing `Source` protocol:
  - Polls ALL sources concurrently with httpx (already a dev dep; make it a runtime dep and
    re-lock with `scripts/lock-backend.sh`): connect 3 s / read 5 s timeouts,
    `follow_redirects=False`, response capped at 64 KB (stream + count), strict pydantic model
    for the payload (extra=forbid, bounded numbers, max 8 deps).
  - **SSRF**: URLs come only from config; resolve the host and refuse loopback, private,
    link-local, CGNAT and metadata (169.254.169.254) addresses unless `live_allow_private`;
    re-check on every poll (DNS rebinding).
  - **Only while watched**: the Hub gets a `watchers()` callable (number of subscribers). With
    0 watchers the source sleeps (so free-tier apps are never kept awake 24/7); the first
    subscriber triggers an immediate poll.
  - **Mapping** -> Snapshot: one `gateway` island "internet" (the lighthouse) with an edge to
    each app (edge rps = app rps); each app = `service` island (id = config id); each dependency
    = island `<app>-<dep>` of its kind with an edge app -> dep. Status: `offline` when
    unreachable/timeout/401/invalid payload (keep last good numbers for 2 polls, then offline);
    else thresholds (error rate > 5% or p95 > 1500 ms = failing; > 1% or > 400 ms = degraded).
  - Never log tokens or response bodies; log only source id + outcome.
- `main.py`: `_build_source` returns `LiveSource` in live mode; ticket endpoint open when
  `live_public`; otherwise keep API-key gate.
- **Tests** (no network): httpx `MockTransport` injected into LiveSource: happy path, timeout ->
  offline, 401 -> offline, oversized body, extra fields, private-IP refusal, redirect refusal,
  no polling with 0 watchers, snapshot passes `schemas.Snapshot`, tokens never in logs.

### 3.4 Frontend
- `offline` status everywhere: dark islet, no window/lantern light, grey signal, heavy local fog;
  label dot grey; summary "`n offline`"; card status word "offline"; legend row.
- Fetch `/api/v1/info` once: caption "Live · AniNest, LabLedger, Quiz-App" vs "Demo data ...".
- Unit tests (zod accepts `offline`), E2E unchanged in demo mode.

### 3.5 Render deployment (Tidewatch)
- `render.yaml` at repo root: one **Docker** web service, plan **free**, health check `/healthz`,
  env vars declared with `sync: false` for secrets (`TIDEWATCH_SOURCE_TOKENS`).
- `deploy/render/Dockerfile` (multi-stage, digests pinned): build frontend (node), install backend
  from `requirements.lock` (hash-checked), copy the Caddy binary from the pinned caddy image; run
  Caddy (serves `dist/` + the same security headers/CSP as `deploy/Caddyfile`) and uvicorn.
  Entrypoint must exit if either process dies.
- Caddy listens on `:{$PORT}` HTTP with `auto_https off` (Render terminates TLS; keep HSTS).
- Hostname: derive `TIDEWATCH_ALLOWED_HOSTS` / `TIDEWATCH_ALLOWED_ORIGINS` and the CSP
  `connect-src wss://...` from Render's `RENDER_EXTERNAL_HOSTNAME` at startup if not set.
- **Client IP (important)**: behind Render's proxy, per-IP rate limits and connection caps
  collapse to one IP unless handled. Caddy: `trusted_proxies static private_ranges`,
  `client_ip_headers X-Forwarded-For`, `trusted_proxies_strict`, and send uvicorn a SINGLE value
  (`header_up X-Forwarded-For {client_ip}`) - uvicorn with `--forwarded-allow-ips=*` takes the
  leftmost value, which would be client-spoofable otherwise. Add a test/smoke check.
- Local verification: `docker build` + `docker run -e PORT=10000 -e RENDER_EXTERNAL_HOSTNAME=localhost ...`
  then the smoke script adapted for plain HTTP behind a proxy.

### 3.6 End-to-end check (before telling the owner it works)
Run AniNest's backend locally with `TIDEWATCH_METRICS_TOKEN`, run Tidewatch in live mode with
`TIDEWATCH_LIVE_ALLOW_PRIVATE=true` pointing at it (+ LabLedger/Quiz-App URLs that fail ->
offline), generate some traffic, and screenshot: AniNest island live with real numbers, the other
two dark/offline, caption "Live". Record in HANDOVER.

## 4. Task list (in order; one commit per step, CI green before moving on)
1. Tidewatch backend: protocol (`offline`, `/api/v1/info`) + config + `LiveSource` + tests.
2. Frontend: offline visuals, HUD caption/summary/legend, zod sync, tests.
3. Render deployment files + local Docker verification + client-IP handling.
4. Node add-on + tests; integrate into **AniNest**; run its tests; push to `master`.
5. Same for **Quiz-App** (push to `main`).
6. Python add-on + tests; integrate into **LabLedger**; run pytest; push to `main`.
7. Local end-to-end run (3.6) with screenshots.
8. Docs: SECURITY.md (owner risk acceptance + new controls: T6 mapping done, T15 SSRF done,
   T16 fixed queries n/a -> fixed endpoint), ARCHITECTURE s.6 rewritten for the add-on design,
   PLAN M5 ticks, HANDOVER status, `.env.example` placeholders for the new vars.
9. Open the Tidewatch PR (`m5-live` -> `main`), CI green, then give the owner the steps in s.5.

## 5. What the owner will have to do (write it up for them at the end)
1. Generate 3 tokens: `python -c "import secrets; print(secrets.token_urlsafe(32))"` (one per app).
2. Render dashboard -> each app service -> Environment: add `TIDEWATCH_METRICS_TOKEN=<its token>`
   (AniNest now; LabLedger and Quiz-App when they come back next month).
3. Render -> New -> Blueprint -> pick the `tidewatch` repo (uses `render.yaml`) -> set
   `TIDEWATCH_SOURCE_TOKENS={"aninest":"...","labledger":"...","quiz":"..."}` and confirm the
   source URLs -> Deploy. Open the `*.onrender.com` URL (first load ~1 min on free).
   **Alternative without the Blueprint** (use it when a Blueprint sync fails with no log - on
   2026-09-24 the cause was the workspace's free-instance limit): New -> Web Service -> the
   `tidewatch` repo, branch `main`; Language Docker; Dockerfile Path `./deploy/render/Dockerfile`;
   Docker Build Context `.`; instance Free (or Starter); Health Check Path `/healthz`; environment:
   `TIDEWATCH_ENV=prod`, `TIDEWATCH_MODE=live`, `TIDEWATCH_LIVE_PUBLIC=true`,
   `TIDEWATCH_LIVE_SOURCES` (one-line JSON list) and `TIDEWATCH_SOURCE_TOKENS` (one-line JSON map).
   With Render's "Add from .env", wrap the two JSON values in single quotes and check that Render
   stored them without the quotes.
Claude cannot create accounts, sign in or enter secrets for the owner.

## 6. After M5
M2, M3, M4 and M6 are merged (#20-#23), plus island batching (#24). See `docs/HANDOVER.md` s.0.
