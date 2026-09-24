"""LiveSource: polling, mapping, failure modes and SSRF controls. No network (MockTransport)."""

from __future__ import annotations

import asyncio
import gzip
import json
import logging
from collections.abc import Callable

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError

from app.config import Settings
from app.live import GRACE_POLLS, MAX_BODY_BYTES, LiveSource
from app.main import create_app
from app.schemas import InfoResponse, Snapshot

TOKEN = "t0ken-for-tests-only-0123456789"  # not a real secret
ORIGIN = "http://localhost:5173"
PAYLOAD = {
    "v": 1,
    "window_s": 60,
    "uptime_s": 1234,
    "http": {"count": 600, "errors": 3, "p95_ms": 84.1},
    "deps": [{"id": "db", "kind": "database", "count": 1200, "errors": 0, "p95_ms": 11.2}],
}

Handler = Callable[[httpx.Request], httpx.Response]


def live_settings(**overrides: object) -> Settings:
    base: dict[str, object] = {
        "allowed_hosts": ["testserver"],
        "allowed_origins": [ORIGIN],
        "mode": "live",
        "live_public": True,
        "live_sources": [
            {"id": "shop", "name": "Shop", "url": "https://shop.example/tidewatch/metrics"},
            {"id": "blog", "name": "Blog-App", "url": "https://blog.example/tidewatch/metrics"},
        ],
        "source_tokens": {"shop": TOKEN, "blog": TOKEN + "b"},
    }
    base.update(overrides)
    return Settings(_env_file=None, **base)  # type: ignore[arg-type]


async def public_dns(host: str, port: int) -> list[str]:
    return ["93.184.215.14"]


def source(handler: Handler, *, dns: object = public_dns, **overrides: object) -> LiveSource:
    return LiveSource(
        live_settings(**overrides),
        lambda: 1,
        transport=httpx.MockTransport(handler),
        resolve=dns,  # type: ignore[arg-type]
    )


def poll(src: LiveSource, times: int = 1) -> Snapshot:
    async def run() -> Snapshot:
        async with httpx.AsyncClient(transport=src._transport, follow_redirects=False) as client:
            for _ in range(times):
                await asyncio.gather(*(src._poll(client, s) for s in src._sources))
        return src.snapshot(0)

    return asyncio.run(run())


def by_id(snap: Snapshot) -> dict[str, tuple[str, float, float, str]]:
    return {s.id: (s.kind, s.rps, s.error_rate, s.status) for s in snap.services}


def reply(
    status: int = 200, body: object = PAYLOAD, headers: dict[str, str] | None = None
) -> httpx.Response:
    """A streamed (not pre-read) response, like a real transport returns."""
    raw = body if isinstance(body, bytes) else json.dumps(body).encode()
    return httpx.Response(status, headers=headers, stream=httpx.ByteStream(raw))


def ok_handler(request: httpx.Request) -> httpx.Response:
    return reply()


def test_happy_path_maps_to_snapshot() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return ok_handler(request)

    snap = poll(source(handler))
    Snapshot.model_validate_json(snap.model_dump_json())  # what the hub sends
    services = by_id(snap)
    assert services["shop"] == ("service", 10.0, 0.005, "ok")
    assert services["shop-db"] == ("database", 20.0, 0.0, "ok")
    assert services["internet"][0] == "gateway" and services["internet"][1] == 20.0
    assert {(e.src, e.dst) for e in snap.edges} == {
        ("internet", "shop"), ("internet", "blog"), ("shop", "shop-db"), ("blog", "blog-db")
    }
    # Pinned to the checked address; Host and bearer token for the right app; no compression.
    req = next(r for r in seen if r.headers["host"] == "shop.example")
    assert req.url.host == "93.184.215.14" and req.url.path == "/tidewatch/metrics"
    assert req.headers["authorization"] == f"Bearer {TOKEN}"
    assert req.headers["accept-encoding"] == "identity"
    assert req.extensions["sni_hostname"] == "shop.example"


def test_thresholds_follow_demo_rules() -> None:
    bad = {**PAYLOAD, "http": {"count": 100, "errors": 10, "p95_ms": 50}}
    slow = {**PAYLOAD, "http": {"count": 100, "errors": 0, "p95_ms": 500}}

    def handler(request: httpx.Request) -> httpx.Response:
        return reply(body=bad if request.headers["host"] == "shop.example" else slow)

    services = by_id(poll(source(handler)))
    assert services["shop"][3] == "failing"
    assert services["blog"][3] == "degraded"


DEP = PAYLOAD["deps"][0]  # type: ignore[index]


@pytest.mark.parametrize(
    ("status", "body", "headers"),
    [
        (401, b"", None),
        (404, b"", None),
        (500, b"", None),
        (302, b"", {"location": "http://169.254.169.254/"}),
        (200, b"not json", None),
        (200, {**PAYLOAD, "secret_label": "leak"}, None),
        (200, {**PAYLOAD, "http": {"count": 1, "errors": 2, "p95_ms": 1}}, None),
        (200, {**PAYLOAD, "deps": [DEP, DEP]}, None),
        (200, {**PAYLOAD, "deps": [{**DEP, "id": "x" * 17}]}, None),
        (200, {**PAYLOAD, "deps": [{**DEP, "id": f"d{i}"} for i in range(9)]}, None),
        (200, b" " * (MAX_BODY_BYTES + 1), None),
        (200, gzip.compress(json.dumps(PAYLOAD).encode()), {"content-encoding": "gzip"}),
    ],
    ids=[
        "401", "404", "500", "redirect", "not-json", "extra-field", "errors>count", "dup-dep",
        "long-dep-id", "too-many-deps", "too-large", "gzip",
    ],
)
def test_bad_responses_make_the_app_offline(
    status: int, body: object, headers: dict[str, str] | None
) -> None:
    services = by_id(poll(source(lambda r: reply(status, body, headers))))
    assert services["shop"] == ("service", 0.0, 0.0, "offline")
    assert "shop-db" not in services  # nothing ever came through, so no dependency islands


def test_timeout_and_connection_errors_are_offline() -> None:
    def timeout(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("slow", request=request)

    def refused(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    async def no_dns(host: str, port: int) -> list[str]:
        raise OSError("nxdomain")

    assert by_id(poll(source(timeout)))["shop"][3] == "offline"
    assert by_id(poll(source(refused)))["shop"][3] == "offline"
    assert by_id(poll(source(ok_handler, dns=no_dns)))["shop"][3] == "offline"


def test_last_good_numbers_survive_brief_outages_then_offline() -> None:
    up = True

    def handler(request: httpx.Request) -> httpx.Response:
        return reply() if up else reply(503, b"")

    src = source(handler)
    assert by_id(poll(src))["shop"][3] == "ok"
    up = False
    assert by_id(poll(src, GRACE_POLLS))["shop"][3] == "ok"
    services = by_id(poll(src))
    assert services["shop"][3] == "offline"
    assert services["shop-db"] == ("database", 0.0, 0.0, "offline")  # topology kept, dark
    up = True
    assert by_id(poll(src))["shop"][3] == "ok"


@pytest.mark.parametrize(
    "ip",
    [
        "127.0.0.1", "10.0.0.5", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1",
        "0.0.0.0", "::1",  # noqa: S104 "fe80::1", "fc00::1", "::ffff:127.0.0.1", "224.0.0.1",
    ],
)
def test_non_public_addresses_are_refused(ip: str) -> None:
    calls: list[httpx.Request] = []

    async def dns(host: str, port: int) -> list[str]:
        return ["93.184.215.14", ip]  # one bad record is enough to refuse

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return ok_handler(request)

    assert by_id(poll(source(handler, dns=dns)))["shop"][3] == "offline"
    assert calls == []


def test_private_addresses_allowed_only_when_configured() -> None:
    async def local(host: str, port: int) -> list[str]:
        return ["127.0.0.1"]

    snap = poll(
        source(
            ok_handler,
            dns=local,
            live_allow_private=True,
            live_sources=[{"id": "shop", "name": "Shop", "url": "http://localhost:3000/m"}],
            source_tokens={"shop": TOKEN},
        )
    )
    assert by_id(snap)["shop"][3] == "ok"


def test_no_polling_without_watchers() -> None:
    calls: list[httpx.Request] = []
    watchers = 0

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return ok_handler(request)

    src = LiveSource(
        live_settings(),
        lambda: watchers,
        transport=httpx.MockTransport(handler),
        resolve=public_dns,
    )

    async def run() -> Snapshot:
        nonlocal watchers
        it = src.stream().__aiter__()
        first = asyncio.ensure_future(it.__anext__())
        await asyncio.sleep(1.5)
        assert calls == [] and not first.done()
        watchers = 1  # first viewer arrives -> polled promptly
        snap = await asyncio.wait_for(first, 2)
        first.cancel()
        return snap

    snap = asyncio.run(run())
    assert len(calls) == 2 and by_id(snap)["shop"][3] == "ok"


def test_tokens_and_bodies_never_logged(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.headers["host"] == "shop.example":
            return reply(401, b"secret-body-marker")
        return reply(body={"secret-body-marker": 1})

    poll(source(handler), 3)
    assert "shop: http 401" in caplog.text and "blog: invalid payload" in caplog.text
    assert TOKEN not in caplog.text and "secret-body-marker" not in caplog.text
    assert caplog.text.count("shop: http 401") == 1  # only on change


def test_info_endpoint_and_public_tickets() -> None:
    with TestClient(create_app(live_settings())) as c:
        info = InfoResponse.model_validate(c.get("/api/v1/info").json())
        assert info.mode == "live"
        assert [(s.id, s.name) for s in info.sources] == [("shop", "Shop"), ("blog", "Blog-App")]
        assert c.post("/api/v1/ws-ticket").status_code == 200  # live_public: no key needed


def test_live_without_public_still_needs_api_key() -> None:
    key = "k" * 40
    s = live_settings(live_public=False, api_keys=[SecretStr(key)])
    with TestClient(create_app(s)) as c:
        assert c.post("/api/v1/ws-ticket").status_code == 401
        ok = c.post("/api/v1/ws-ticket", headers={"Authorization": f"Bearer {key}"})
        assert ok.status_code == 200


def test_demo_info() -> None:
    with TestClient(create_app(Settings(_env_file=None, allowed_hosts=["testserver"]))) as c:
        assert c.get("/api/v1/info").json() == {"mode": "demo", "sources": []}


def _src(url: str, sid: str = "shop") -> dict[str, str]:
    return {"id": sid, "name": "Shop", "url": url}


@pytest.mark.parametrize(
    "overrides",
    [
        {"live_public": False},  # no api keys either
        {"live_sources": []},
        {"source_tokens": {"shop": TOKEN}},  # blog has no token
        {"source_tokens": {"shop": TOKEN, "blog": TOKEN, "x": TOKEN}},
        {"source_tokens": {"shop": TOKEN, "blog": "short"}},
        {"live_sources": [_src("https://a.example/m"), _src("https://b.example/m")]},  # dup id
        {
            "live_sources": [_src("https://a.example/m", "internet")],
            "source_tokens": {"internet": TOKEN},
        },
        {"live_poll_seconds": 1},
        {"live_poll_seconds": 600},
    ],
)
def test_live_config_rejected(overrides: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        live_settings(**overrides)


@pytest.mark.parametrize(
    "url",
    [
        "ftp://shop.example/m",
        "https://user:pw@shop.example/m",
        "https://shop.example/m?token=x",
        "https://shop.example/m#x",
        "https://*.example/m",
        "https://shop.example:99999/m",
        "file:///etc/passwd",
    ],
)
def test_live_source_url_rejected(url: str) -> None:
    with pytest.raises(ValidationError):
        live_settings(live_sources=[_src(url)], source_tokens={"shop": TOKEN})


def test_prod_live_requires_https_and_no_private() -> None:
    prod = {"env": "prod", "allowed_origins": ["https://tw.example"]}
    live_settings(**prod)  # https sources are fine
    with pytest.raises(ValidationError):
        live_settings(
            **prod, live_sources=[_src("http://shop.example/m")], source_tokens={"shop": TOKEN}
        )
    with pytest.raises(ValidationError):
        live_settings(**prod, live_allow_private=True)


def test_env_json_format(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TIDEWATCH_MODE", "live")
    monkeypatch.setenv("TIDEWATCH_LIVE_PUBLIC", "true")
    monkeypatch.setenv("TIDEWATCH_LIVE_SOURCES", json.dumps([_src("https://shop.example/m")]))
    monkeypatch.setenv("TIDEWATCH_SOURCE_TOKENS", json.dumps({"shop": TOKEN}))
    s = Settings(_env_file=None)
    assert s.live_sources[0].id == "shop"
    assert TOKEN not in repr(s)  # SecretStr
