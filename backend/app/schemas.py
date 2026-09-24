"""Wire schemas. Strict allowlists: unknown fields are rejected, values are bounded.

Anything sent to browsers MUST pass through these models. Never forward raw upstream
payloads (Prometheus labels, log lines, URLs, headers) to the client.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

ServiceId = Annotated[str, StringConstraints(pattern=r"^[a-z0-9-]{1,32}$")]
Status = Literal["ok", "degraded", "failing"]
Kind = Literal["gateway", "service", "cache", "database", "queue", "worker"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class ServiceMetrics(_Strict):
    id: ServiceId
    kind: Kind
    rps: Annotated[float, Field(ge=0, le=1_000_000)]
    p95_ms: Annotated[float, Field(ge=0, le=600_000)]
    error_rate: Annotated[float, Field(ge=0, le=1)]
    status: Status


class Edge(_Strict):
    src: ServiceId
    dst: ServiceId
    rps: Annotated[float, Field(ge=0, le=1_000_000)]


class Snapshot(_Strict):
    v: Literal[1] = 1
    type: Literal["snapshot"] = "snapshot"
    seq: Annotated[int, Field(ge=0)]
    ts_ms: Annotated[int, Field(ge=0)]
    services: Annotated[list[ServiceMetrics], Field(max_length=200)]
    edges: Annotated[list[Edge], Field(max_length=1000)]


class AuthMessage(_Strict):
    """First (and only required) client message on the WebSocket."""

    type: Literal["auth"]
    ticket: Annotated[str, StringConstraints(min_length=20, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")]


class TicketResponse(_Strict):
    ticket: str
    expires_in: int
