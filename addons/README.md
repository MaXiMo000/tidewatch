# Metrics add-ons (served by the watched apps)

Tidewatch's live mode polls each watched app's `GET /tidewatch/metrics`. These two files are the
source of truth for the add-on that serves it; each app carries a **vendored copy** (no package,
no new dependencies). Change the contract here first, then re-vendor.

| File | For | Vendored in |
| --- | --- | --- |
| `tidewatch-metrics.js` | Express (ESM, Node >= 18) | AniNest `backend/src/lib/tidewatch-metrics.js`, Quiz-App `backend/utils/tidewatchMetrics.js` (double quotes for its lint) |
| `tidewatch_metrics.py` | Any ASGI app (FastAPI/Starlette); pymongo for the listener | LabLedger `backend/app/tidewatch_metrics.py` |

## Contract (v1)

`GET /tidewatch/metrics` with `Authorization: Bearer <TIDEWATCH_METRICS_TOKEN>`:

```json
{ "v": 1, "window_s": 60, "uptime_s": 1234,
  "http": { "count": 812, "errors": 3, "p95_ms": 84.1 },
  "deps": [ { "id": "db", "kind": "database", "count": 2410, "errors": 0, "p95_ms": 11.2 } ] }
```

- Env var unset: nothing is installed and the route does not exist (404).
- Wrong or missing token: 401 with `WWW-Authenticate: Bearer`. Token compared in constant time
  (SHA-256 digests, `timingSafeEqual` / `hmac.compare_digest`).
- `Cache-Control: no-store` on every answer. Polls of the route are not counted as traffic.
- `errors` = 5xx responses (or a thrown / failed dependency call). 4xx are the client's fault.
- Rolling 60 s window of 1 s buckets; p95 = upper edge of a 32-bucket log histogram (1 ms..60 s),
  so it is accurate to one bucket (~1.43x). Constant memory.
- Dependency ids `[a-z0-9-]{1,16}`, kinds `service|cache|database|queue|worker`, at most 8;
  anything else is dropped silently. Ids are fixed strings chosen in code.
- **Never recorded**: URLs, routes, query strings, bodies, headers, keys, prompts, user ids.
  Only a duration and ok / not ok per request or dependency call.

Tidewatch treats everything it receives as untrusted (`backend/app/live.py` validates it with a
strict model, caps it at 64 KB and maps it to `schemas.Snapshot`; nothing is forwarded as-is).

## Wiring

Node (Express):
```js
import { tidewatchMetrics, track, watchMongo } from './tidewatch-metrics.js';
const on = tidewatchMetrics(app);          // before CORS, sessions, logging, rate limiters
await mongoose.connect(uri, on ? { monitorCommands: true } : {});
if (on) watchMongo(mongoose.connection.getClient());
const rows = await track('db', 'database', () => client.execute(sql));  // any async call
```

Python (ASGI):
```python
from app.tidewatch_metrics import MongoListener, TidewatchMetrics, track
AsyncIOMotorClient(uri, event_listeners=[MongoListener()] if token else [])
if token:
    app.add_middleware(TidewatchMetrics, token=token)   # add LAST = outermost
async with track("ai", "service") as call:
    r = await client.post(...)
    if r.status_code >= 500:
        call.fail()
```

Tests live with each app (AniNest: `node --test`, Quiz-App: jest, LabLedger: pytest): window
math, p95, auth (401 / 404 when unset), dependency limits, and that nothing identifying appears
in the output.
