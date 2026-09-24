"""Smoke-test the Render image (deploy/render/Dockerfile) running locally over plain HTTP.

Render terminates TLS and forwards to the container, so this plays Render's proxy: plain HTTP to
$PORT, the public hostname in Host, and X-Forwarded-For chains like Render sends.

    docker build -f deploy/render/Dockerfile -t tidewatch-render .
    docker run -d --name tw-render -p 10000:10000 -e RENDER_EXTERNAL_HOSTNAME=localhost \
        tidewatch-render
    backend/.venv/bin/python scripts/smoke_render.py      # Scripts\\python on Windows

Checks the same headers/CSP/WebSocket controls as smoke_compose.py, plus the Render-specific
ones: health check with a foreign Host, exact Host allowlist, and per-client IPs derived from
X-Forwarded-For without being spoofable. Exits 1 if any check failed.
"""

from __future__ import annotations

import argparse
import asyncio
import http.client
import json

import websockets
from smoke_compose import API_CSP, FRONTEND_CSP, check, check_headers, failures
from websockets.typing import Origin

RATE = 10  # the app's default ticket rate per client IP per minute


def request(
    port: int, path: str, method: str = "GET", headers: dict[str, str] | None = None
) -> tuple[int, dict[str, str], bytes]:
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    try:
        conn.request(method, path, headers={"Host": "localhost", **(headers or {})})
        r = conn.getresponse()
        return r.status, {k.lower(): v for k, v in r.getheaders()}, r.read()
    finally:
        conn.close()


def tickets(port: int, xff: str, n: int) -> list[int]:
    hdr = {"X-Forwarded-For": xff}
    return [request(port, "/api/v1/ws-ticket", "POST", hdr)[0] for _ in range(n)]


async def ws_checks(port: int, domain: str, live: bool) -> None:
    url = f"ws://{domain}:{port}/ws/v1/stream"
    origin = Origin(f"https://{domain}")
    _, _, body = request(port, "/api/v1/ws-ticket", "POST", {"X-Forwarded-For": "198.51.100.7"})
    t = str(json.loads(body)["ticket"])
    async with websockets.connect(url, origin=origin) as ws:
        await ws.send(json.dumps({"type": "auth", "ticket": t}))
        snap = json.loads(await asyncio.wait_for(ws.recv(), 10))
        check("ws: valid ticket + origin streams a v1 snapshot", snap.get("v") == 1)
        if live:
            statuses = {s["id"]: s["status"] for s in snap["services"]}
            check(
                "ws: live apps that cannot be reached are offline",
                statuses.get("internet") == "ok"
                and all(v == "offline" for k, v in statuses.items() if k != "internet"),
                str(statuses),
            )
    async with websockets.connect(url, origin=origin) as ws:
        await ws.send(json.dumps({"type": "auth", "ticket": t}))
        try:
            await asyncio.wait_for(ws.recv(), 5)
            check("ws: reused ticket refused", False, "received data")
        except websockets.ConnectionClosed as e:
            code = e.rcvd.code if e.rcvd else None
            check("ws: reused ticket refused with 1008", code == 1008, f"close code {code}")
    try:
        async with websockets.connect(url, origin=Origin("https://evil.example")) as ws:
            await asyncio.wait_for(ws.recv(), 5)
        check("ws: foreign Origin refused", False, "connection stayed open")
    except (websockets.InvalidStatus, websockets.ConnectionClosed):
        check("ws: foreign Origin refused", True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=10000)
    ap.add_argument("--domain", default="localhost")
    ap.add_argument("--live", action="store_true", help="container runs TIDEWATCH_MODE=live")
    args = ap.parse_args()
    port = args.port

    status, h, body = request(port, "/")
    check("GET / -> 200", status == 200)
    check("GET / serves the built app with no inline script",
          b'<script type="module"' in body and b"<script>" not in body)
    check_headers("frontend:", h, FRONTEND_CSP.format(domain=args.domain))

    status, h, _ = request(port, "/api/v1/info")
    check("GET /api/v1/info -> 200", status == 200)
    check_headers("api:", h, API_CSP)

    _, _, body = request(port, "/openapi.json")
    check("backend OpenAPI schema not exposed", b'"openapi"' not in body)
    status, _, _ = request(port, "/healthz", headers={"Host": "10.1.2.3:10000"})
    check("health check answers with Render's internal Host", status == 200, str(status))
    status, _, _ = request(port, "/api/v1/info", headers={"Host": "evil.example"})
    check("API refuses a foreign Host", status == 400, str(status))

    asyncio.run(ws_checks(port, args.domain, args.live))

    # Client IP: the rightmost X-Forwarded-For entry (appended by Render) is the client.
    a, b = "203.0.113.10", "203.0.113.20"
    codes = tickets(port, f"10.0.0.1, {a}", RATE + 1)
    check("per-IP ticket limit applies to the forwarded client", codes[-1] == 429, str(codes))
    check("another client is not limited by the first", tickets(port, b, 1) == [200])
    spoof = tickets(port, f"{b}, {a}", 1)
    check("a client cannot pick its IP by prepending X-Forwarded-For", spoof == [429], str(spoof))

    print(f"\n{'ALL CHECKS PASSED' if not failures else f'{len(failures)} FAILED: {failures}'}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
