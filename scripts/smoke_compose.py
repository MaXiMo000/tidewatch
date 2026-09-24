"""Smoke-test a running deploy/docker-compose.yml stack from the host.

Usage (stack already up, e.g. TIDEWATCH_DOMAIN=localhost docker compose up -d in deploy/):
    docker compose -f deploy/docker-compose.yml cp \
        caddy:/data/caddy/pki/authorities/local/root.crt ca.crt
    backend/.venv/bin/python scripts/smoke_compose.py --ca ca.crt   # Scripts\\python on Windows

Uses only the stdlib plus `websockets` (installed with the backend's uvicorn[standard]).
Checks the controls from docs/SECURITY.md that are observable from outside: TLS, headers, the
single public origin, the WebSocket auth flow, and that the backend is not reachable directly.
Prints every result; exits 1 if any check failed.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import socket
import ssl
import subprocess  # nosec B404 (fixed docker compose argv only, never a shell)
import sys
import urllib.error
import urllib.request

import websockets
from websockets.typing import Origin

FRONTEND_CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; "
    "font-src 'self'; connect-src 'self' wss://{domain}; worker-src 'self' blob:; "
    "object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; "
    # Trusted Types, enforced (M6): no DOM XSS sink may take a string. The app has none to offer.
    "require-trusted-types-for 'script'; trusted-types 'none'; "
    "upgrade-insecure-requests"
)
API_CSP = "default-src 'none'; frame-ancestors 'none'"
COMMON = {
    "strict-transport-security": "max-age=63072000; includeSubDomains",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "cross-origin-opener-policy": "same-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
}

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"{'ok  ' if ok else 'FAIL'} {name}{' - ' + detail if detail and not ok else ''}")
    if not ok:
        failures.append(name)


def request(
    ctx: ssl.SSLContext, url: str, method: str = "GET"
) -> tuple[int, dict[str, str], bytes]:
    # URLs are always built here as https://<--domain>/..., never taken from responses.
    req = urllib.request.Request(url, method=method)  # noqa: S310
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=5) as r:  # noqa: S310  # nosec B310
            return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read()
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in e.headers.items()}, e.read()


def check_headers(prefix: str, headers: dict[str, str], csp: str) -> None:
    for k, v in COMMON.items():
        check(f"{prefix} {k}", headers.get(k) == v, f"got {headers.get(k)!r}")
    got_csp = headers.get("content-security-policy")
    check(f"{prefix} content-security-policy", got_csp == csp, f"got {got_csp!r}")
    for leaky in ("server", "via", "x-powered-by"):
        check(f"{prefix} no {leaky} header", leaky not in headers, f"got {headers.get(leaky)!r}")


def ticket(ctx: ssl.SSLContext, base: str) -> str:
    status, _, body = request(ctx, f"{base}/api/v1/ws-ticket", "POST")
    if status != 200:
        raise RuntimeError(f"ticket endpoint returned {status}")
    return str(json.loads(body)["ticket"])


async def ws_checks(ctx: ssl.SSLContext, domain: str, base: str) -> None:
    url = f"wss://{domain}/ws/v1/stream"
    origin = Origin(f"https://{domain}")

    t = ticket(ctx, base)
    async with websockets.connect(url, ssl=ctx, origin=origin) as ws:
        await ws.send(json.dumps({"type": "auth", "ticket": t}))
        frame = await asyncio.wait_for(ws.recv(), 5)
        snap = json.loads(frame)
        check(
            "wss: valid ticket + origin streams a v1 snapshot",
            snap.get("v") == 1 and snap.get("type") == "snapshot" and len(snap["services"]) > 0,
        )
        check("wss: snapshot frame within 2 KB budget", len(frame) <= 2048, f"{len(frame)} B")

    async with websockets.connect(url, ssl=ctx, origin=origin) as ws:
        await ws.send(json.dumps({"type": "auth", "ticket": t}))
        try:
            await asyncio.wait_for(ws.recv(), 5)
            check("wss: reused ticket refused", False, "received data")
        except websockets.ConnectionClosed as e:
            code = e.rcvd.code if e.rcvd else None
            check("wss: reused ticket refused with 1008", code == 1008, f"close code {code}")

    try:
        async with websockets.connect(url, ssl=ctx, origin=Origin("https://evil.example")) as ws:
            await asyncio.wait_for(ws.recv(), 5)
        check("wss: foreign Origin refused", False, "connection stayed open")
    except (websockets.InvalidStatus, websockets.ConnectionClosed):
        check("wss: foreign Origin refused", True)


def unreachable(host: str, port: int) -> bool:
    try:
        with socket.create_connection((host, port), timeout=3):
            return False
    except OSError:
        return True


def compose(compose_file: str, *argv: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(  # noqa: S603  # nosec B603 B607
        ["docker", "compose", "-f", compose_file, *argv],  # noqa: S607
        capture_output=True,
        text=True,
        check=False,
    )


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args: object, **kwargs: object) -> None:
        return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--domain", default="localhost")
    ap.add_argument("--ca", required=True, help="CA bundle that signed the site cert")
    ap.add_argument("--compose-file", default="deploy/docker-compose.yml")
    args = ap.parse_args()

    ctx = ssl.create_default_context(cafile=args.ca)
    base = f"https://{args.domain}"

    status, h, body = request(ctx, f"{base}/")
    check("GET / over verified TLS -> 200", status == 200)
    check(
        "GET / serves the built app with no inline script",
        b'<script type="module"' in body and b"<script>" not in body,
    )
    check_headers("frontend:", h, FRONTEND_CSP.format(domain=args.domain))

    status, h, _ = request(ctx, f"{base}/api/v1/ws-ticket", "POST")
    check("POST /api/v1/ws-ticket -> 200", status == 200)
    check("api: cache-control no-store", h.get("cache-control") == "no-store")
    check_headers("api:", h, API_CSP)

    _, _, body = request(ctx, f"{base}/openapi.json")
    check("backend OpenAPI schema not exposed", b'"openapi"' not in body)

    try:
        urllib.request.build_opener(_NoRedirect).open(f"http://{args.domain}/", timeout=5)
        check("http:// redirects to https://", False, "no redirect")
    except urllib.error.HTTPError as e:
        location = e.headers.get("location", "")
        check(
            "http:// redirects to https://",
            e.code in (301, 308) and location.startswith("https://"),
            f"{e.code} {location}",
        )

    asyncio.run(ws_checks(ctx, args.domain, base))

    for host in ("127.0.0.1", "localhost"):
        check(f"backend :8000 not reachable from host via {host}", unreachable(host, 8000))
    ps = compose(args.compose_file, "ps", "--format", "json", "backend")
    published = [
        p for p in json.loads(ps.stdout or "{}").get("Publishers") or [] if p["PublishedPort"]
    ]
    check("backend has no published port", ps.returncode == 0 and not published, str(published))
    egress = compose(
        args.compose_file, "exec", "-T", "backend", "python", "-c",
        "import socket; socket.create_connection(('1.1.1.1', 443), timeout=4)",
    )
    check("backend has no internet egress", egress.returncode != 0)

    print(f"\n{'ALL CHECKS PASSED' if not failures else f'{len(failures)} FAILED: {failures}'}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
