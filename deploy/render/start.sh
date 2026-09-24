#!/bin/bash
# Container entrypoint for Render: uvicorn (loopback only) + Caddy (public $PORT).
# The container exits as soon as either process dies, so Render restarts it.
set -euo pipefail

# The public hostname drives the Host/Origin allowlists and the CSP's wss:// source.
# Render sets RENDER_EXTERNAL_HOSTNAME; TIDEWATCH_PUBLIC_HOST overrides it (e.g. a custom domain).
host="${TIDEWATCH_PUBLIC_HOST:-${RENDER_EXTERNAL_HOSTNAME:-}}"
if [[ ! "$host" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$ ]]; then
  echo "set RENDER_EXTERNAL_HOSTNAME or TIDEWATCH_PUBLIC_HOST to the exact public hostname" >&2
  exit 1
fi
export TIDEWATCH_PUBLIC_HOST="$host"
export TIDEWATCH_ALLOWED_HOSTS="${TIDEWATCH_ALLOWED_HOSTS:-[\"$host\"]}"
export TIDEWATCH_ALLOWED_ORIGINS="${TIDEWATCH_ALLOWED_ORIGINS:-[\"https://$host\"]}"
export TIDEWATCH_ENV="${TIDEWATCH_ENV:-prod}"

# Only Caddy (on loopback) may set X-Forwarded-For, and it sends exactly one value: the client IP
# it derived from Render's proxy chain (see Caddyfile).
uvicorn app.main:get_app --factory --host 127.0.0.1 --port 8000 \
  --proxy-headers --forwarded-allow-ips=127.0.0.1 --no-server-header &
backend=$!
caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &
proxy=$!

trap 'kill -TERM "$backend" "$proxy" 2>/dev/null || true' TERM INT
set +e
wait -n "$backend" "$proxy"
status=$?
kill -TERM "$backend" "$proxy" 2>/dev/null
wait
exit $(( status == 0 ? 1 : status ))
