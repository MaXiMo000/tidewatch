# NOTE: not yet built in CI (see docs/HANDOVER.md, M0). Pin the base image by digest in M0/M6.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app
COPY pyproject.toml ./
COPY app ./app
RUN pip install .

# Run as an unprivileged user with no home directory and no shell.
RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin app
USER 10001

EXPOSE 8000
# --forwarded-allow-ips=* is acceptable ONLY because the backend is not published to the host
# and is reachable solely from the reverse proxy on the private compose network.
CMD ["uvicorn", "app.main:get_app", "--factory", "--host", "0.0.0.0", "--port", "8000", \
     "--proxy-headers", "--forwarded-allow-ips=*", "--no-server-header"]
