# CLAUDE.md - instructions for Claude Code

Tidewatch = FastAPI backend streaming service metrics over WebSocket + a Three.js scroll-driven
"movie" frontend. **Read `docs/HANDOVER.md` first**, then `docs/PLAN.md` for the milestone you are on.

## Commands

```bash
# backend (from backend/)
pip install -e ".[dev]"
ruff check . && mypy app && bandit -q -r app -c pyproject.toml && pytest
uvicorn app.main:get_app --factory --reload --port 8000

# frontend (from frontend/)
npm ci --ignore-scripts        # after package-lock.json exists; use `npm install` once to create it
npm run typecheck && npm test && npm run build
npm run dev
```

## Non-negotiable security rules

These protect the owner and every future user. If a task seems to conflict with one, stop and ask.

1. **No secrets in the repo, ever.** No keys, tokens, real hostnames, real metrics, customer data,
   or `.env` files. Only `.env.example` with placeholders. Run `gitleaks detect` before committing.
2. **Everything sent to a browser goes through `backend/app/schemas.py`** (strict, `extra="forbid"`,
   bounded). Never forward raw upstream payloads, labels, log lines, URLs or headers.
3. **Everything received from the network is untrusted** - frontend validates with `zod`
   (`frontend/src/net/protocol.ts`, kept in sync with the backend schemas).
4. **No `innerHTML`, `eval`, `new Function`, `document.write`, inline scripts or inline styles.**
   Use `textContent`. The production CSP forbids them and CI should keep it that way.
5. **No third-party origins at runtime** (no CDN scripts/fonts/analytics). Self-host and bundle.
6. **No credentials in URLs or browser storage.** WebSocket auth is a first-message ticket.
7. **No wildcards** in CORS origins, allowed hosts, or CSP. Config validation rejects them; do not
   weaken it.
8. **Live adapters** (M5): fixed queries in code, config-only endpoints (no user-supplied URLs),
   read-only credentials from env/secret manager, explicit service-name mapping, size/time limits.
9. **Dependencies**: add sparingly, justify in the PR, commit lockfiles, keep CI actions pinned to
   commit SHAs. `npm ci --ignore-scripts` in CI.
10. **Do not disable, skip or loosen** tests, linters, CI checks, or security headers to get green.

## Conventions

- Python: typed (mypy strict), `ruff`, Pydantic v2, no blocking calls in async paths, small modules.
- TypeScript: `strict`, no `any`, no default exports for modules with multiple concerns.
- Data never blocks rendering: sockets write to `state/store.ts`; the render loop reads it once per frame.
- Performance budgets in `docs/PERFORMANCE.md` are requirements, not aspirations.
- Prefer procedural geometry/shaders over model files (size + low-end devices).
- Keep docs in sync: if behaviour, protocol or a security control changes, update `docs/` in the same PR.

## Definition of done (every task)

- Tests added/updated and passing; `ruff`, `mypy`, `bandit`, `pip-audit`, `npm audit` clean.
- Works in all three quality tiers (once M1 lands) and with `prefers-reduced-motion`.
- Security checklist items touched by the change are still true (`docs/SECURITY.md`).
- No new secret-like strings; `gitleaks` clean.
- `docs/HANDOVER.md` "current state" updated.

## Working style

Work milestone by milestone in `docs/PLAN.md`; open one PR per coherent task; state what you did NOT
verify. Ask the owner before: adding paid services, changing the license, making the repo private,
adding analytics/telemetry, or anything that sends data off the user's machine.
