"""Fan-out hub: ONE producer, many bounded subscriber queues.

Slow clients can never cause unbounded memory growth: each queue holds at most 2 frames and
the oldest frame is dropped (latest-wins is exactly right for live metrics).
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from typing import Protocol

from .schemas import Snapshot


class Source(Protocol):
    def stream(self) -> AsyncIterator[Snapshot]: ...


class Hub:
    def __init__(self, source: Source) -> None:
        self._source = source
        self._subs: set[asyncio.Queue[str]] = set()
        self._latest: str | None = None

    def subscribe(self) -> asyncio.Queue[str]:
        q: asyncio.Queue[str] = asyncio.Queue(maxsize=2)
        if self._latest is not None:
            q.put_nowait(self._latest)
        self._subs.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[str]) -> None:
        self._subs.discard(q)

    async def run(self) -> None:
        async for snap in self._source.stream():
            payload = snap.model_dump_json()
            self._latest = payload
            for q in tuple(self._subs):
                if q.full():
                    q.get_nowait()
                q.put_nowait(payload)
