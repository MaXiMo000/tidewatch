"""Live data: poll each watched app's metrics add-on (`GET /tidewatch/metrics`).

See docs/M5-LIVE-PLAN.md s.3. Controls implemented here:
  * Polls only while someone is watching, so free-tier apps are not kept awake around the clock.
  * SSRF: URLs come only from config; every poll resolves the host, refuses non-public addresses
    (loopback, private, link-local/metadata, CGNAT, ...) unless `live_allow_private`, and then
    connects to the address it checked (TLS still verified against the hostname), so DNS
    rebinding between check and connect is not possible.
  * No redirects, no proxies from the environment, connect 3 s / read 5 s, bodies capped at 64 KB
    (raw bytes; compressed responses are refused), strict payload model.
  * The payload never reaches a browser: it is mapped to `schemas.Snapshot` here.
  * Tokens and bodies are never logged; only `source id: outcome`, and only when it changes.
"""

from __future__ import annotations

import asyncio
import ipaddress
import logging
import socket
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from typing import Annotated, Literal, Self
from urllib.parse import urlsplit

import httpx
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    ValidationError,
    model_validator,
)

from .config import LiveSourceConfig, Settings
from .demo import status_for
from .schemas import Edge, Kind, ServiceMetrics, Snapshot

log = logging.getLogger("tidewatch.live")

GATEWAY_ID = "internet"
MAX_BODY_BYTES = 64 * 1024
GRACE_POLLS = 2  # keep the last good numbers for this many failed polls, then go offline
IDLE_CHECK_SECONDS = 1.0
_TIMEOUT = httpx.Timeout(5.0, connect=3.0)
_MAX_RPS = 1_000_000.0

Resolver = Callable[[str, int], Awaitable[list[str]]]


class _Payload(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Totals(_Payload):
    count: Annotated[int, Field(ge=0, le=1_000_000_000)]
    errors: Annotated[int, Field(ge=0, le=1_000_000_000)]
    p95_ms: Annotated[float, Field(ge=0, le=600_000)]

    @model_validator(mode="after")
    def _errors_within_count(self) -> Self:
        if self.errors > self.count:
            raise ValueError("errors > count")
        return self


class Dep(Totals):
    id: Annotated[str, StringConstraints(pattern=r"^[a-z0-9-]{1,16}$")]
    kind: Literal["service", "cache", "database", "queue", "worker"]


class MetricsPayload(_Payload):
    """What an app's add-on serves. Untrusted: validated, mapped, never forwarded."""

    v: Literal[1]
    window_s: Annotated[int, Field(ge=1, le=3600)]
    uptime_s: Annotated[float, Field(ge=0)]
    http: Totals
    deps: Annotated[list[Dep], Field(max_length=8)]

    @model_validator(mode="after")
    def _unique_deps(self) -> Self:
        if len({d.id for d in self.deps}) != len(self.deps):
            raise ValueError("duplicate dependency id")
        return self


class _Failed(Exception):
    def __init__(self, outcome: str) -> None:
        super().__init__(outcome)
        self.outcome = outcome


@dataclass
class _State:
    last: MetricsPayload | None = None
    misses: int = 0
    outcome: str = ""


async def _resolve(host: str, port: int) -> list[str]:
    infos = await asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM)
    return [str(info[4][0]) for info in infos]


def _is_public(ip: str) -> bool:
    addr = ipaddress.ip_address(ip)
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped:
        addr = addr.ipv4_mapped
    return addr.is_global and not addr.is_multicast


def _island(sid: str, kind: Kind, t: Totals | None, window_s: int) -> ServiceMetrics:
    if t is None:
        return ServiceMetrics(id=sid, kind=kind, rps=0, p95_ms=0, error_rate=0, status="offline")
    err = t.errors / t.count if t.count else 0.0
    return ServiceMetrics(
        id=sid,
        kind=kind,
        rps=round(min(t.count / window_s, _MAX_RPS), 2),
        p95_ms=round(t.p95_ms, 1),
        error_rate=round(err, 4),
        status=status_for(t.p95_ms, err),
    )


class LiveSource:
    def __init__(
        self,
        settings: Settings,
        watchers: Callable[[], int],
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        resolve: Resolver = _resolve,
    ) -> None:
        self._sources: list[LiveSourceConfig] = list(settings.live_sources)
        self._tokens = settings.source_tokens
        self._poll_seconds = settings.live_poll_seconds
        self._allow_private = settings.live_allow_private
        self._watchers = watchers
        self._transport = transport
        self._resolve = resolve
        self._state = {s.id: _State() for s in self._sources}

    async def stream(self) -> AsyncIterator[Snapshot]:
        async with httpx.AsyncClient(
            transport=self._transport,
            timeout=_TIMEOUT,
            follow_redirects=False,
            trust_env=False,  # never pick up proxies or netrc credentials from the environment
        ) as client:
            seq = 0
            while True:
                while self._watchers() == 0:
                    await asyncio.sleep(IDLE_CHECK_SECONDS)
                await asyncio.gather(*(self._poll(client, s) for s in self._sources))
                yield self.snapshot(seq)
                seq += 1
                await asyncio.sleep(self._poll_seconds)

    async def _poll(self, client: httpx.AsyncClient, src: LiveSourceConfig) -> None:
        state = self._state[src.id]
        try:
            state.last = await self._fetch(client, src)
            state.misses = 0
            outcome = "ok"
        except _Failed as exc:
            outcome = exc.outcome
        except httpx.TimeoutException:
            outcome = "timeout"
        except (httpx.HTTPError, OSError):
            outcome = "unreachable"
        except ValidationError:
            outcome = "invalid payload"
        except Exception:  # one broken source must never stop the stream for the others
            outcome = "error"
        if outcome != "ok":
            state.misses += 1
        if outcome != state.outcome:
            log.info("live source %s: %s", src.id, outcome)
            state.outcome = outcome

    async def _fetch(self, client: httpx.AsyncClient, src: LiveSourceConfig) -> MetricsPayload:
        parts = urlsplit(src.url)
        host = parts.hostname or ""
        port = parts.port or (443 if parts.scheme == "https" else 80)
        try:
            ips = await self._resolve(host, port)
        except OSError:
            raise _Failed("dns failed") from None
        if not ips:
            raise _Failed("dns failed")
        if not self._allow_private and not all(_is_public(ip) for ip in ips):
            raise _Failed("refused non-public address")
        # Connect to the checked address; Host header and TLS SNI/verification use the name.
        ip = ips[0]
        pinned = f"[{ip}]" if ":" in ip else ip
        url = parts._replace(netloc=f"{pinned}:{port}").geturl()
        headers = {
            "Host": parts.netloc,
            "Authorization": f"Bearer {self._tokens[src.id].get_secret_value()}",
            "Accept": "application/json",
            "Accept-Encoding": "identity",
        }
        async with client.stream(
            "GET", url, headers=headers, extensions={"sni_hostname": host}
        ) as resp:
            if resp.status_code != 200:
                raise _Failed(f"http {resp.status_code}")
            if resp.headers.get("content-encoding", "identity") != "identity":
                raise _Failed("compressed response")
            body = bytearray()
            async for chunk in resp.aiter_raw():
                body += chunk
                if len(body) > MAX_BODY_BYTES:
                    raise _Failed("response too large")
        return MetricsPayload.model_validate_json(bytes(body))

    def snapshot(self, seq: int) -> Snapshot:
        """Map the latest known payloads to the public snapshot (the only thing that leaves)."""
        services: list[ServiceMetrics] = []
        edges: list[Edge] = []
        for src in self._sources:
            state = self._state[src.id]
            known = state.last  # topology survives an outage, so islands do not jump around
            fresh = known if known is not None and state.misses <= GRACE_POLLS else None
            window = known.window_s if known else 1
            app = _island(src.id, "service", fresh.http if fresh else None, window)
            services.append(app)
            edges.append(Edge(src=GATEWAY_ID, dst=src.id, rps=app.rps))
            for dep in known.deps if known else []:
                island = _island(f"{src.id}-{dep.id}", dep.kind, dep if fresh else None, window)
                services.append(island)
                edges.append(Edge(src=src.id, dst=island.id, rps=island.rps))
        total = min(sum(e.rps for e in edges if e.src == GATEWAY_ID), _MAX_RPS)
        gateway = ServiceMetrics(
            id=GATEWAY_ID, kind="gateway", rps=round(total, 2), p95_ms=0, error_rate=0, status="ok"
        )
        return Snapshot(
            seq=seq, ts_ms=int(time.time() * 1000), services=[gateway, *services], edges=edges
        )
