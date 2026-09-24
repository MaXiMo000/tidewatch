# Round 4 - HUD, typography, performance, Balanced/Simple polish

Final images: `{high,medium,low}-{1440x900,390x844}.jpg`, `high-1440x900-incident.jpg` (demo
incident), `high-1440x900-hover.jpg` (hover card + Discovered toast), `high-1440x900-menu.jpg`
(quality menu). History: `*-a..e.jpg`.

| Pass | What was wrong | Fix |
| --- | --- | --- |
| a | New HUD in place (serif title, live status over a compass strip, place panel, labels, hints, legend, caption) but labels floated high above low structures (DB, Queue); on phones labels piled on top of each other, the brand wrapped and the caption crowded the legend | Labels anchored to each structure's real top (shared `scene/silhouette.ts`); nearest-first collision pass nudges labels up and collapses the rest to a status dot (name on hover/focus); phone header/footer re-laid out |
| b | Clean on both sizes; hover card, toast and menu verified | - |
| c | Perf: 220 draw calls on Cinematic (budget 200) - ~25 glow sprites, each drawn twice | All glows in one instanced billboard mesh: 163 calls, CPU 17 -> 7.6 ms/frame |
| d | Balanced/Simple still showed M1 blobs, not the same world | Islands, structures, health animation and boats moved to shared modules (`scene/islands.ts` "flat" flavour, `scene/boats.ts`); Balanced/Simple now show the lighthouse, tower, hall, beacon, vault, jetty, workshop and boats, flat-shaded |
| e | Red "failing" summary unreadable on the pink horizon band; stylised trees read as chess pieces; Balanced 31k triangles / Simple 43 calls over budget | Status and summary sit in dark pills; flat-topped cypress silhouettes scattered in depth; flat islets merged into one vertex-coloured mesh each, 20-triangle crown lumps: Balanced 26 calls / 15k tris, Simple 25 / 8.3k |

Accessibility held: status is always a word as well as a colour (summary, labels' aria-labels, card,
place panel); every island label is a focusable button (Tab inspects without a mouse); the quality
menu is a keyboard menu (Enter, arrows, Esc) and Q cycles quality; toasts and status are polite live
regions; under prefers-reduced-motion all HUD transitions and animations are off.
