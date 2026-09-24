# Render (free web service): ONE container running Caddy on $PORT (static frontend + the same
# headers/CSP as deploy/Caddyfile) in front of uvicorn on 127.0.0.1. Render terminates TLS.
# Build context is the repo root (see render.yaml). Base images pinned by digest.

FROM node:25-slim@sha256:81db02c4b671288a03915da9534dbd54f96d0e7c24d80ccc54f5b36b2e684370 AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
# --ignore-scripts: dependency install scripts never run (same as CI).
RUN npm ci --ignore-scripts
COPY frontend/ ./
RUN npm run build && npm run check:bundle

FROM caddy:2@sha256:0c994536bddb66445885237f1a5dcc1916bccea922661c76b4e9fc24061f9b52 AS caddy

# Keep in sync with backend/Dockerfile (the lock is resolved against this image).
FROM python:3.12-slim@sha256:2f17fc044b579bab302c2e8054d3a686e2cb9a83de48e70534b94cd8ebbe06a9

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_ROOT_USER_ACTION=ignore

WORKDIR /app
COPY backend/requirements.lock ./
RUN pip install --require-hashes --no-deps --only-binary=:all: -r requirements.lock
COPY backend/app ./app

# Caddy is a static Go binary: it runs unchanged on this Debian base.
COPY --from=caddy /usr/bin/caddy /usr/local/bin/caddy
COPY --from=web /web/dist /srv
COPY deploy/render/Caddyfile /etc/caddy/Caddyfile
COPY deploy/render/start.sh /usr/local/bin/tidewatch-start

RUN chmod 755 /usr/local/bin/tidewatch-start \
 && useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin app
USER 10001

# Caddy keeps no state here (no ACME, admin API off); point its dirs at /tmp.
ENV XDG_CONFIG_HOME=/tmp/caddy XDG_DATA_HOME=/tmp/caddy PORT=10000
EXPOSE 10000
CMD ["/usr/local/bin/tidewatch-start"]
