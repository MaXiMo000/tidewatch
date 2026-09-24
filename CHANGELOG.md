# Changelog

All notable changes. Versions follow [Semantic Versioning](https://semver.org/).

## [0.1.0] - unreleased (tag after M2-M6 are merged)

### Added
- **M6 hardening:** Trusted Types enforced; ZAP baseline and k6 WebSocket load tests in CI;
  browser-measured performance budget; release workflow with SPDX SBOM and build provenance;
  README with the film GIF.
- **M4 live mode:** free-fly camera, event feed, photo mode, optional procedural sound, 2D table
  view (WebGL fallback and `?view=2d`), screen-reader status sentence.
- **M3 weather from data:** latency mist and fog, storm clouds and lightning over failing
  services, sinking boats for errors, red channels, a camera shake on new failures.
- **M2 scroll film:** six chapters with a hero request following the real route, chapter cards,
  rail and skip link, reduced-motion stills.
- **M5 live data:** metrics add-ons for Node and ASGI apps, `LiveSource` (SSRF-checked, polls only
  while watched), offline islands, Render deployment, public aggregates-only live mode (owner risk
  acceptance in `docs/SECURITY.md`).
- **M1 + art pass:** three quality tiers (Cinematic, Balanced, Simple) with an FPS governor.
- **M0:** hardened FastAPI WebSocket backend, strict schemas, compose stack, CI.

### Changed
- Islands are batched per material across the whole archipelago: draw calls no longer grow with
  the number of services (41 services on Simple: 121 -> 9 calls).

### Fixed
- Caddy now answers TLS clients that send no SNI for `localhost` (found by the ZAP scan).
