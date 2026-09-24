"""Security primitives: headers, single-use tickets, rate limiting, connection caps."""

from __future__ import annotations

import hashlib
import hmac
import secrets
import time
from collections import defaultdict, deque

from pydantic import SecretStr
from starlette.types import ASGIApp, Message, Receive, Scope, Send


class SecurityHeadersMiddleware:
    """Pure-ASGI middleware adding hardening headers to every HTTP response.

    The API returns JSON only, so the CSP is maximally strict. The *frontend's* CSP is set by
    the static host (see deploy/Caddyfile), not here.
    """

    def __init__(self, app: ASGIApp, *, hsts: bool) -> None:
        self.app = app
        headers = {
            b"content-security-policy": b"default-src 'none'; frame-ancestors 'none'",
            b"x-content-type-options": b"nosniff",
            b"referrer-policy": b"no-referrer",
            b"cache-control": b"no-store",
            b"cross-origin-resource-policy": b"same-site",
            b"permissions-policy": b"camera=(), microphone=(), geolocation=(), payment=()",
        }
        if hsts:
            headers[b"strict-transport-security"] = b"max-age=63072000; includeSubDomains"
        self._headers = list(headers.items())

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                existing = {k.lower() for k, _ in message.get("headers", [])}
                message["headers"] = list(message.get("headers", [])) + [
                    (k, v) for k, v in self._headers if k not in existing
                ]
            await send(message)

        await self.app(scope, receive, send_wrapper)


def api_key_valid(candidate: str | None, keys: list[SecretStr]) -> bool:
    """Constant-time API key check (no early exit on first match)."""
    if not candidate:
        return False
    ok = False
    for key in keys:
        ok |= hmac.compare_digest(candidate.encode(), key.get_secret_value().encode())
    return ok


class TicketStore:
    """Single-use, short-lived WebSocket tickets. Only SHA-256 digests are kept in memory.

    In a multi-instance deployment replace with Redis (GETDEL) - see docs/ARCHITECTURE.md.
    """

    def __init__(self, ttl_seconds: int, max_outstanding: int = 10_000) -> None:
        self._ttl = ttl_seconds
        self._max = max_outstanding
        self._items: dict[str, float] = {}

    @staticmethod
    def _digest(ticket: str) -> str:
        return hashlib.sha256(ticket.encode()).hexdigest()

    def _purge(self, now: float) -> None:
        for d in [d for d, exp in self._items.items() if exp <= now]:
            del self._items[d]

    def issue(self) -> str:
        now = time.monotonic()
        self._purge(now)
        if len(self._items) >= self._max:
            raise RuntimeError("ticket store full")
        ticket = secrets.token_urlsafe(32)
        self._items[self._digest(ticket)] = now + self._ttl
        return ticket

    def consume(self, ticket: str) -> bool:
        """Return True exactly once for a valid, unexpired ticket."""
        now = time.monotonic()
        self._purge(now)
        return self._items.pop(self._digest(ticket), None) is not None


class SlidingWindowLimiter:
    """Simple in-memory sliding-window limiter keyed by string (e.g. client IP)."""

    def __init__(self, limit: int, window_seconds: float) -> None:
        self._limit = limit
        self._window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        q = self._hits[key]
        while q and q[0] <= now - self._window:
            q.popleft()
        if len(q) >= self._limit:
            return False
        q.append(now)
        if not q:  # pragma: no cover - defensive
            self._hits.pop(key, None)
        return True


class ConnectionLimiter:
    """Caps concurrent WebSockets globally and per client IP."""

    def __init__(self, per_ip: int, total: int) -> None:
        self._per_ip = per_ip
        self._total = total
        self._by_ip: dict[str, int] = defaultdict(int)
        self._count = 0

    def acquire(self, ip: str) -> bool:
        if self._count >= self._total or self._by_ip[ip] >= self._per_ip:
            return False
        self._by_ip[ip] += 1
        self._count += 1
        return True

    def release(self, ip: str) -> None:
        if self._by_ip.get(ip, 0) > 0:
            self._by_ip[ip] -= 1
            self._count -= 1
            if self._by_ip[ip] == 0:
                del self._by_ip[ip]
