"""Typed, validated configuration. Secrets come ONLY from environment variables.

Never hard-code secrets, never commit a real `.env`. See docs/SECURITY.md.
"""

from __future__ import annotations

import re
from typing import Annotated, Literal, Self
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, SecretStr, StringConstraints, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from .schemas import SourceName

# A bare hostname or IPv4 literal: letters, digits, dots, hyphens. No "*", ports or paths.
_HOST_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$")


def _is_exact_origin(origin: str) -> bool:
    """True for `scheme://host[:port]` exactly as a browser sends it in the Origin header."""
    try:
        parts = urlsplit(origin)
        port = parts.port  # raises ValueError on a malformed port
    except ValueError:
        return False
    host = parts.hostname or ""
    rebuilt = f"{parts.scheme}://{host}" + (f":{port}" if port is not None else "")
    return (
        parts.scheme in ("http", "https")
        and bool(_HOST_RE.match(host))
        and origin == rebuilt  # no path, query, fragment, userinfo, trailing slash or uppercase
    )


def _metrics_url_problem(url: str, *, https_only: bool) -> str | None:
    """Why a live-source URL is unacceptable, or None. Config-only URLs, no credentials in them."""
    try:
        parts = urlsplit(url)
        _ = parts.port  # raises ValueError on a malformed port
    except ValueError:
        return "malformed"
    if parts.scheme != "https" and (https_only or parts.scheme != "http"):
        return "scheme must be https" if https_only else "scheme must be http(s)"
    if parts.username is not None or parts.password is not None:
        return "must not contain credentials"
    if parts.query or parts.fragment or "?" in url or "#" in url:
        return "must not contain a query or fragment"
    if not _HOST_RE.match(parts.hostname or ""):
        return "host must be an exact hostname"
    return None


class LiveSourceConfig(BaseModel):
    """One watched app. `id` becomes its island id; dependency islands are `<id>-<dep>`."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: Annotated[str, StringConstraints(pattern=r"^[a-z0-9]{1,15}$")]
    name: SourceName
    url: str  # full URL of the app's GET /tidewatch/metrics endpoint


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="TIDEWATCH_", env_file=".env", extra="ignore", frozen=True
    )

    env: Literal["dev", "prod"] = "dev"
    # demo = synthetic data only. live = real adapters (backend-side credentials only).
    mode: Literal["demo", "live"] = "demo"

    # Exact origins allowed to open a WebSocket / call the API cross-origin.
    # Env format is JSON: TIDEWATCH_ALLOWED_ORIGINS='["https://tidewatch.example.com"]'
    allowed_origins: list[str] = ["http://localhost:5173"]
    # Host header allowlist (blocks Host-header attacks / DNS rebinding).
    allowed_hosts: list[str] = ["localhost", "127.0.0.1"]

    # Live mode: API keys that may request WebSocket tickets. Env is JSON list of strings.
    api_keys: list[SecretStr] = []

    # WebSocket ticket + limits
    ticket_ttl_seconds: int = 30
    ws_auth_timeout_seconds: float = 5.0
    ws_max_message_bytes: int = 512
    ws_max_per_ip: int = 5
    ws_max_total: int = 200
    ws_client_msgs_per_10s: int = 20

    # HTTP rate limit for POST /api/v1/ws-ticket (per IP)
    ticket_rate_per_minute: int = 10

    tick_hz: float = 1.0

    # Live mode (docs/M5-LIVE-PLAN.md). Env is JSON:
    #   TIDEWATCH_LIVE_SOURCES='[{"id":"aninest","name":"AniNest","url":"https://.../tidewatch/metrics"}]'
    #   TIDEWATCH_SOURCE_TOKENS='{"aninest":"<token>"}'  (one per source; never logged)
    live_sources: list[LiveSourceConfig] = []
    source_tokens: dict[str, SecretStr] = {}
    # Serve live data to anyone, without API keys (owner risk acceptance, docs/SECURITY.md).
    live_public: bool = False
    live_poll_seconds: float = 10.0
    # Dev only: allow polling loopback/private addresses (e.g. an app on localhost).
    live_allow_private: bool = False

    @model_validator(mode="after")
    def _validate(self) -> Self:
        # Exact values only: Starlette treats "*" and "*.example.com" as wildcards, and an origin
        # with a path or trailing slash never matches a browser's Origin header.
        for origin in self.allowed_origins:
            if not _is_exact_origin(origin):
                raise ValueError(
                    f"allowed_origins must be exact scheme://host[:port] origins, got {origin!r}"
                )
        for host in self.allowed_hosts:
            if not _HOST_RE.match(host):
                raise ValueError(f"allowed_hosts must be exact hostnames, got {host!r}")
        if self.mode == "live":
            self._validate_live()
        if self.env == "prod":
            if any(o.startswith("http://") for o in self.allowed_origins):
                raise ValueError("prod requires https origins only")
            if any(k.get_secret_value() and len(k.get_secret_value()) < 32 for k in self.api_keys):
                raise ValueError("prod API keys must be >= 32 chars")
        if not 0.1 <= self.tick_hz <= 20:
            raise ValueError("tick_hz must be within 0.1..20")
        return self

    def _validate_live(self) -> None:
        if not self.api_keys and not self.live_public:
            raise ValueError(
                "live mode requires TIDEWATCH_API_KEYS, or TIDEWATCH_LIVE_PUBLIC=true to publish"
            )
        if not 1 <= len(self.live_sources) <= 8:
            raise ValueError("live mode requires 1..8 TIDEWATCH_LIVE_SOURCES")
        ids = [s.id for s in self.live_sources]
        if len(set(ids)) != len(ids) or "internet" in ids:
            raise ValueError("live source ids must be unique and not 'internet'")
        if set(self.source_tokens) != set(ids):
            raise ValueError("TIDEWATCH_SOURCE_TOKENS must have exactly one token per source id")
        if any(len(t.get_secret_value()) < 16 for t in self.source_tokens.values()):
            raise ValueError("source tokens must be >= 16 chars")
        for src in self.live_sources:
            problem = _metrics_url_problem(src.url, https_only=self.env == "prod")
            if problem:
                raise ValueError(f"live source {src.id!r} url {problem}")
        if not 5 <= self.live_poll_seconds <= 120:
            raise ValueError("live_poll_seconds must be within 5..120")
        if self.env == "prod" and self.live_allow_private:
            raise ValueError("live_allow_private is for local development only")
