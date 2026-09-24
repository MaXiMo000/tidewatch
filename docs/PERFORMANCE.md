# Performance

Low-end devices are a first-class target. Budgets below are **requirements**; CI enforces what it can.

## Budgets

| Metric | Budget |
| --- | --- |
| Initial JS (gzip) | <= 350 KB (three.js tree-shaken ~150 KB; verify with the build report) |
| Total transfer before first frame | <= 1.5 MB, no model files required |
| Time to first rendered frame | <= 2.5 s on a mid-range Android over 4G |
| Frame rate | see per-tier budgets below |
| Draw calls | see per-tier budgets below |
| Triangles | see per-tier budgets below |
| JS heap | <= 300 MB |
| WebSocket payload | <= 2 KB per tick for the demo graph |
| Main-thread work during scroll | <= 8 ms per frame on Low |

### Per-tier budgets (art pass, owner-approved: High pushed toward photoreal, Medium/Low stay simple)

| | Cinematic (High) | Balanced (Medium) | Simple (Low) |
| --- | --- | --- | --- |
| Frame rate | 60 fps on a discrete GPU or Apple M-series; >= 30 fps on an Intel Iris Xe-class laptop; otherwise the governor must step down | 60 fps | >= 30 fps on the reference low-end device |
| Draw calls (all passes: main + reflection + shadow + post) | <= 200 | <= 60 | <= 40 |
| Triangles (all passes) | <= 400k | <= 20k | <= 10k |
| GPU memory (render targets + textures, estimate) | <= 64 MB | <= 4 MB | <= 2 MB |
| Download beyond the initial bundle | <= 15 MB, lazy, cached (currently 20.1 KB of JS: everything is procedural) | none - never fetches Cinematic code | none |

Measured values per round live in `docs/HANDOVER.md`. `npm run check:bundle` enforces the
initial (350 KB) and lazy-chunk budgets in CI; `node frontend/scripts/perf.mjs` prints fps, CPU ms,
draw calls, triangles and GPU memory per tier (dev server, `?debug=1`).

Reference low-end device: pick and record it in M1 (e.g. a ~2019 Android with a Mali/Adreno
mid-tier GPU) and test on real hardware, not only throttled desktop Chrome.

## Techniques (in order of impact)

1. **Cap pixel ratio** (2 / 1.5 / 1). Biggest single win on weak GPUs.
2. **Fake expensive effects.** Gradient + Fresnel water, baked glow sprites, single-layer fog.
   Planar reflections and bloom only on High.
3. **Instancing + GPU animation.** Particles/ships/trees as `InstancedMesh`; motion in the vertex shader.
4. **Procedural geometry and textures.** Tiny bundle, no decode cost. If assets are added: KTX2 + Draco/Meshopt.
5. **Render only when useful.** Pause on `document.hidden`; low-fps idle; frame cap on Low.
6. **Keep data off the render path.** Socket -> store -> once-per-frame read + interpolation.
7. **No per-frame allocation.** Reuse `Vector3`/`Color`; avoid closures in the hot loop.
8. **Lazy-load** everything not needed for the first frame (audio, photo mode, fallback dashboard).
9. **Adaptive quality.** FPS governor steps tiers down on sustained slow frames, up with hysteresis.

## Measurement

- In-app dev overlay (`?debug=1`, dev builds only): fps, frame ms, draw calls, triangles, tier.
- Scroll cost: `node frontend/scripts/perf-scroll.mjs --tier low [--throttle 4] [--idle 1]` (dev
  server): renderer main-thread ms per frame while wheel-scrolling the film, vs idle.
- Chrome Performance panel with 4x CPU throttle for quick checks; real-device checks before each milestone closes.
- Lighthouse CI budget (M6). Bundle-size check in CI (fail on > budget).
- Record results per milestone in `docs/HANDOVER.md` so regressions are visible.
- CI: `npm run check:bundle` fails the build over the 350 KB gzip initial-JS budget.

## Accessibility and comfort

- `prefers-reduced-motion`: disable smooth scroll, camera shake and flashes; show chapter cards.
- Flashing: red "error" flashes must stay below 3 flashes per second and be disabled in reduced-motion.
- Never rely on colour alone: status also shown by icon/text in the HUD and the 2D fallback.
