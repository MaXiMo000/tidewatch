"""Typed, validated configuration. Secrets come ONLY from environment variables.

Never hard-code secrets, never commit a real `.env`. See docs/SECURITY.md.
"""

from __future__ import annotations

import re
from typing import Literal, Self
from urllib.parse import urlsplit

from pydantic import SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

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
        if self.mode == "live" and not self.api_keys:
            raise ValueError("live mode requires at least one TIDEWATCH_API_KEYS entry")
        if self.env == "prod":
            if any(o.startswith("http://") for o in self.allowed_origins):
                raise ValueError("prod requires https origins only")
            if any(k.get_secret_value() and len(k.get_secret_value()) < 32 for k in self.api_keys):
                raise ValueError("prod API keys must be >= 32 chars")
        if not 0.1 <= self.tick_hz <= 20:
            raise ValueError("tick_hz must be within 0.1..20")
        return self
