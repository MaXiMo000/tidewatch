#!/usr/bin/env bash
# Regenerate backend/requirements.lock (hash-pinned runtime deps) for the Docker image.
# Resolves inside the SAME base image as backend/Dockerfile, so platform-specific wheels
# (uvloop, httptools, ...) match what the container installs. Run after editing
# backend/pyproject.toml dependencies, and keep the digest in sync with the Dockerfile.
# Usage: ./scripts/lock-backend.sh
set -euo pipefail
cd "$(dirname "$0")/../backend"

BASE="$(sed -n 's/^FROM \(python:[^ ]*\).*/\1/p' Dockerfile | head -n1)"
[ -n "$BASE" ] || { echo "could not read the python base image from backend/Dockerfile" >&2; exit 1; }

# Pyproject is mounted read-only and the lock comes back on stdout, so nothing in the repo is
# written by the container's root user. MSYS_NO_PATHCONV/pwd -W keep Git Bash on Windows working.
SRC="$(pwd -W 2>/dev/null || pwd)"
MSYS_NO_PATHCONV=1 docker run --rm -e CUSTOM_COMPILE_COMMAND="./scripts/lock-backend.sh" \
  -v "$SRC/pyproject.toml:/src/pyproject.toml:ro" -w /src "$BASE" \
  sh -c 'pip install -q --root-user-action=ignore --disable-pip-version-check pip-tools >&2 \
    && pip-compile -q --generate-hashes --strip-extras --allow-unsafe --no-emit-index-url \
       --output-file=- pyproject.toml' > requirements.lock.tmp
mv requirements.lock.tmp requirements.lock
echo "wrote backend/requirements.lock using $BASE"
