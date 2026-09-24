# Round 3 - boats, wakes, health drama, post-processing

Final images: `{high,medium,low}-{1440x900,390x844}.jpg` plus `high-1440x900-degraded.jpg`.
History (Cinematic 1440x900): `a/b/c-calm.jpg` (all healthy) and `a/b/c-storm.jpg` (demo incident,
3 services failing), captured with `shoot.mjs --until "<HUD state>"`.

| Pass | What was wrong | Fix |
| --- | --- | --- |
| a | Every system worked but the frame was over-processed: a huge white blob at the sun (light shafts summing HDR sky up to 4.0 per sample), bloom threshold low enough to catch backlit foliage (milky, grey-green canopy), boats invisible, heavy grain; in the storm the lightning blew the frame out and lit leaf cards so hard their blocky alpha edges showed; rain read as a few long lines | Shafts clamp sky luminance at 1.2 and scale 0.6; bloom threshold 2.4 (lanterns/windows/glint only), strength 0.45; leaf backlight 1.8 -> 1.0; grain halved; DOF softer; flash exposure 2.2 -> 1.1 and light boost 6 -> 2.5; boats 1.7x with brighter lanterns; rain 2,400 finer, shorter, fainter streaks |
| b | Contrast back, but a white bloom blob remained at the sun: the HDR disc (12) and water glint peak (30) sit far above any bloom threshold | Disc 12 -> 3.2, glint peak 30 -> 5: they still bloom, like the reference's veiled moon, without smearing the frame |
| c + final | Calm: warm lantern bloom, lit boats on the channels with wakes, fireflies, soft moon glow in the mist. Degraded: amber pulse on signals and vault ring, thicker murk. Failing: sky darkens, rain, red flicker on failing islets, lightning strikes | - |

Health drama rules held: everything eases from the model's weights (no pops); lightning is at most one
strike per 2.5 s (far under 3 flashes/s) and never under prefers-reduced-motion, where the flicker
and pulses also go steady.

Measured (Intel UHD, 1440x900, headless): 220 draw calls (over the 200 budget - lantern glow sprites
are still one call each, batched in Round 4), 383k triangles (budget 400k).
