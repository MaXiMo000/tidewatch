# Plan

## 1. Vision

A **film you steer**. The visitor scrolls through a short cinematic story that teaches how a request
travels through a system and what an incident looks like, then the story ends and the world unlocks
into a **live, free-fly view** of real service health.

Non-goals: replacing Grafana/Prometheus, alerting/paging, long-term storage, multi-tenant SaaS.
Tidewatch is a **read-only visual layer** over data that already exists.

## 2. Visual language

| Concept | Metaphor |
| --- | --- |
| Service | Low-poly island (size = traffic, colour = status) |
| Request | Light particle / small ship travelling along a channel between islands |
| Latency (p95) | Fog density and colour; storm clouds over the slow service |
| Error rate | Red flashes, ships sinking, lightning |
| Healthy idle | Calm dusk, gentle water shimmer, fireflies |

Art direction: **stylised low-poly with glow** (not photoreal). It reads as cinematic, and it is an
order of magnitude cheaper than photoreal water/foliage, which is what makes low-end devices viable.
Palette: deep teal water, violet-pink dusk sky, warm lantern accents, status colours
`ok #3fd0a5`, `degraded #f2b134`, `failing #ff4d5e`. Serif display type (self-hosted), monospaced HUD.

## 3. Scroll storyboard (story mode)

Scroll progress `p in [0,1]` drives pure shot functions (`scene/story.ts`); the camera cross-fades
between shots that are continuous in p (M2: native scroll, no Lenis/GSAP - see the M2 notes).
Story mode is **scripted** (deterministic, uses the demo incident) so it always plays well; live mode
binds the real data.

| # | Chapter | p range | What happens |
| --- | --- | --- | --- |
| 1 | Aerial | 0.00-0.12 | World in fog; title fades in; slow drift over the archipelago |
| 2 | The request | 0.12-0.30 | A light particle enters the gateway; camera locks on and follows |
| 3 | Service hops | 0.30-0.55 | gateway -> auth -> api -> cache -> db; each island labelled as passed |
| 4 | The storm | 0.55-0.75 | db slows: clouds gather, fog thickens, rain; queue backs up visually |
| 5 | The failure | 0.75-0.90 | Errors: red flash, camera shake, a ship sinks; recovery begins |
| 6 | Live | 0.90-1.00 | Scroll unlocks -> free-fly; click an island for real metrics; event feed |

Text overlays are HTML/CSS over the canvas (cheap, sharp, accessible). Chapter markers allow jumping.

## 4. Milestones

Each milestone is shippable and has acceptance criteria. Order matters: security and performance
foundations come before spectacle.

### M0 - Bring-up and baseline (done 2026-09-24, PR #1)
- [x] Install deps, generate and commit `frontend/package-lock.json`; generate hash-pinned
  `backend/requirements.lock` (`pip-compile --generate-hashes`) and use it in the Dockerfile.
- [x] Run the full backend suite, `ruff`, `mypy`, `bandit`, `pip-audit`; fix first-run failures.
- [x] Run frontend `typecheck`, `test`, `build`; confirm the placeholder scene shows demo data end-to-end.
- [x] Get CI green; pin the Docker base image by digest; build and smoke-test `deploy/docker-compose.yml`.
- **Accept:**
  - [x] CI green on a fresh clone (every job runs from a fresh checkout; `npm ci` from the lockfile)
  - [x] `docker compose up` serves the app over HTTPS locally (`scripts/smoke_compose.py`, 32/32; also a CI job)
  - [x] `scripts/harden-repo.sh` output reviewed (no FAIL; settings read back; 2 gaps closed)

### M1 - Scene foundation + quality tiers (built 2026-09-24, PR #14)
- [x] Renderer setup, resize, pixel-ratio cap, initial tier guess + live FPS governor (High/Med/Low).
  Own heuristic instead of `detect-gpu` (runtime CDN fetch; see ARCHITECTURE s.5).
- [x] Island layout from the service graph (stable positions from topology, not array order).
- [x] Cheap water shader (gradient + Fresnel + animated normal, no planar reflection on any tier yet),
  exponential fog, dusk sky, baked-glow sprites.
- [x] HUD (compass, status, text health summary, tier control) in HTML/CSS.
- [x] Playwright smoke test (ARCHITECTURE s.8) against the HTTPS compose stack, in CI.
- **Accept:**
  - [ ] 60 fps High / 30+ fps Low on the reference low-end device - **owner action**: no reference
    device has been chosen or tested yet (PERFORMANCE.md). Measured so far: see HANDOVER.
  - [x] Tier auto-downgrade tested (`quality/governor.test.ts`: down, up, hysteresis, back-off, pauses)

### M2 - Scroll movie (chapters 1-3) (built 2026-09-24)
- [x] Scroll film over all six chapters (camera for 4-5 too; their weather visuals are M3): aerial,
  the request arriving and hopping along the live route, the slow island, wide, hand-over to live.
- [x] Chapter cards (HTML, sticky), chapter rail + skip link (plain anchors, deep-linkable), route
  names written from the topology.
- [x] `prefers-reduced-motion`: one still per chapter (cuts), no drift, no smooth scrolling.
- [x] Touch/phones: native scroll, cards re-laid out, no horizontal overflow (E2E at 390x844).
- **Deviation (written reason):** native scroll + an eased progress value instead of Lenis + GSAP
  ScrollTrigger. Same scrub feel, 0 KB, no scroll hijacking (a11y, iOS momentum), camera math stays
  pure and unit-tested. `gsap` and `lenis` were never imported and are removed from package.json.
- **Accept:**
  - [x] Scroll adds no main-thread cost over idle on Low (`scripts/perf-scroll.mjs`: 4.7 vs 5.4 ms/frame
    headless SwiftShader, no throttle); a mid-scroll shader-compile stall was found and fixed.
    At 4x CPU throttle this VM is 9.6-15 ms/frame scrolling OR idle (software GL baseline, not the film).
  - [x] Reduced motion verified (E2E: camera still within a chapter, cut between chapters).
  - [ ] iOS Safari, Android Chrome, desktop Firefox - **not verified** (no devices/browsers here);
    only headless Chromium at desktop and 390x844 phone size.

### M3 - Data-driven visuals (chapters 4-5)
- `InstancedMesh` request particles with GPU vertex animation (CPU cost ~0 regardless of count).
- Latency -> fog/storm; errors -> flash/shake/sinking; status colours; snapshot interpolation
  (no popping between 1 Hz ticks).
- **Accept:** driven purely by the WebSocket snapshot; incident cycle in demo mode is clearly legible.

### M4 - Live mode
- Free-fly camera (mouse/touch/WASD), click island -> metrics panel (sanitised, `textContent`),
  event feed, photo mode, optional Web Audio ambience (off by default, user-gesture start).
- 2D fallback dashboard when WebGL is unavailable or the device is below a minimum tier.
- **Accept:** a11y pass (keyboard, screen-reader summary of status), fallback verified.

### M5 - Real data + authentication (done in PR #16, before M2 - owner decision 2026-09-24)
- [x] Protocol `offline` + `/api/v1/info`, live config, `LiveSource` (SSRF tests, polls only while watched)
- [x] Frontend offline visuals, live caption, zod sync
- [x] Render deployment (`render.yaml`, `deploy/render/`, client-IP handling, smoke test in CI)
- [x] Metrics add-ons (`addons/`) in AniNest, Quiz-App, LabLedger, each with tests, pushed
- [x] Local end-to-end run with real AniNest data (`docs/screenshots/m5/`)
- [x] SECURITY.md owner risk acceptance; ARCHITECTURE s.6 rewritten
- [ ] Owner: tokens + Render Blueprint (`docs/M5-LIVE-PLAN.md` s.5)
- **Re-scoped:** see `docs/M5-LIVE-PLAN.md` (decisions, design, ordered tasks). Short version: no
  Prometheus; a small metrics add-on in each of the owner's apps (AniNest, LabLedger, Quiz-App),
  polled by a `LiveSource` only while watched; public aggregates-only view (owner risk acceptance
  replaces OIDC for now); hosted on Render free. The original scope below stays for later.
- Adapters: Prometheus (server-side polling, fixed queries) and an ASGI middleware/OpenTelemetry
  source for FastAPI apps. See `docs/ARCHITECTURE.md` section 6 for the security design.
- Real user auth for live mode (OIDC via an identity-aware proxy or built-in), replacing the API-key gate
  for browsers. Redis-backed ticket store + rate limits for multi-instance deployments.
- **Accept:** SSRF tests pass; upstream cost is independent of viewer count; no upstream label ever
  reaches a client without passing through the mapping + schema layer. (Met for the re-scoped M5.
  Still open from the original scope: OIDC - replaced for now by the owner's risk acceptance - and
  the Redis-backed ticket store for multi-instance.)

### M6 - Hardening and launch
- Enforce Trusted Types (report-only first); ZAP baseline scan in CI; k6 WebSocket load test;
  Lighthouse performance budget in CI; SBOM + build provenance attestation.
- Screenshots/GIF for the README, docs polish, `v0.1.0` release.
- **Accept:** every item in `docs/SECURITY.md` section 7 is ticked with evidence.

## 5. Decisions already made (change only with a written reason)

| Decision | Reason |
| --- | --- |
| Vite + vanilla Three.js (no React Three Fiber) | Smaller bundle, fewer deps, direct control of the render loop for low-end devices |
| ~~Stylised low-poly + glow, not photoreal~~ -> tiered: near-photoreal Cinematic, stylised Balanced/Simple | Owner decision 2026-09-24 (art pass): High evokes the reference swamp; weak devices get the simple version; Medium/Low must not slow down to serve High |
| Demo mode is the default | Runs with zero credentials; safe to show publicly |
| First-message WebSocket auth with single-use ticket | Keeps credentials out of URLs/logs/history |
| One public origin behind Caddy | No CORS surface, simple CSP, automatic TLS |
| Server-side polling with fixed interval | Upstream load independent of number of viewers |
| Data flows store -> render loop | Message bursts cannot cause jank |
| detect-gpu picks the start tier, benchmarks self-hosted | Owner decision; self-hosting keeps rule 5 (no third-party runtime origin) |
| Cinematic is fully procedural (no downloaded models/textures) | Allowed by the asset rules; avoids untrusted-file parsing, WASM decoders and any CSP relaxation; 14.8 KB lazy download instead of MBs |
| Cinematic camera: pendulum drift around an auto-composed base view | A full orbit cannot keep framing trees at the sides without them occluding islands |
| prefers-reduced-motion stops the camera (overrides "never frozen") | The OS accessibility setting outranks the cinematic brief |
| Fonts: Cormorant Garamond + IBM Plex Mono via @fontsource (OFL-1.1), Latin subset, 5 weights | Self-hosted from our origin (rule 5, CSP font-src 'self'); 100 KB WOFF2 |
| Same world on every tier: shared islands/structures/boats, flat materials below Cinematic | "Same world, different render path"; Balanced/Simple stay inside their budgets |
| Live data from a metrics add-on in each app, not Prometheus | Owner decision 2026-09-24: no Prometheus running; apps are the owner's own (Express x2, FastAPI) |
| Live view public, aggregates only (no login) | Owner decision 2026-09-24; recorded as risk acceptance in SECURITY.md during M5 |
| Hosting: Render free, single Docker service (Caddy + uvicorn) | Owner decision 2026-09-24: free, already used for the apps; cold starts accepted |

## 6. Open questions for the owner

1. ~~Real data source~~ - answered 2026-09-24: metrics add-on in the owner's apps (see section 5).
2. ~~Public or private live view~~ - answered: public, aggregates only.
3. Sound: yes/no for ambience? (still open)
4. ~~Hosting target~~ - answered: Render free.
