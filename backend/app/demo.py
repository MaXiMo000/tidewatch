"""Synthetic data source: a believable service graph with a scripted incident cycle.

Demo mode is the default so the project runs (and can be shown publicly) with zero
credentials and zero access to real systems.
"""

from __future__ import annotations

import asyncio
import math
import random
import time
from collections.abc import AsyncIterator

from .schemas import Edge, ServiceMetrics, Snapshot, Status

# (id, kind, base_rps, base_p95_ms)
_SERVICES = [
    ("gateway", "gateway", 420.0, 18.0),
    ("auth", "service", 260.0, 25.0),
    ("api", "service", 380.0, 60.0),
    ("cache", "cache", 900.0, 2.0),
    ("db", "database", 220.0, 14.0),
    ("queue", "queue", 120.0, 6.0),
    ("worker", "worker", 110.0, 90.0),
]
_EDGES = [
    ("gateway", "auth", 0.6),
    ("gateway", "api", 0.9),
    ("api", "cache", 2.0),
    ("api", "db", 0.5),
    ("api", "queue", 0.3),
    ("queue", "worker", 1.0),
    ("worker", "db", 0.4),
]
_INCIDENT_PERIOD_S = 90.0  # every 90s the db degrades, then recovers


def _status(p95: float, err: float) -> Status:
    if err > 0.05 or p95 > 1500:
        return "failing"
    if err > 0.01 or p95 > 400:
        return "degraded"
    return "ok"


class DemoSource:
    def __init__(self, tick_hz: float, seed: int | None = None) -> None:
        self._period = 1.0 / tick_hz
        # Non-cryptographic PRNG is fine: synthetic visuals only.
        self._rng = random.Random(seed)  # noqa: S311  # nosec B311

    def _incident_level(self, t: float) -> float:
        """0..1 severity: ramps up over 15s, holds 10s, decays 15s, in each period."""
        phase = t % _INCIDENT_PERIOD_S
        if phase < 50:
            return 0.0
        x = phase - 50
        if x < 15:
            return x / 15
        if x < 25:
            return 1.0
        return max(0.0, 1 - (x - 25) / 15)

    def _snapshot(self, seq: int, t: float) -> Snapshot:
        wave = 1 + 0.15 * math.sin(t / 7)
        inc = self._incident_level(t)
        services: list[ServiceMetrics] = []
        rps_by_id: dict[str, float] = {}
        for sid, kind, rps, p95 in _SERVICES:
            jitter = self._rng.uniform(0.92, 1.08)
            cur_rps = rps * wave * jitter
            cur_p95 = p95 * self._rng.uniform(0.9, 1.15)
            err = self._rng.uniform(0.0, 0.004)
            if sid == "db":
                cur_p95 += inc * 1800
                err += inc * 0.02
            elif sid in ("api", "worker"):
                cur_p95 += inc * 700
                err += inc * 0.06
            rps_by_id[sid] = cur_rps
            services.append(
                ServiceMetrics(
                    id=sid,
                    kind=kind,  # type: ignore[arg-type]
                    rps=round(cur_rps, 1),
                    p95_ms=round(cur_p95, 1),
                    error_rate=round(min(err, 1.0), 4),
                    status=_status(cur_p95, err),
                )
            )
        edges = [Edge(src=s, dst=d, rps=round(rps_by_id[s] * f, 1)) for s, d, f in _EDGES]
        return Snapshot(seq=seq, ts_ms=int(time.time() * 1000), services=services, edges=edges)

    async def stream(self) -> AsyncIterator[Snapshot]:
        start = time.monotonic()
        seq = 0
        while True:
            yield self._snapshot(seq, time.monotonic() - start)
            seq += 1
            await asyncio.sleep(self._period)
