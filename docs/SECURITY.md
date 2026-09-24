# Security model

**Honest framing:** no system is "zero risk". This document defines what we protect, from whom,
which controls exist (and where they live in the code), what is *planned but not yet built*, and the
residual risks we accept. If a control below is marked `[planned]`, it is not in the code yet.

## 1. Assets

| ID | Asset | Why it matters |
| --- | --- | --- |
| A1 | Metrics and topology data | Reveals architecture, load and incidents (live mode) |
| A2 | Upstream credentials (Prometheus etc.) | Would give read access to internal systems |
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
3. Backend <-> upstream metrics API (internal network, credentials).
4. Repository <-> CI <-> release artefacts (supply chain).

Everything crossing 1 and 3 is untrusted input and is validated.

## 4. Threats and controls

| # | Threat | Control | Where | Status |
| --- | --- | --- | --- | --- |
| T1 | Cross-site WebSocket hijacking | Exact `Origin` allowlist checked before accepting; missing Origin rejected | `main.py` `stream()` | done |
| T2 | Credentials leaking via URLs/logs/history/Referer | Ticket sent as first WS message, never in URL; `Referrer-Policy: no-referrer` | `main.py`, `client.ts` | done |
| T3 | Ticket theft/replay | Single-use, 30 s TTL, only SHA-256 digests stored, 256-bit random | `security.py` `TicketStore` | done |
| T4 | Brute-forcing API keys / timing attacks | Constant-time compare; ticket endpoint rate-limited per IP | `security.py` | done (single instance) |
| T5 | Unauthorised live data access | Live mode requires an API key for tickets; **browser-grade auth (OIDC) is required before exposing live mode publicly** | `main.py` | partial - see M5 |
| T6 | Data exfiltration through the stream | Strict allowlist schemas (`extra="forbid"`, bounded), explicit label mapping, no raw upstream data | `schemas.py`, ARCH s.6 | done (schemas); mapping planned M5 |
| T7 | XSS | No `innerHTML`/eval/inline code, `textContent` only, strict CSP (`script-src 'self'`), zod validation, Trusted Types `[planned M6]` | `client.ts`, `deploy/Caddyfile` | done / planned |
| T8 | Third-party script compromise | No third-party origins at runtime; self-hosted assets; SRI if ever unavoidable | CSP, code review | done |
| T9 | DoS via connections | Global and per-IP WS caps; auth timeout (5 s); message size cap; per-connection message rate cap | `security.py`, `main.py` | done |
| T10 | DoS via slow clients / memory growth | Bounded per-client queue (2), drop-oldest; single producer | `hub.py` | done |
| T11 | Volumetric DDoS | Out of scope for the app: use a CDN/WAF/provider protection in front | deploy | documented |
| T12 | Host-header attacks / DNS rebinding | `TrustedHostMiddleware` with exact hosts; wildcards rejected at startup | `main.py`, `config.py` | done |
| T13 | Clickjacking | `frame-ancestors 'none'` (API + frontend CSP) | `security.py`, Caddyfile | done |
| T14 | MIME sniffing / caching of sensitive responses | `nosniff`; API `Cache-Control: no-store` | `security.py` | done |
| T15 | SSRF via adapters | Config-only endpoints, IP/host validation, deny link-local/metadata/private by default, timeouts, size caps | ARCH s.6 | planned M5 |
| T16 | Query injection into upstream | Fixed queries in code; only allowlisted ids interpolated | ARCH s.6 | planned M5 |
| T17 | Secret committed to a public repo | `.gitignore`, `.env.example` only, pre-commit gitleaks + `detect-private-key`, CI gitleaks, GitHub secret scanning + push protection | repo, `scripts/harden-repo.sh` | done (needs harden script run) |
| T18 | Vulnerable dependencies | Lockfiles, Dependabot, `pip-audit`, `npm audit`, CodeQL; `npm ci --ignore-scripts` | CI | configured; not yet run |
| T19 | Malicious/compromised GitHub Action | Actions pinned to commit SHAs; `permissions: contents: read`; `persist-credentials: false` | `.github/workflows` | done |
| T20 | Container escape / privilege abuse | Non-root user, read-only FS, `cap_drop: ALL`, `no-new-privileges`, memory/PID limits, backend not published | `deploy/`, Dockerfile | done (untested build) |
| T21 | Information disclosure via errors/docs | OpenAPI/docs disabled in prod; generic error responses; no stack traces to clients | `main.py` | done |
| T22 | Weak production config | Startup validation: prod requires https origins and >= 32-char keys; live requires keys | `config.py` | done |
| T23 | Tampered release artefacts | SBOM + build provenance attestation | CI | planned M6 |
| T24 | Log injection / secret logging | Never log tickets/keys/headers; structured logs with redaction | code review | planned (M5 logging) |

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

- [ ] `pytest`, `ruff`, `mypy`, `bandit`, `pip-audit`, `npm audit`, CodeQL, gitleaks all green in CI
- [ ] `docker compose up` on a clean host: backend not reachable except through Caddy (`nmap`/`curl` from outside)
- [ ] `curl -I https://<domain>` shows HSTS, CSP, nosniff, COOP, Referrer-Policy; no `Server` header
- [ ] securityheaders.com / Mozilla Observatory grade A or better
- [ ] WebSocket from a foreign Origin is refused; reused/expired/garbage tickets refused
- [ ] Connection caps and rate limits verified under k6 load; memory flat under slow-client test
- [ ] CSP has no `unsafe-inline`/`unsafe-eval`; browser console shows zero CSP violations
- [ ] Trusted Types enforced (or documented reason why not)
- [ ] ZAP baseline scan has no medium+ findings
- [ ] Live adapters: SSRF test suite passes; upstream credentials are read-only; no upstream label reaches clients unmapped
- [ ] Live mode is behind real authentication (OIDC) - **not** the API-key gate
- [ ] Secrets scan of full git history clean; GitHub push protection enabled
- [ ] SBOM + provenance published for the release
- [ ] Docker base images pinned by digest; dependencies hash-pinned

## 8. Residual risks we accept (and why)

- **In-memory limits/tickets are per instance.** Fine for one instance; multi-instance needs Redis (M5).
- **Client IP depends on the reverse proxy** setting `X-Forwarded-For` correctly; behind a CDN,
  configure trusted proxy ranges precisely.
- **Volumetric DDoS** is a provider/CDN concern.
- **A public demo can still be hammered** (cost of ticks/connections). Caps bound the blast radius; they do not eliminate it.
- **Supply chain** can never be reduced to zero. Pinning + audits + minimal deps reduce likelihood and blast radius.
- **WebGL fingerprinting / device info** is inherent to using WebGL; we add no analytics or telemetry.
