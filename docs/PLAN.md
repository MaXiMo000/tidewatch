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

### M3 - Data-driven visuals (chapters 4-5) (built 2026-09-24)
- [x] Requests as GPU-animated instanced boats (since the art pass; CPU cost: one uniform write).
- [x] Latency -> fog density/colour + mist banks over each slow island (Balanced/Simple:
  `scene/weather.ts`; Cinematic already had screen-space fog + storms in `cinematic/drama.ts`).
- [x] Failing -> storm clouds over the island, darker lights, lightning (<= 1 per 2.5 s), channels
  into it run red, a short camera shake when a service newly fails (<= 1 per 2.5 s).
- [x] Errors -> boats sink on their way into the erroring island (share = 4x error rate, max 60%),
  on every tier, entirely in the boat vertex shader.
- [x] Snapshot interpolation: every visual reads the model's eased values (no popping at 1 Hz).
- [x] Reduced motion: no lightning, no shake, no drifting mist.
- **Accept:**
  - [x] Driven purely by the WebSocket snapshot (rules are pure functions: `scene/weather-rules.ts`,
    unit-tested incl. the flash-rate limit).
  - [x] Demo incident legible: screenshots `docs/screenshots/m3/` (calm, degraded mist, failing storm,
    the storm chapter close-up). Budgets hold over a full incident: Simple 26 calls / 8.4k tris,
    Balanced 27 / 15k.

### M4 - Live mode (built 2026-09-24)
- [x] Free-fly in the live view (`live/freefly.ts`): mouse drag turns, Shift+drag slides, W/S in and
  out, A/D circle, R/F tilt, 0 or "Reset view" hands back; touch: horizontal drag turns, pinch zooms
  (vertical stays the page's scroll). Cinematic stays inside its clear channel (tighter limits).
- [x] Click/tap/Tab an island -> metrics card (since M1; `textContent` only).
- [x] Event feed of status changes (`live/feed.ts`), live view only; first snapshot is a baseline.
- [x] Photo mode: P hides every overlay, Save downloads a PNG of the canvas (blob URL, local only).
- [x] Optional procedural ambience (water, wind with the storm, thunder after lightning): off by
  default, starts only from the Sound button, lazy chunk (0.9 KB gzip), suspended when hidden.
- [x] 2D view (`live/fallback2d.ts`): the same live data as an accessible table - automatic when
  WebGL is unavailable, `?view=2d` or the "2D view" button; suggested (never forced) when the Simple
  tier still runs under 12 fps for 10 s. The 3D loop does not render while it shows.
- **Accept:**
  - [x] a11y: every new control is a real button (keyboard, focus ring, `aria-pressed` for sound),
    photo mode is keyboard-only operable (P, Enter, Esc), one polite screen-reader status sentence
    (`#sr-status`: counts + names of anything unhealthy, only when it changes; the visual summary
    no longer duplicates it), table with row/column headers and a caption in the 2D view.
  - [x] Fallback verified: E2E with WebGL context creation failing -> 2D view with the reason, no
    errors; E2E `?view=2d` and back.
  - [ ] Screen-reader pass with a real reader (NVDA/VoiceOver) - **not done** (no reader here).

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

### M6 - Hardening and launch (built 2026-09-24)
- [x] Trusted Types **enforced** directly (no report-only phase needed: the bundle has no DOM XSS
  sink, and all E2E tests pass under enforcement against the compose stack).
- [x] ZAP baseline scan in CI (`scripts/zap_gate.py`: medium/high fail). Found and fixed on the way:
  Java clients send no SNI for `localhost`, so Caddy refused them - `default_sni` set.
- [x] k6 WebSocket load test in CI (`scripts/load/ws.js`): caps, 429s, memory flat.
- [x] Performance budget in CI - **deviation:** measured by the browser in the E2E suite (first
  paint, bytes before the first frame, JS bytes, no third-party origins) instead of adding
  Lighthouse as a dependency.
- [x] SBOM + build provenance: `.github/workflows/release.yml` on `v*.*.*` tags.
- [x] README with the film GIF and screenshots; CHANGELOG.
- [ ] `v0.1.0` release - **owner**: #20-#25 merged; push the tag from a local clone (see HANDOVER s.0).
- **Accept:** SECURITY.md s.7 is ticked with evidence except three items that need the real
  deployment or the release tag (headers on the real domain, securityheaders.com grade, the first
  published SBOM) - each says what remains and who does it.

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
