# Base image pinned by digest (tag kept for readability; Dependabot bumps both).
# If you change it, regenerate the lock: ./scripts/lock-backend.sh
FROM python:3.12-slim@sha256:2f17fc044b579bab302c2e8054d3a686e2cb9a83de48e70534b94cd8ebbe06a9

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_ROOT_USER_ACTION=ignore

WORKDIR /app
# Every dependency is pinned and hash-checked; --no-deps means nothing unlisted can sneak in.
COPY requirements.lock ./
RUN pip install --require-hashes --no-deps --only-binary=:all: -r requirements.lock
# The app is run from source (WORKDIR is on sys.path), so no unhashed build backend is fetched.
COPY app ./app

# Run as an unprivileged user with no home directory and no shell.
RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin app
USER 10001

EXPOSE 8000
# --forwarded-allow-ips=* is acceptable ONLY because the backend is not published to the host
# and is reachable solely from the reverse proxy on the private compose network.
CMD ["uvicorn", "app.main:get_app", "--factory", "--host", "0.0.0.0", "--port", "8000", \
     "--proxy-headers", "--forwarded-allow-ips=*", "--no-server-header"]
