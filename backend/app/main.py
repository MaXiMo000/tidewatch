"""Tidewatch API.

Endpoints
  GET  /healthz              liveness (no data)
  GET  /api/v1/info          mode (demo/live) and the watched apps' display names
  POST /api/v1/ws-ticket     issue a single-use, short-lived WebSocket ticket
  WS   /ws/v1/stream         metrics stream
                             (first client message must be {"type":"auth","ticket":...})

Security notes live in docs/SECURITY.md. Highlights implemented here:
  * Origin allowlist on the WebSocket handshake (blocks cross-site WebSocket hijacking)
  * No credentials in URLs: the ticket travels in the first WS message, not the query string
  * Single-use tickets (30s TTL), API-key gate for live mode (constant-time compare) unless the
    owner explicitly published it with TIDEWATCH_LIVE_PUBLIC (docs/SECURITY.md risk acceptance)
  * Per-IP + global connection caps, per-IP HTTP rate limit, message size/rate limits
  * Bounded per-client queues (slow clients cannot exhaust memory)
  * Strict response headers, TrustedHost, explicit CORS, OpenAPI docs disabled in prod
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.websockets import WebSocketDisconnect

from .config import Settings
from .demo import DemoSource
from .hub import Hub, Source
from .live import LiveSource
from .schemas import AuthMessage, InfoResponse, SourceInfo, TicketResponse
from .security import (
    ConnectionLimiter,
    SecurityHeadersMiddleware,
    SlidingWindowLimiter,
    TicketStore,
    api_key_valid,
)

WS_POLICY_VIOLATION = 1008
WS_MESSAGE_TOO_BIG = 1009
WS_TRY_AGAIN_LATER = 1013


def _build_source(settings: Settings, watchers: Callable[[], int]) -> Source:
    if settings.mode == "demo":
        return DemoSource(tick_hz=settings.tick_hz)
    return LiveSource(settings, watchers)


def _bearer(authorization: str | None) -> str | None:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip() or None
    return None


async def _recv_text(ws: WebSocket) -> str:
    message = await ws.receive()
    if message["type"] == "websocket.disconnect":
        raise WebSocketDisconnect(message.get("code", 1000))
    text = message.get("text")
    if text is None:
        raise ValueError("binary frames are not accepted")
    return str(text)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    hub: Hub = Hub(_build_source(settings, lambda: hub.watchers()))
    tickets = TicketStore(settings.ticket_ttl_seconds)
    ticket_limiter = SlidingWindowLimiter(settings.ticket_rate_per_minute, 60.0)
    conn_limiter = ConnectionLimiter(settings.ws_max_per_ip, settings.ws_max_total)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        task = asyncio.create_task(hub.run(), name="hub")
        try:
            yield
        finally:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    prod = settings.env == "prod"
    app = FastAPI(
        title="Tidewatch",
        version="0.1.0",
        lifespan=lifespan,
        docs_url=None if prod else "/docs",
        redoc_url=None,
        openapi_url=None if prod else "/openapi.json",
    )

    # Order matters: last added = outermost.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type"],
        allow_credentials=False,
        max_age=600,
    )
    app.add_middleware(SecurityHeadersMiddleware, hsts=prod)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts)

    @app.get("/healthz")
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    info = InfoResponse(
        mode=settings.mode,
        sources=[SourceInfo(id=s.id, name=s.name) for s in settings.live_sources]
        if settings.mode == "live"
        else [],
    )

    @app.get("/api/v1/info", response_model=InfoResponse)
    async def get_info() -> InfoResponse:
        return info

    @app.post("/api/v1/ws-ticket", response_model=TicketResponse)
    async def ws_ticket(
        request: Request, authorization: str | None = Header(default=None)
    ) -> TicketResponse:
        ip = request.client.host if request.client else "unknown"
        if not ticket_limiter.allow(ip):
            raise HTTPException(429, "rate limit exceeded", headers={"Retry-After": "60"})
        gated = settings.mode == "live" and not settings.live_public
        if gated and not api_key_valid(_bearer(authorization), settings.api_keys):
            raise HTTPException(401, "unauthorized", headers={"WWW-Authenticate": "Bearer"})
        try:
            ticket = tickets.issue()
        except RuntimeError:
            raise HTTPException(503, "temporarily unavailable") from None
        return TicketResponse(ticket=ticket, expires_in=settings.ticket_ttl_seconds)

    @app.websocket("/ws/v1/stream")
    async def stream(ws: WebSocket) -> None:
        # 1) Origin allowlist BEFORE accepting (CSWSH defence). Missing Origin is rejected too.
        if ws.headers.get("origin") not in settings.allowed_origins:
            await ws.close(code=WS_POLICY_VIOLATION)
            return

        # 2) Capacity caps.
        ip = ws.client.host if ws.client else "unknown"
        if not conn_limiter.acquire(ip):
            await ws.close(code=WS_TRY_AGAIN_LATER)
            return

        try:
            await ws.accept()

            # 3) Authenticate via first message (keeps credentials out of URLs and logs).
            try:
                raw = await asyncio.wait_for(_recv_text(ws), settings.ws_auth_timeout_seconds)
            except (TimeoutError, WebSocketDisconnect, ValueError):
                await _safe_close(ws, WS_POLICY_VIOLATION)
                return
            if len(raw.encode()) > settings.ws_max_message_bytes:
                await _safe_close(ws, WS_MESSAGE_TOO_BIG)
                return
            try:
                auth = AuthMessage.model_validate_json(raw)
            except ValidationError:
                await _safe_close(ws, WS_POLICY_VIOLATION)
                return
            if not tickets.consume(auth.ticket):
                await _safe_close(ws, WS_POLICY_VIOLATION)
                return

            # 4) Stream. Reader enforces size/rate limits on anything the client sends.
            queue = hub.subscribe()
            sender = asyncio.create_task(_send_loop(ws, queue))
            receiver = asyncio.create_task(_recv_loop(ws, settings))
            try:
                _, pending = await asyncio.wait(
                    {sender, receiver}, return_when=asyncio.FIRST_COMPLETED
                )
                for task in pending:
                    task.cancel()
                await asyncio.gather(*pending, return_exceptions=True)
            finally:
                hub.unsubscribe(queue)
                await _safe_close(ws, 1000)
        finally:
            conn_limiter.release(ip)

    return app


async def _send_loop(ws: WebSocket, queue: asyncio.Queue[str]) -> None:
    try:
        while True:
            await ws.send_text(await queue.get())
    except (WebSocketDisconnect, RuntimeError):
        return


async def _recv_loop(ws: WebSocket, settings: Settings) -> None:
    limiter = SlidingWindowLimiter(settings.ws_client_msgs_per_10s, 10.0)
    try:
        while True:
            raw = await _recv_text(ws)
            if len(raw.encode()) > settings.ws_max_message_bytes:
                await _safe_close(ws, WS_MESSAGE_TOO_BIG)
                return
            if not limiter.allow("c"):
                await _safe_close(ws, WS_POLICY_VIOLATION)
                return
            # Client messages are currently ignored (keep-alive only).
    except (WebSocketDisconnect, RuntimeError, ValueError):
        return


async def _safe_close(ws: WebSocket, code: int) -> None:
    with contextlib.suppress(RuntimeError, WebSocketDisconnect):
        await ws.close(code=code)


def get_app() -> FastAPI:  # pragma: no cover - uvicorn factory entrypoint
    # uvicorn configures only its own loggers; this makes app logs (live source outcomes) visible.
    logging.basicConfig(level=logging.INFO, format="%(levelname)s:     %(name)s %(message)s")
    return create_app()
