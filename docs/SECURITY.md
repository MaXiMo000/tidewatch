# Security model

**Honest framing:** no system is "zero risk". This document defines what we protect, from whom,
which controls exist (and where they live in the code), what is *planned but not yet built*, and the
residual risks we accept. If a control below is marked `[planned]`, it is not in the code yet.

## 1. Assets

| ID | Asset | Why it matters |
| --- | --- | --- |
| A1 | Metrics and topology data | Reveals architecture, load and incidents (live mode) |
| A2 | Upstream credentials (the per-app metrics tokens, `TIDEWATCH_SOURCE_TOKENS`) | Would let anyone read the apps' aggregate metrics directly |
| A3 | API keys / WebSocket tickets | Gate access to live data |
| A4 | Service availability | A public WebSocket endpoint is a DoS target |
| A5 | Visitors' browsers | XSS or supply-chain compromise runs code in their session |
| A6 | Repository and build pipeline | Compromise = malicious code shipped to everyone |

## 2. Actors

Anonymous internet user; malicious website targeting a visitor (CSWSH/CSRF); network attacker
(MITM); compromised or typosquatted dependency; curious/malicious viewer trying to extract data
that is not meant for them; a mistaken contributor committing a secret.

## 3. Trust boundaries

1. Browser <-> Caddy (public internet, TLS).
2. Caddy <-> backend (private container network).
3. Backend <-> the watched apps' `GET /tidewatch/metrics` endpoints (public internet, TLS, one
   bearer token per app). The apps are separate repos; their add-on is `addons/`.
4. Repository <-> CI <-> release artefacts (supply chain).

Everything crossing 1 and 3 is untrusted input and is validated.

## 4. Threats and controls

| # | Threat | Control | Where | Status |
| --- | --- | --- | --- | --- |
| T1 | Cross-site WebSocket hijacking | Exact `Origin` allowlist checked before accepting; missing Origin rejected | `main.py` `stream()` | done |
| T2 | Credentials leaking via URLs/logs/history/Referer | Ticket sent as first WS message, never in URL; `Referrer-Policy: no-referrer` | `main.py`, `client.ts` | done |
| T3 | Ticket theft/replay | Single-use, 30 s TTL, only SHA-256 digests stored, 256-bit random | `security.py` `TicketStore` | done |
| T4 | Brute-forcing API keys / timing attacks | Constant-time compare; ticket endpoint rate-limited per IP | `security.py` | done (single instance) |
| T5 | Unauthorised live data access | Live mode requires an API key for tickets **unless** `TIDEWATCH_LIVE_PUBLIC=true`; public live mode is an explicit, dated owner risk acceptance (s.8) and must be switched on deliberately (`TIDEWATCH_MODE=live` + `TIDEWATCH_LIVE_PUBLIC=true`). What it exposes is bounded by T6 | `config.py`, `main.py` | accepted risk (owner, 2026-09-24) |
| T6 | Data exfiltration through the stream | Strict allowlist schemas (`extra="forbid"`, bounded). Live payloads are validated by their own strict model and **mapped**, never forwarded: island ids are config ids + fixed dependency ids, display names come from config; only rate, p95, error rate, status reach browsers | `schemas.py`, `live.py`, ARCH s.6 | done |
| T7 | XSS | No `innerHTML`/eval/inline code, `textContent` only, strict CSP (`script-src 'self'`), zod validation, Trusted Types enforced with no policy (`trusted-types 'none'`) | `client.ts`, `deploy/Caddyfile` | done |
| T8 | Third-party script compromise | No third-party origins at runtime; self-hosted assets; SRI if ever unavoidable | CSP, code review | done |
| T9 | DoS via connections | Global and per-IP WS caps; auth timeout (5 s); message size cap; per-connection message rate cap | `security.py`, `main.py` | done |
| T10 | DoS via slow clients / memory growth | Bounded per-client queue (2), drop-oldest; single producer | `hub.py` | done |
| T11 | Volumetric DDoS | Out of scope for the app: use a CDN/WAF/provider protection in front | deploy | documented |
| T12 | Host-header attacks / DNS rebinding | `TrustedHostMiddleware` with exact hosts; wildcards (`*`, `*.x`) and non-exact origins rejected at startup | `main.py`, `config.py` | done |
| T13 | Clickjacking | `frame-ancestors 'none'` (API + frontend CSP; Caddy sets the frontend CSP on static files only, so the API keeps its own) | `security.py`, Caddyfile | done (smoke-tested) |
| T14 | MIME sniffing / caching of sensitive responses | `nosniff`; API `Cache-Control: no-store` | `security.py` | done |
| T15 | SSRF via adapters | URLs from config only (https in prod; no userinfo, query or fragment); host resolved on **every** poll and refused unless every address is public (loopback, private, link-local incl. 169.254.169.254, CGNAT, multicast denied; `TIDEWATCH_LIVE_ALLOW_PRIVATE` is dev-only); connection pinned to the checked IP with Host/SNI set to the name (no DNS-rebinding window); no redirects, no env proxies (`trust_env=False`); 3 s connect / 5 s read; 64 KB streamed cap; no compression | `config.py`, `live.py`, `tests/test_live.py` | done |
| T16 | Query injection into upstream | n/a by design: no query language - one fixed endpoint per app (`GET /tidewatch/metrics`), nothing user-supplied is sent | `live.py` | n/a (fixed endpoint) |
| T17 | Secret committed to a public repo | `.gitignore`, `.env.example` only, pre-commit gitleaks + `detect-private-key`, CI gitleaks, GitHub secret scanning + push protection | repo, `scripts/harden-repo.sh` | done (harden script applied and verified) |
| T18 | Vulnerable dependencies | Lockfiles (npm + hash-pinned `requirements.lock`), Dependabot, `pip-audit` (venv + lock), `npm audit`, CodeQL; `npm ci --ignore-scripts` | CI | done (green in CI) |
| T19 | Malicious/compromised GitHub Action | Actions pinned to commit SHAs (enforced by the repo's `sha_pinning_required`); `permissions: contents: read`; `persist-credentials: false` | `.github/workflows`, `scripts/harden-repo.sh` | done |
| T20 | Container escape / privilege abuse | Non-root user, read-only FS, `cap_drop: ALL`, `no-new-privileges`, memory/PID limits, backend not published, backend network `internal` (no egress) | `deploy/`, Dockerfile | done (smoke-tested locally + CI) |
| T21 | Information disclosure via errors/docs | OpenAPI/docs disabled in prod; generic error responses; no stack traces to clients | `main.py` | done |
| T22 | Weak production config | Startup validation: prod requires https origins and >= 32-char keys; live requires keys | `config.py` | done |
| T23 | Tampered release artefacts | SPDX SBOM + Sigstore build-provenance attestation + SHA256SUMS on every tagged release | `.github/workflows/release.yml` | done (runs on the first tag) |
| T24 | Log injection / secret logging | Never log tickets/keys/headers. `LiveSource` logs only `source id: outcome` from a fixed vocabulary, once per change; a test asserts tokens never reach logs | `live.py`, `tests/test_live.py` | done (live); structured logs M6 |
| T26 | Live-mode extras leaking data or surprising users (M4) | Photo mode saves the canvas locally (`toBlob` -> same-origin blob URL -> `<a download>`), nothing is uploaded; sound is off by default and needs a click (no autoplay); the 2D view and event feed render validated snapshots with `textContent` only; no CSP change was needed | `live/`, `audio/` | done |
| T25 | The apps' metrics endpoint leaking data or access | Add-on route exists only when `TIDEWATCH_METRICS_TOKEN` is set; token compared in constant time; records only (duration, ok) per request/dependency call - never URLs, routes, bodies, headers, user ids; `no-store`; fixed dependency ids, max 8; tests in each app | `addons/`, the apps' repos | done |

## 5. Secure development rules

See `CLAUDE.md` "Non-negotiable security rules". In short: no secrets in the repo, allowlist schemas
for everything outbound, validate everything inbound, no dynamic code or HTML injection, no
third-party origins, no credentials in URLs/storage, no wildcards, minimal dependencies, never
weaken a check to get CI green.

## 6. Public-repository hygiene

- The repo is public: it must contain **only** demo data, placeholders and generic config.
- No real hostnames, IPs, tokens, metric names from real systems, or screenshots of real dashboards.
- If a secret is ever committed: **rotate it first**, then remove it from history. Deleting the file is not enough.
- Enable (via `scripts/harden-repo.sh`): secret scanning, push protection, private vulnerability
  reporting, Dependabot alerts + security updates, branch protection on `main`, read-only default
  workflow token.
- Review third-party pull requests' workflow changes with extra care; require approval for first-time contributors' workflow runs (repo setting).

## 7. Pre-launch checklist (M6 - tick with evidence)

- [x] `pytest`, `ruff`, `mypy`, `bandit`, `pip-audit`, `npm audit`, CodeQL, gitleaks all green in CI (every job on PRs #20-#22)
- [x] `docker compose up`: backend not reachable except through Caddy - `smoke_compose.py` in CI checks no published port, no host reachability, no internet egress
- [ ] `curl -I https://<domain>` shows HSTS, CSP, nosniff, COOP, Referrer-Policy; no `Server` header - **verified on the localhost stack by `smoke_compose.py` (CI); re-run against the real domain after the Render deploy (owner)**
- [ ] securityheaders.com / Mozilla Observatory grade A or better - **needs the public URL (owner, after deploy)**
- [x] WebSocket from a foreign Origin is refused; reused/expired/garbage tickets refused (`smoke_compose.py`, `tests/test_security.py`)
- [x] Connection caps and rate limits verified under k6 load; memory flat (`scripts/load/ws.js` in CI: 20 viewers from one IP -> 5 admitted, 15 turned away, ticket burst -> 429; backend 40.2 -> 40.4 MiB). The backend's per-client queues hold 2 frames with drop-oldest, so a slow reader cannot grow memory (`tests/test_security.py`)
- [x] CSP has no `unsafe-inline`/`unsafe-eval`; browser console shows zero CSP violations (E2E, every test, production build)
- [x] Trusted Types **enforced**: `require-trusted-types-for 'script'; trusted-types 'none'` (no policy at all - the bundle has no DOM XSS sink); all 22 E2E tests pass under it against the compose stack
- [x] ZAP baseline scan has no medium+ findings (CI step + `scripts/zap_gate.py`; local run 2026-09-24: 1 low "timestamp disclosure", 3 info)
- [x] Live adapters: SSRF test suite passes (`tests/test_live.py`); the only upstream credential is a per-app token for a read-only aggregates endpoint; payloads are validated and mapped, never forwarded
- [x] ~~Live mode is behind real authentication (OIDC)~~ - replaced by the owner's risk acceptance (s.8, 2026-09-24): public, aggregates only
- [x] Secrets scan of full git history clean (CI gitleaks, `fetch-depth: 0`); GitHub push protection enabled (`scripts/harden-repo.sh`, verified at M0)
- [ ] SBOM + provenance published for the release - **`.github/workflows/release.yml` is ready (SPDX SBOM via syft, Sigstore build-provenance attestation, SHA256SUMS); it runs when the owner pushes the `v0.1.0` tag**
- [x] Docker base images pinned by digest; dependencies hash-pinned (M0: `python:3.12-slim@sha256`, `caddy:2@sha256`, `backend/requirements.lock`, npm lockfile integrity hashes)

## 8. Residual risks we accept (and why)

- **Public live data (owner risk acceptance, 2026-09-24).** The owner decided live mode is public,
  with no login, overriding T5's OIDC requirement. Exposed to anyone: per app and per dependency
  (database, cache, queue, AI / external API) the request rate, p95 latency, error rate and
  ok/degraded/failing/offline status, plus the display names in `TIDEWATCH_LIVE_SOURCES`. Never
  exposed: URLs, hostnames, routes, bodies, headers, tokens, user data. Consequence accepted:
  anyone can see when the apps are busy, slow or down. Live mode stays off unless
  `TIDEWATCH_MODE=live` and `TIDEWATCH_LIVE_PUBLIC=true` are both set. Revisit before watching an
  app whose load itself is sensitive.
- **Polling only while watched** means the apps (Render free, sleeping) are woken by a visitor;
  a visitor can therefore cause at most one poll per `live_poll_seconds` per app.

- **In-memory limits/tickets are per instance.** Fine for one instance; multi-instance needs Redis (M5).
- **Client IP depends on the reverse proxy** setting `X-Forwarded-For` correctly; behind a CDN,
  configure trusted proxy ranges precisely.
- **Volumetric DDoS** is a provider/CDN concern.
- **A public demo can still be hammered** (cost of ticks/connections). Caps bound the blast radius; they do not eliminate it.
- **Supply chain** can never be reduced to zero. Pinning + audits + minimal deps reduce likelihood and blast radius.
- **WebGL fingerprinting / device info** is inherent to using WebGL; we add no analytics or telemetry.
