# Round 2 - islands, foliage, framing trees, lily pads

Final images: `{high,medium,low}-{1440x900,390x844}.jpg`. History: `high-1440x900-a..i.jpg`
(desktop loops), `high-390x844-f..i.jpg` (phone), `medium/low-*-f..h.jpg` (Balanced/Simple).
Same GPU as Round 1 (Intel UHD, i3-1125G4, D3D11).

| Pass | What was wrong vs the reference | Fix |
| --- | --- | --- |
| a | Already reads as a mirror swamp, but the cypress looked like palm trees (bare poles, small top crowns, evenly spaced "plantation"); leaf cards spiky; moss invisible; lily pads grey discs; no close framing | Crowns from 40% height with 4-6 spreading branches and mid-branch clumps; rounder, denser leaf texture; longer paler moss; darker rough pads; hero trees at both frame edges leaning in |
| b | Real cypress + moss now; a bare stick tree (leaf instance buffer full); canopy too heavy, sky hidden; auth tower hid the api hall | Capacities raised; background wall shorter near the view axis (V framing); diagonal view |
| c | Strong image; tower still overlapped hall; lighthouse cropped at the edge | Camera picks the base azimuth that maximises the angular gap between islands and keeps them off the frame edges; sun defined relative to the view so the glint always faces the viewer |
| d | All 7 islands separated; vault and lock ring faced away; open water at the horizon | Structures turn their fronts to the camera (+ jitter); islets scaled up; far misty treeline closes the horizon |
| e | Readable at a glance: lighthouse, tower, stilt hall, jetty, beacon, workshop, vault (status ring) | (desktop accepted) |
| f/g | Phone: moss curtain from a hero tree mid-frame; Balanced: giant blob trees, brown water | Placement uses the real horizontal FOV; portrait camera a bit higher; stylised ring further out, slimmer trees; stylised water reflects the teal fog |
| h | Phone: camera inside a canopy (crowns ~0.4x height wide crossed the narrow frustum) | Crown-aware clearance from the frustum edge and sight lines; eye clearance; no hero trees in portrait |
| i | Phone reads as a tree-lined channel with every structure visible; desktop unchanged | Static structure meshes merged per material (draw calls 270 -> 169) without visual change |
| j (owner feedback) | Background trees read as bare trunks, some looking like they float above the water: crowns started too high, nothing grew below them, and the densest fog sat exactly at the waterline, fading the trunk bases into a pale band | Crowns from ~30% height; understory bushes around 80% of bases and along the banks; a dark root mound under every trunk; fog spread higher (height 2.2 -> 4.2, density 0.022 -> 0.016). Trees on islets removed: their fuller crowns hid the structures |

Open for Rounds 3-4: light shafts through the canopy, bloom on lanterns/glint, fireflies, boats and
wakes, health drama (amber pulse / red flicker / storm / rain / lightning), HUD + labels; Balanced
and Simple islands are still the M1 shapes (their polish is Round 4); lantern glow sprites still
one draw call each (batch in Round 4).
