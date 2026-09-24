# Round 1 - sky, lighting, water, volumetric fog (empty world)

Captured with `frontend/scripts/shoot.mjs` (headless Chrome on the real GPU: Intel UHD, i3-1125G4).
Final images: `{high,medium,low}-{1440x900,390x844}.jpg`. Critique history (Cinematic, 1440x900):
`high-1440x900-a..d.jpg`.

| Pass | What was wrong vs the reference | Fix |
| --- | --- | --- |
| a | Pastel seascape: far too bright; the fog a milky-white wall; water milky, not a mirror; clouds flat; giant white sun bloom from the fog phase term | Darker sky ramp, darker/contrasty clouds, fog darker teal + hugging the water, forward-scatter cut ~10x, darker reflections, calmer ripples |
| b | Moody now, but clouds were uniform "camouflage" blotches; reflections smeared; hard water/sky seam; sun out of frame so no glint column; mid water a flat teal sheet | Two-scale cloud field + self-shadow toward the sun + dark cores / lit thin edges; reflection distortion 0.06 -> 0.018; sun azimuth into frame; fog density down, max distance up |
| c | Glint column appears (the reference's signature). Sun is a blown-out white disc; clouds one brown mass | Sun glow terms cut; cloud bodies darker, only edges near the sun lit; low haze band at the horizon |
| d | Mood reads: dark masses, peach horizon, near-black mirror with the glint column. Sun still ~2 deg (ACES saturates the halo); on a phone (portrait, ~22 deg horizontal FOV) it swamped the frame | Crisp ~0.5 deg disc via smoothstep + faint halo (final set) |

Still open (by design, later rounds): the horizon is an open sea line - Round 2's cypress walls hide
it; no light shafts yet (need occluders - Round 2); bloom/grain/DOF in Round 3. Balanced and Simple
still show the M1 pastel look; they get the swamp palette and silhouette trees in Round 2 and their
polish in Round 4.
