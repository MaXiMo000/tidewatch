# M5 local end-to-end run (2026-09-24)

Real data, local processes only (no deployed app was contacted):

- **AniNest** backend (`MaXiMo000/AniNest` master, add-on d851dc3) on `127.0.0.1:8787`, local
  libSQL file, `TIDEWATCH_METRICS_TOKEN` set; a shell loop sent ~10 req/s (health, reviews,
  leaderboard, anime search - the last one reaches the anime APIs, so the `anime-api` island appears).
- **LabLedger** and **Quiz-App** pointed at closed local ports: expected to show **offline**.
- **Tidewatch** backend: `TIDEWATCH_MODE=live TIDEWATCH_LIVE_PUBLIC=true
  TIDEWATCH_LIVE_ALLOW_PRIVATE=true TIDEWATCH_LIVE_POLL_SECONDS=5`, Vite dev server, headless
  Chromium (SwiftShader) at 1440x900 / 1280x800.

| File | Shows |
| --- | --- |
| `live-balanced.png` | Balanced tier: AniNest + AniNest DB + AniNest Anime API lit, LabLedger and Quiz-App dark with grey dots; summary `4 ok · 0 degraded · 0 failing · 2 offline`; caption `Live · AniNest, LabLedger, Quiz-App` |
| `live-aninest-card.png` | Inspector on AniNest (Tab, Enter): `11 req/s · p95 8 ms · 0.00% errors` - real numbers from the add-on |
| `live-cinematic.png` | Cinematic tier, same state: AniNest windows lit, LabLedger dark |

Tidewatch's log for the run had one line per outcome change (`live source aninest: ok`,
`labledger: unreachable`, `quiz: unreachable`) and no token or body content.

Not verified here: fps (software GL), a real Render deployment, any phone.
