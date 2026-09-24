from __future__ import annotations

import json
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError
from starlette.websockets import WebSocketDisconnect

from app.config import Settings
from app.main import create_app
from app.schemas import ServiceMetrics, Snapshot

ORIGIN = "http://localhost:5173"
WS_URL = "/ws/v1/stream"


def make_settings(**overrides: object) -> Settings:
    base: dict[str, object] = {
        "allowed_hosts": ["testserver"],
        "allowed_origins": [ORIGIN],
        "tick_hz": 20,
        "ws_auth_timeout_seconds": 0.3,
    }
    base.update(overrides)
    return Settings(_env_file=None, **base)  # type: ignore[arg-type]


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(create_app(make_settings())) as c:
        yield c


def get_ticket(c: TestClient) -> str:
    r = c.post("/api/v1/ws-ticket")
    assert r.status_code == 200, r.text
    return str(r.json()["ticket"])


def test_security_headers_present(client: TestClient) -> None:
    r = client.get("/healthz")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["referrer-policy"] == "no-referrer"
    assert "frame-ancestors 'none'" in r.headers["content-security-policy"]
    assert r.headers["cache-control"] == "no-store"


def test_untrusted_host_rejected() -> None:
    with TestClient(create_app(make_settings()), base_url="http://evil.example") as c:
        assert c.get("/healthz").status_code == 400


def test_happy_path_streams_valid_snapshots(client: TestClient) -> None:
    ticket = get_ticket(client)
    with client.websocket_connect(WS_URL, headers={"origin": ORIGIN}) as ws:
        ws.send_text(json.dumps({"type": "auth", "ticket": ticket}))
        snap = Snapshot.model_validate_json(ws.receive_text())
        assert snap.v == 1 and len(snap.services) >= 5


def test_ticket_is_single_use(client: TestClient) -> None:
    ticket = get_ticket(client)
    with client.websocket_connect(WS_URL, headers={"origin": ORIGIN}) as ws:
        ws.send_text(json.dumps({"type": "auth", "ticket": ticket}))
        ws.receive_text()
    with client.websocket_connect(WS_URL, headers={"origin": ORIGIN}) as ws2:
        ws2.send_text(json.dumps({"type": "auth", "ticket": ticket}))
        with pytest.raises(WebSocketDisconnect) as exc:
            ws2.receive_text()
        assert exc.value.code == 1008


def test_bad_origin_rejected(client: TestClient) -> None:
    with pytest.raises(WebSocketDisconnect), client.websocket_connect(
        WS_URL, headers={"origin": "https://evil.example"}
    ):
        pass


def test_missing_origin_rejected(client: TestClient) -> None:
    with pytest.raises(WebSocketDisconnect), client.websocket_connect(WS_URL):
        pass


def test_no_auth_message_times_out(client: TestClient) -> None:
    with client.websocket_connect(WS_URL, headers={"origin": ORIGIN}) as ws:
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_text()
        assert exc.value.code == 1008


def test_garbage_and_oversized_auth_rejected(client: TestClient) -> None:
    with client.websocket_connect(WS_URL, headers={"origin": ORIGIN}) as ws:
        ws.send_text("not json")
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_text()
        assert exc.value.code == 1008
    with client.websocket_connect(WS_URL, headers={"origin": ORIGIN}) as ws:
        ws.send_text("x" * 5000)
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_text()
        assert exc.value.code == 1009


def test_ticket_rate_limited() -> None:
    with TestClient(create_app(make_settings(ticket_rate_per_minute=3))) as c:
        codes = [c.post("/api/v1/ws-ticket").status_code for _ in range(5)]
        assert codes == [200, 200, 200, 429, 429]


def test_per_ip_connection_cap() -> None:
    with TestClient(create_app(make_settings(ws_max_per_ip=1, ticket_rate_per_minute=100))) as c:
        t1 = get_ticket(c)
        with c.websocket_connect(WS_URL, headers={"origin": ORIGIN}) as ws1:
            ws1.send_text(json.dumps({"type": "auth", "ticket": t1}))
            ws1.receive_text()
            with pytest.raises(WebSocketDisconnect) as exc, c.websocket_connect(
                WS_URL, headers={"origin": ORIGIN}
            ) as ws2:
                ws2.receive_text()
            assert exc.value.code == 1013


def test_config_rejects_wildcards_and_weak_prod() -> None:
    with pytest.raises(ValidationError):
        make_settings(allowed_origins=["*"])
    with pytest.raises(ValidationError):
        make_settings(allowed_hosts=["*"])
    with pytest.raises(ValidationError):
        make_settings(env="prod")  # http origin in prod
    with pytest.raises(ValidationError):
        make_settings(mode="live")  # live without keys (or live_public) and sources
    with pytest.raises(ValidationError):
        make_settings(
            env="prod",
            allowed_origins=["https://ok.example"],
            mode="live",
            api_keys=[SecretStr("short")],
        )


@pytest.mark.parametrize(
    "origin",
    [
        "*",
        "https://*.example.com",
        "https://ok.example/",
        "https://ok.example/path",
        "https://user@ok.example",
        "https://OK.example",
        "ftp://ok.example",
        "ok.example",
        "https://ok.example:99999",
        "null",
    ],
)
def test_config_rejects_non_exact_origins(origin: str) -> None:
    with pytest.raises(ValidationError):
        make_settings(allowed_origins=[origin])


@pytest.mark.parametrize(
    "host", ["*", "*.example.com", "ok.example:443", "ok.example/x", "", "-bad.example"]
)
def test_config_rejects_non_exact_hosts(host: str) -> None:
    with pytest.raises(ValidationError):
        make_settings(allowed_hosts=[host])


def test_config_accepts_exact_origins_and_hosts() -> None:
    s = make_settings(
        allowed_origins=["https://ok.example", "http://localhost:5173", "http://127.0.0.1:5174"],
        allowed_hosts=["ok.example", "localhost", "127.0.0.1"],
    )
    assert len(s.allowed_origins) == 3


def test_schema_rejects_unknown_and_out_of_range_fields() -> None:
    good = {
        "id": "api", "kind": "service", "rps": 1, "p95_ms": 1, "error_rate": 0.1, "status": "ok"
    }
    ServiceMetrics.model_validate(good)
    with pytest.raises(ValidationError):
        ServiceMetrics.model_validate({**good, "secret_label": "leak"})
    with pytest.raises(ValidationError):
        ServiceMetrics.model_validate({**good, "id": "API/../etc"})
    with pytest.raises(ValidationError):
        ServiceMetrics.model_validate({**good, "error_rate": 2})


def test_prod_disables_docs() -> None:
    s = make_settings(env="prod", allowed_origins=["https://ok.example"])
    with TestClient(create_app(s)) as c:
        assert c.get("/docs").status_code == 404
        assert c.get("/openapi.json").status_code == 404
        assert "strict-transport-security" in c.get("/healthz").headers
