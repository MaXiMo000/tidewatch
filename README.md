# Tidewatch

**A cinematic, scroll-driven 3D world that shows your infrastructure live.**
Services are islands, requests are ships of light, latency is fog and storms, errors flash red.
FastAPI streams the metrics over a hardened WebSocket; Three.js renders them; it is designed to
stay smooth on low-end devices.

> Status: **M0 complete** (bring-up and baseline). The backend is a working secure skeleton with
> a demo data source, verified in CI and in the production-shaped Docker stack; the frontend is a
> placeholder scene proving the end-to-end data path. Next: M1 (scene foundation + quality tiers). See [`docs/HANDOVER.md`](docs/HANDOVER.md) for exactly
> what is and is not verified.

## Why it exists

Monitoring dashboards are useful and dull. Tidewatch keeps the usefulness (real service health,
latency, error rates, topology) and makes it something people want to look at: a scroll-driven
story that explains a request's journey and an incident, then unlocks into a free-fly live view.

## Quick start (local, demo data, no credentials)

```bash
# backend  (Python 3.11+)
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest
uvicorn app.main:get_app --factory --reload --port 8000

# frontend (Node 22.12+)  - in a second terminal
cd frontend
npm ci --ignore-scripts
npm run dev        # http://localhost:5173  (proxies /api and /ws to :8000)
```

## Repository map

| Path | What |
| --- | --- |
| `backend/` | FastAPI app: config, security primitives, demo source, WebSocket hub, tests |
| `frontend/` | Vite + TypeScript + Three.js client (validated protocol, store, placeholder scene) |
| `deploy/` | Caddy (TLS, CSP, single origin) + hardened docker-compose |
| `docs/PLAN.md` | Vision, storyboard, milestones with acceptance criteria |
| `docs/ARCHITECTURE.md` | Components, WebSocket protocol, scene/scroll design, live adapters |
| `docs/SECURITY.md` | Threat model, controls per layer, launch checklist, residual risks |
| `docs/PERFORMANCE.md` | Budgets, quality tiers, measurement |
| `docs/HANDOVER.md` | **Start here if you are Claude Code / a new contributor** |
| `CLAUDE.md` | Rules and commands for Claude Code |
| `scripts/` | `publish.sh` / `harden-repo.sh` (GitHub repo + security settings), `lock-backend.sh` (hash-pinned lock), `smoke_compose.py` (HTTPS stack smoke test) |

## Security in one paragraph

Defence in depth, not a promise of zero risk: demo mode by default (no real data, no credentials),
strict schemas that allowlist every field sent to browsers, single-use WebSocket tickets with no
credentials in URLs, Origin/Host allowlists, connection and rate limits, bounded per-client queues,
a strict CSP with no inline code or third-party origins, hash-pinned CI actions, secret scanning in
pre-commit and CI, and a documented threat model with the residual risks stated. Read
[`docs/SECURITY.md`](docs/SECURITY.md). Report vulnerabilities privately per [`SECURITY.md`](SECURITY.md).

## License

MIT
