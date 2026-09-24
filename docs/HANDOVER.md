# Handover

Audience: Claude Code (or any engineer) picking this project up cold. Read this file, then
`CLAUDE.md`, then the milestone you are working on in `docs/PLAN.md`.

## 0. Current state: M5 merged (PR #16); M2 (#20), M3 (#21) and M4 (stacked) in review

**M5 live data is merged** (PR #16): metrics add-ons in AniNest/Quiz-App/LabLedger (`addons/`),
`LiveSource`, offline islands, Render deployment files, owner risk acceptance in SECURITY.md.
The owner's remaining part is the Render steps in `docs/M5-LIVE-PLAN.md` s.5 (tokens, env vars,
Blueprint). LabLedger and Quiz-App show **offline** until they are redeployed next month.

**M2 scroll film** (this branch; design in ARCHITECTURE s.4 "The scroll film"):
- `scene/story.ts` (pure, 15 unit tests: chapters, route planning, request path, continuity of the
  camera, Cinematic's clear-channel constraint), `scene/beacon.ts` (the hero request),
  `hud/story.ts` (chapter markers, route names), camera `applyStory()` blend into the live rig.
- Six chapter cards + rail + skip link in `index.html` (plain anchors: `/#live`, `/#chapter-hops`).
- Reduced motion: one still per chapter (cuts). Phones: native scroll, re-laid-out cards.
- E2E: 5 new tests (chapters/rail/route text, keyboard skip + rail, `/#live`, reduced-motion stills,
  phone overflow). `gsap` + `lenis` removed (never used; native scroll instead - PLAN M2 deviation).
- Screenshots: `docs/screenshots/m2/` (Balanced aerial/hops/live, Cinematic request/hops, phone).
- Perf: scrolling costs the same as idle on Low (4.7 vs 5.4 ms/frame, headless SwiftShader); a
  mid-scroll shader-compile stall (beacon's first draw) was found with the profiler and fixed.

**M3 data-driven weather** (branch `m3-data-visuals`, stacked on M2 - merge #20 first):
- `scene/weather-rules.ts` (pure, 6 tests: fog scale, mist, sink share, lightning >= 2.5 s apart,
  shake rate limit, all off under reduced motion) and `scene/weather.ts` (Balanced/Simple: latency
  fog, mist banks, storm clouds in ONE instanced draw call, lightning light boost).
- Boats into an erroring island sink (boat vertex shader, every tier); channels into a failing
  island run red; the camera shakes briefly when a service newly fails (`model.failureEvents`).
- Budgets over a full demo incident: Simple 26 calls / 8.4k tris, Balanced 27 / 15k.
- Screenshots `docs/screenshots/m3/` (calm, degraded, failing on Balanced and Simple; storm chapter).
- Also fixes found while testing: the live card fades once the view settles (`html[data-settled]`).

**M4 live mode** (branch `m4-live-mode`, stacked on M3 - merge #20, then #21, first):
- `live/freefly.ts` (drag / WASD / R-F / pinch, 0 resets; Cinematic limited to its channel),
  `live/feed.ts` (event feed + `#sr-status` sentence), `live/photo.ts` (P, Save, Esc),
  `live/fallback2d.ts` (2D table: no WebGL -> automatic, `?view=2d`, button; suggested when Simple
  stays < 12 fps), `audio/ambience.ts` (off by default, lazy 0.9 KB chunk). 14 new unit tests,
  6 new E2E tests (free-fly, photo PNG, sound, SR sentence, 2D view, no-WebGL fallback).
- Initial bundle 178.1 KB gzip. No CSP change.

Not verified: iOS Safari, Android Chrome, desktop Firefox; real low-end hardware; fps on real GPUs;
a real screen reader (NVDA/VoiceOver); sinking boats caught mid-sink on camera.
Next: **M6** (Trusted Types, ZAP, k6, Lighthouse budget, SBOM + provenance, README, v0.1.0).

Rules unchanged: app repos may have **uncommitted local work that is not ours - never stage,
stash, reset or discard it**; don't curl the apps' live URLs without asking.

### Session environment notes (Windows 11 laptop, Intel UHD)
- Shells: PowerShell (primary) and Git Bash. Python venv at `backend/.venv/Scripts/python.exe`.
- gitleaks before every commit:
  `/c/Users/ADMIN/tools/gitleaks/gitleaks.exe git --pre-commit --staged --no-banner --redact .`
- Dev servers in the desktop app: `preview_start` names `tidewatch-backend` (uvicorn :8000) and
  `tidewatch-frontend` (Vite, port 5174) from `C:\Users\ADMIN\Documents\Personal\.claude\launch.json`
  (the parent folder, not this repo).
- Docker Desktop works (compose stack + `lock-backend.sh`). `gh` is authenticated as MaXiMo000.
- `main` is protected: squash-only, 6 required checks (backend, frontend, compose, gitleaks,
  analyze (python), analyze (javascript-typescript)). Work on a branch, open a PR.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; PR body ends with
  `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- Open Dependabot PRs for Python 3.14 and TypeScript 7 are **owner decisions** - leave them.
- Steps 5-9 of M5 ran in a Claude Code cloud session (Linux): Docker works there, so LabLedger's
  suite ran against `mongo:7` and Quiz-App's `mongodb-memory-server` used the image's `mongod`
  (`MONGOMS_SYSTEM_BINARY`) because the sandbox blocks fastdl.mongodb.org.

## 1. Where things stand (M0, M1, art pass, M5 merged; M2-M4 in review; then M6)

### Built
- **Backend** (`backend/app/`): config validation, strict schemas, security primitives,
  WebSocket hub with bounded queues, demo data source, hardened API + WebSocket endpoints.
- **Backend tests** (`backend/tests/test_security.py`): 31 tests covering headers, trusted hosts, Origin
  check, single-use tickets, auth timeout, oversized/garbage auth, rate limit, connection cap,
  config validation (incl. wildcard/non-exact hosts and origins), schema strictness, prod docs disabled.
- **Frontend** (`frontend/src/`): zod protocol mirror, reconnecting client with first-message auth,
  store, and the M1 scene: dusk archipelago (islands from topology, tiered water/sky, baked glow),
  quality tiers + FPS governor, HUD (status, text health summary, compass, quality control).
  26 unit tests (vitest) + 8 browser tests (Playwright, `frontend/e2e/`). `package-lock.json` committed.
- **Deploy** (`deploy/`): Caddyfile (TLS + strict CSP + single origin) and hardened compose file;
  backend image installs only from the hash-pinned `backend/requirements.lock`; base images pinned by digest.
- **Repo hygiene**: public at `github.com/MaXiMo000/tidewatch` with `scripts/harden-repo.sh` applied;
  CI (backend, frontend, compose smoke test, gitleaks, CodeQL) with SHA-pinned actions (enforced by
  the repo setting), Dependabot (pip, npm, actions, docker, docker-compose).

### Art pass (before M2) - Rounds 1-4 done, merged (PR #15)
Tiers are now named Cinematic / Balanced / Simple (URL `?quality=high|medium|low`). Cinematic is a
lazy chunk (`src/cinematic/`), Balanced/Simple share `src/render/stylised.ts`; both read the one
`WorldModel`. HUD: `src/hud/` (inspector with picking, quality menu, legend, Q/L/Esc keys).
Tests now: 33 vitest, 10 Playwright.
Screenshots + critique logs per round: `docs/screenshots/round-{1,2,3,4}/`.

| Tier | Draw calls | Triangles | GPU mem (est.) | CPU ms/frame | Download beyond initial |
| --- | --- | --- | --- | --- | --- |
| Cinematic | 163 (budget 200) | 374k (400k) | 42.5 MB (64) | 7.8 | 20.1 KB gzip JS (all procedural) |
| Balanced | 26 (60) | 15k (20k) | ~0 | 2.0 | none |
| Simple | 25 (40) | 8.3k (10k) | ~0 | 2.1 | none |

Measured on this machine (Intel UHD, i3-1125G4), 1440x900, dpr 1, all passes counted (main,
reflection, shadow, post). Initial JS 169.0 KB gzip (budget 350) + 100 KB self-hosted fonts.
fps: Cinematic 41 fps headed at 1440x900 **before Round 3** (post stack + boats + drama added
since); headless numbers are throttled and not quoted. **Not verified:** fps on a discrete GPU,
Apple M-series or Iris Xe; Balanced/Simple fps in a headed browser; any phone hardware; the
governor stepping down from Cinematic on a genuinely slow GPU (unit-tested only).

### Verified (M1, 2026-09-24)
| Item | Result |
| --- | --- |
| Unit tests: layout (order independence, longest path, cycles, 200-node DAG), governor (down/up/hysteresis/back-off/pauses), tier heuristic, protocol | 26 pass |
| Browser E2E vs the HTTPS compose stack (Chrome and Edge locally; Chrome in CI) | 8/8: zero CSP violations and console errors, live seq advancing, real rendered canvas on High/Medium/Low, keyboard tier control with accessible name, reduced motion stops the orbit |
| Bundle | 150.8 KB gzip (budget 350), checked in CI; debug overlay absent from prod |
| Frame cost (dev preview, Medium, this Windows laptop, Chrome) | 38 draw calls, 1,230 triangles, ~0.5 ms CPU/frame (budgets: <= 150 / 150k High, <= 60 / 40k Low) |

### Verified (M0, 2026-09-24)
| Item | Result |
| --- | --- |
| Backend: `pytest` (31), `ruff`, `mypy --strict app tests`, `bandit`, `pip-audit` (venv + `requirements.lock`) | **pass** locally and in CI |
| Frontend: `npm ci --ignore-scripts`, `typecheck`, `vitest` (3), `build`, `npm audit` | **pass**, 0 vulnerabilities; JS 132.5 KB gzip (budget 350) |
| Dev stack end-to-end (Vite proxy -> uvicorn) | HUD reads `live · seq N`, seq advances at 1 Hz |
| `docker compose up` over HTTPS (Caddy local CA) | `scripts/smoke_compose.py`: **32/32 checks pass** locally (Docker Desktop) and in the CI `compose` job |
| Backend isolation | no published port; unreachable from host, default bridge and Caddy's public network; no internet egress |
| Response headers vs `deploy/Caddyfile` | exact match on `/` and `/api/*`; API keeps its own `default-src 'none'` CSP; no `Server`/`Via` |
| CI on PR | backend, frontend, compose, gitleaks, CodeQL (python, js/ts) all green; no Node 20 warnings |
| `scripts/harden-repo.sh` | every call `ok`; each setting read back via the API and matches |

### What M0 found wrong in the scaffold
| Item | Finding | Fix |
| --- | --- | --- |
| `main.py` + pytest | Worked first time (14/14) | - |
| ruff / mypy | 3 lines > 100 chars; unused `type: ignore` in `demo.py`; test fixture typing | Typed the service table with `Kind`; wrapped lines |
| Config validation | Only rejected the literal `"*"`: `*.example.com` hosts (a Starlette wildcard) and non-exact origins were accepted | Exact hostnames / `scheme://host[:port]` origins only; 17 tests |
| Frontend `tsc` | `status` possibly null inside the render-loop closure | Re-bound checked nodes as non-null consts |
| `package.json` versions | vite 5 / vitest 2 had 5 dev-only advisories (1 critical, 1 high) | vite 8.3, vitest 5.0 (needs Node >= 22.12) |
| Compose healthcheck | Always 400 (TrustedHost rejects `127.0.0.1`): backend would never be healthy | Healthcheck sends the configured Host; Caddy waits for healthy |
| Caddyfile | Site-wide CSP overwrote the API's stricter CSP; `Via: 1.1 Caddy` leaked the proxy | CSP scoped to static files; `-Via` |
| Compose network | Backend had open internet egress | `internal: true` on the backend network |
| Dockerfile | `pip install .` (unpinned, unhashed) | `--require-hashes --no-deps` from `requirements.lock`, app run from source |
| CI actions | Pins targeted Node 20, removed from hosted runners 2026-09-16 | Re-pinned to checkout v7.0.1, setup-python v7.0.0, setup-node v7.0.0, gitleaks-action v3.0.0, codeql v4.38.1 |
| `harden-repo.sh` | Worked, but SHA pinning was not enforced and only 3 checks were required | `sha_pinning_required`; all 6 CI checks required |

### Still NOT verified
| Item | Why |
| --- | --- |
| **M1 acceptance: 60 fps High / 30+ fps Low on the reference low-end device** | No reference device chosen or available. Needs the owner: pick one (PERFORMANCE.md), open `?debug=1` on a dev build, or run the production build and watch the tier the governor settles on |
| Governor stepping down on real slow hardware | Logic unit-tested with synthetic frames; not observed on a genuinely slow GPU |
| iOS Safari / Android Chrome / Firefox | Only Chrome and Edge on Windows, and headless Chrome (SwiftShader) in CI |
| Draw calls scale per island (5 on High/Medium, 3 on Low) | Fine for the 7-service demo (38 calls). Budgets are hit at ~19 services on Low (60) and ~29 on High (150): instance islands before real topologies arrive (M3/M5) |
| Deployment on a real public host / real domain / Let's Encrypt | Only `localhost` tested |
| `pre-commit` hooks | Not installed locally; gitleaks ran manually before each commit |
| Starlette `httpx` TestClient deprecation | Warning only (Starlette asks for `httpx2`); tests pass. Revisit when it becomes an error |

## 2. Everyday commands

```bash
# 1. Backend (Windows: .venv/Scripts/...)
cd backend && python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
ruff check . && mypy app && bandit -q -r app -c pyproject.toml && pip-audit && pytest

# 2. Frontend (Node >= 22.12)
cd ../frontend && npm ci --ignore-scripts && npm run typecheck && npm test && npm run build && npm run check:bundle
# dev: npm run dev, then http://localhost:5173/?debug=1 (overlay) or ?quality=high|medium|low

# 3. Full stack over HTTPS + smoke test
cd ../deploy && TIDEWATCH_DOMAIN=localhost docker compose up --build -d --wait
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt /tmp/ca.crt
TIDEWATCH_DOMAIN=localhost ../backend/.venv/bin/python ../scripts/smoke_compose.py --ca /tmp/ca.crt --compose-file docker-compose.yml
# browser tests need TIDEWATCH_TICKET_RATE_PER_MINUTE=120 on `compose up` (all pages share one IP)
cd ../frontend && E2E_BASE_URL=https://localhost E2E_CHANNEL=chrome npm run e2e   # or msedge

# 4. After changing backend runtime dependencies (needs Docker)
./scripts/lock-backend.sh
```

## 3. Suggested prompt for Claude Code

> Read `CLAUDE.md`, `docs/HANDOVER.md` (section 0 first) and `docs/PLAN.md`. Complete Milestone M2
> exactly as described there, with the same rules as always: one commit per step, CI green, docs in
> sync, then stop for review.

Then M3, M4, M6, with the same rules each time.

## 4. Publishing and GitHub settings

Done in M0: `scripts/publish.sh MaXiMo000 tidewatch` created the **public** repo and ran
`scripts/harden-repo.sh` (secret scanning + push protection, private vulnerability reporting,
Dependabot alerts + security updates, SHA-pinned actions enforced, read-only Actions token,
branch protection on `main` requiring all six CI checks, squash-only linear history).
`harden-repo.sh` is idempotent: re-run it after adding a CI job and add the job to its
`contexts` list. Any `FAIL` line means a setting must be applied by hand in Settings.

## 5. Working agreements

- One PR per coherent task, small and reviewable. Conventional commit messages.
- Keep `docs/` truthful: update this file's status tables when reality changes.
- State clearly what you did **not** test.
- When a decision from `docs/PLAN.md` section 5 must change, write the reason in the PR and update the table.
- Ask the owner before: paid services, telemetry/analytics, license change, making the repo private, anything sending data off the owner's machine.

## 6. Glossary

- **Snapshot** - one tick of all service metrics and edges (`schemas.Snapshot`).
- **Source** - producer of snapshots (`DemoSource`; M5 adds `LiveSource`, polling the apps' metrics add-ons).
- **Hub** - fan-out from one source to many bounded per-client queues.
- **Ticket** - single-use, 30 s token that authorises one WebSocket connection.
- **Story mode / live mode** - scripted scroll movie vs. real-data free-fly view.
- **Tier** - quality preset (Cinematic/Balanced/Simple, internally high/medium/low) chosen by GPU detection and the FPS governor.
