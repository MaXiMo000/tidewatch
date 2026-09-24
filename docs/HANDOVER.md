# Handover

Audience: Claude Code (or any engineer) picking this project up cold. Read this file, then
`CLAUDE.md`, then the milestone you are working on in `docs/PLAN.md`.

## 1. Where things stand (scaffold, "M0 not yet done")

### Built
- **Backend skeleton** (`backend/app/`): config validation, strict schemas, security primitives,
  WebSocket hub with bounded queues, demo data source, hardened API + WebSocket endpoints.
- **Backend tests** (`backend/tests/test_security.py`): 14 tests covering headers, trusted hosts, Origin
  check, single-use tickets, auth timeout, oversized/garbage auth, rate limit, connection cap,
  config validation, schema strictness, prod docs disabled.
- **Frontend skeleton** (`frontend/src/`): zod protocol mirror + tests, reconnecting client with
  first-message auth, store, placeholder scene.
- **Deploy** (`deploy/`): Caddyfile (TLS + strict CSP + single origin) and hardened compose file.
- **Repo hygiene**: `.gitignore`, `.env.example`, pre-commit (gitleaks etc.), CI (backend, frontend,
  gitleaks, CodeQL) with **commit-SHA-pinned actions**, Dependabot, `SECURITY.md`, MIT license,
  `scripts/publish.sh` and `scripts/harden-repo.sh`.

### Verified in the authoring environment
The environment that produced this scaffold had **no access to PyPI or npm**, so dependency-based tooling could not run.

| Item | Result |
| --- | --- |
| `config.py`, `schemas.py`, `security.py`, `demo.py`, `hub.py` | Exercised with an ad-hoc script (validation rules, strict schemas, ticket single-use/expiry, digests-only storage, limiters, bounded queues, incident cycle reaches degraded/failing): **passed** |
| `SecurityHeadersMiddleware` + `TrustedHostMiddleware` on a plain Starlette app | **passed** |
| All Python files compile | **passed** |

### NOT verified (do these first - this is M0)
| Item | Why unverified |
| --- | --- |
| `backend/app/main.py` and `pytest` suite | `fastapi`/`pytest` could not be installed; `main.py` compiles but has never run. Expect small first-run fixes |
| `ruff`, `mypy --strict`, `bandit`, `pip-audit` | Not installable; `mypy strict` may flag some `type: ignore` comments |
| Entire frontend (`tsc`, `vitest`, `vite build`) | npm registry unreachable; **no `package-lock.json` exists yet**, so CI's `npm ci` will fail until you create and commit it |
| Docker build and `docker compose up` | No Docker available |
| GitHub workflows, `scripts/harden-repo.sh` | Never executed against a real repo; API calls written from the docs |
| Dependency versions in `package.json` | Chosen from memory of released versions; let `npm install` and Dependabot settle them |

## 2. First 30 minutes (M0 checklist)

```bash
# 1. Backend
cd backend && python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest -x            # fix failures; report anything that suggests a design flaw rather than a typo
ruff check . && mypy app && bandit -q -r app -c pyproject.toml && pip-audit

# 2. Frontend
cd ../frontend && npm install && npm run typecheck && npm test && npm run build
git add package-lock.json    # commit the lockfile

# 3. Full stack
cd .. && (cd frontend && npm run build) && cd deploy && TIDEWATCH_DOMAIN=localhost docker compose up --build

# 4. Push and let CI run; fix red checks without loosening them.
```

Then make hash-pinned backend requirements (`pip-compile --generate-hashes`), pin the Docker base
image digests, and tick the M0 acceptance criteria in `docs/PLAN.md`.

## 3. Suggested first prompt for Claude Code

> Read `CLAUDE.md`, `docs/HANDOVER.md`, `docs/PLAN.md` and `docs/SECURITY.md`. Complete Milestone M0
> exactly as described in HANDOVER section 2: get every backend and frontend check green without
> weakening any security control, commit `package-lock.json`, get CI green, and get the compose stack
> serving the placeholder scene over HTTPS. Report anything in the "NOT verified" table that turned
> out to be wrong. Then update the "Where things stand" section of `docs/HANDOVER.md` and stop for review.

Subsequent prompts: "Complete Milestone M1", "M2", ... each with the same rules.

## 4. Publishing the repo (owner action)

The scaffold was prepared as a local git repository. Creating it on GitHub requires your logged-in
GitHub CLI:

```bash
gh auth login                         # once
./scripts/publish.sh MaXiMo000 tidewatch
```

That runs a gitleaks scan, creates the **public** repo, pushes, then applies security settings
(secret scanning + push protection, private vulnerability reporting, Dependabot, branch protection,
read-only Actions token). Read its output: any `FAIL` line means a setting must be applied by hand
in Settings -> Code security / Branches. Repo name is your call - pass another as the second argument.

## 5. Working agreements

- One PR per coherent task, small and reviewable. Conventional commit messages.
- Keep `docs/` truthful: update this file's status tables when reality changes.
- State clearly what you did **not** test.
- When a decision from `docs/PLAN.md` section 5 must change, write the reason in the PR and update the table.
- Ask the owner before: paid services, telemetry/analytics, license change, making the repo private, anything sending data off the owner's machine.

## 6. Glossary

- **Snapshot** - one tick of all service metrics and edges (`schemas.Snapshot`).
- **Source** - producer of snapshots (`DemoSource`, later Prometheus/OTel adapters).
- **Hub** - fan-out from one source to many bounded per-client queues.
- **Ticket** - single-use, 30 s token that authorises one WebSocket connection.
- **Story mode / live mode** - scripted scroll movie vs. real-data free-fly view.
- **Tier** - quality preset (High/Medium/Low) chosen by GPU detection and the FPS governor.
