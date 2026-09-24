# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Use GitHub's private reporting: **Security tab -> "Report a vulnerability"** on this repository.
Include steps to reproduce, affected version/commit, and impact. You will get an acknowledgement
within 7 days. This is a personal open-source project: fixes are best-effort, and coordinated
disclosure is appreciated.

## Scope

In scope: the backend API/WebSocket, the frontend, deployment config in `deploy/`, and CI
workflows. Out of scope: findings that require a compromised host, volumetric DDoS, or issues in
third-party dependencies with no exploitable path here (report those upstream).

## Design and threat model

See [`docs/SECURITY.md`](docs/SECURITY.md).

## Secrets

This repository must never contain real secrets. If you find one, report it privately using the
process above so it can be rotated (deleting a committed secret does not make it safe).
