# Handover

Audience: Claude Code (or any engineer) picking this project up cold. Read this file, then
`CLAUDE.md`, then the milestone you are working on in `docs/PLAN.md`.

## 0. Next up: M5 live data (branch `m5-live`) - start here

M0, M1 and the art pass (PR #15) are **merged**; `main` is green. The owner asked for **real data
before M2**. Every owner decision, the full design, the ordered task list with acceptance criteria
and the owner's own to-do list are in **`docs/M5-LIVE-PLAN.md`** - read it completely. Summary:

- Watch the owner's apps **AniNest**, **LabLedger**, **Quiz-App** (local clones next to this repo
  in `C:\Users\ADMIN\Documents\Personal\`). LabLedger and Quiz-App are down until next month: they
  must render as **offline** islands, which is expected, not a bug.
- No Prometheus. Each app gets a tiny vendored metrics add-on serving aggregates at
  `GET /tidewatch/metrics` (Bearer token); Tidewatch's new `LiveSource` polls them only while
  someone is watching.
- **Public, aggregates only** (owner risk acceptance, to be recorded in SECURITY.md).
- Host on **Render free** (one Docker service: Caddy on `$PORT` + uvicorn, `render.yaml`).
- App repo changes are **pushed directly to their default branch** (owner's choice). Those repos
  have **uncommitted local work that is not ours - never stage, stash, reset or discard it.**
- Don't curl the apps' live URLs without asking (owner declined once).

State of `m5-live`: this handoff commit only; no M5 code yet. Nothing in the three app repos has
been changed.

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

## 1. Where things stand (M0, M1, art pass merged - M5 live data next, then M2)

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

> Read `CLAUDE.md`, `docs/HANDOVER.md` (section 0 first), `docs/M5-LIVE-PLAN.md`, `docs/SECURITY.md`
> and `docs/ARCHITECTURE.md` in `C:\Users\ADMIN\Documents\Personal\tidewatch`. Continue on branch
> `m5-live` and implement M5 live data following `docs/M5-LIVE-PLAN.md` section 4 in order. Owner
> decisions there are final - don't re-ask them. Same rules as always, one commit per step, CI green.
> Finish with the Tidewatch PR and the owner's step list, then stop for review.

After M5: "Complete Milestone M2", then M3, M4, M6, with the same rules each time.

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
