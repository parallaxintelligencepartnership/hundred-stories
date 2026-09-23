# Hundred Stories: visual direction

Subject: a cross section of a downtown high rise, seen the way an architect's diorama model shows it, with the building's life visible through the cut. Audience: people who remember the 1994 original and anyone who likes watching small systems run. Primary job: make the tower itself the thing you cannot stop watching. Everything else recedes.

## The one bold element

The tower cross section. Living windows, tenants moving, cars sliding in the shafts, a sky that turns. All lighting and motion budget goes here. The chrome around it is quiet, flat, and disciplined so the tower reads as the hero at every zoom level.

Second, small signature: the status readouts (clock, cash, floor under cursor) are drawn as segmented elevator indicator displays. Nowhere else uses that face.

## Tokens

Color (chrome):
- steel `#1c232e` panel base, the dusk color of curtain wall glass
- steel-2 `#28313f` raised surfaces
- line `#3a4556` hairline borders (structure, never decoration)
- ink `#e8ecf2` primary text
- ink-dim `#98a3b3` secondary text
- amber `#f4b942` signage and primary action (matches the app icon)
- indicator `#8ff0c0` segmented readouts only
- alert `#ff5c4d` fire, bomb, black stress, destructive confirmations

Grid (since 0.4.0): the base grid is 16 px tiles and 72 px floors, twice the 0.3 grid, so a room has a real interior at zoom 1. Lines, outlines and mullions are 2 px. Textures bake at the device pixel ratio rounded to 1 or 2 with nearest neighbour sampling. The constants live in src/render/grid.ts and nothing else may assume a pixel size.

Color (world, procedural art), corrected 2026-09-19 after Matt saw the first build ("doesn't look anything like SimTower used to"). The world must read like the original: bright, flat, high contrast, daytime dominant.
- sky: day `#9fd3f5` at the top to `#dcefff` at the horizon, flat with no haze; dawn and dusk are short transitions (about one game hour each) through `#f6b98a` and `#e08a7a`; night `#0d1b3d` to `#1c2f5c`, never black
- horizon: one low distant skyline strip, 3 tiles (48 px), `#b9cfe0`, no tall silhouettes, no parallax city
- underground: concrete gray `#6b6f78` with floor lines `#4c5058`, not brown or black
- slab `#e6e6e6`, the bottom 6 px of a floor (y 66 to 71) with a 2 px `#333333` top edge, casting a 4 px `#333333` shadow at 25 percent over the top of the floor below; every room cell has a 2 px `#222222` outline so rooms read as bright cells like the original
- walls are two tone: the lit face, and a shadow face about 13 percent darker on the rightmost 8 interior px (4 px on a one tile lobby); windows are 12 by 12 panes, one per tile at x 2 + 16n, y 6, with 2 px mullions and a sill at y 18 to 19
- room walls: office `#f7f5ee`, condo `#f2e8d8`, hotel `#eef2f7`, fast food `#fff1c9`, restaurant `#f3e3e3`, shop `#e9f2e4`, cinema `#2b2b3a` (dark by nature), party hall `#f5e8f2`, medical `#f2f8f7`, security `#e4e8ee`, housekeeping `#eeeae2`, parking `#8d9199`, recycling `#dfe6dc`, metro `#c9ced8`, cathedral `#f4efe4`, lobby white marble `#f8f8f6` with `#3a3a3a` columns
- windows: day `#7fb6e0`, night lit `#ffd866`, unlit night `#2a3550`
- shafts: `#d8dbe0` rails on `#3b3f47` cavity, cars `#f0c419` with a `#c09d14` shadow face, two door panels on a dark door line, a `#fff3b0` ceiling light strip, and a 4 px shadow cast up the shaft at 25 percent
- sims: black `#111111` figures 1 tile wide by 3 tiles tall (16 by 48 px since 0.4.0), like the original's; pink `#ff7ad9` and red `#ff2d2d` by stress band; sims are the only saturated moving color besides cars
- ghost green `#5fd38a`, refused red `#ff5c4d`; the chrome keeps the steel tokens above, and the contrast between dark chrome and bright world is the composition

Type:
- Display and UI: Bricolage Grotesque (Google Fonts), weights 400 and 600. Panel titles at 600, everything else 400.
- Readouts only: Share Tech Mono, for clock, cash, floor and population numbers in the top bar.
- Scale: 12, 14, 16, 20, 28. Line height 1.4 for UI, 1.1 for readouts. Sentence case everywhere. No tracked out caps, no eyebrows.

Layout:
```
+-------------------------------------------------------------+
| [cash 000000] [pop 0000] [stars] [clock day]  [speed] [menu]|  top strip, 44px
+------+------------------------------------------------------+
| pal  |                                                      |
| ette |                 TOWER VIEW (canvas)                   |
| 200  |                                                      |
| px   |                                            [query]   |  right panel slides in on click
+------+------------------------------------------------------+
| event ticker (one line, newest, click to open the log)      |  28px
+-------------------------------------------------------------+
```
Left aligned. The palette is a building directory board: groups as bold rows, tools as indented rows with the cost right aligned, locked tools show the star needed instead of a cost. On phone width the palette becomes a bottom sheet and the top strip wraps to two rows.

Motion:
- One page-load moment: the tower view fades from black as the sky rises to the current hour, 900 ms. Nothing else animates on load.
- Motion that answers an action: build ghost snaps to grid, placed room drops 4 px with a 120 ms settle, panels slide 160 ms.
- Ambient motion only in the world: cars, people, sky, window flicker at dusk. Never in the chrome.
- `prefers-reduced-motion`: no inertia, no particles, no fades; panels appear instantly; the sim still runs.

Principles:
1. The chrome is a directory board, not a dashboard. Flat surfaces, hairline structure, no cards, no shadows, no gradients in the UI.
2. Every number is a readout, every label is a sentence-case word. No icons without a label.
3. Copy speaks in the interface's voice: "Not enough cash. Offices cost $40,000." not "Oops!".
4. US spelling. No em dashes, no spaced hyphens as dashes, anywhere in UI text.
5. Pixel art at integer scales: `antialias: false`, `roundPixels: true`, zoom steps snap to 0.5, 1, 2, 3 for crisp rendering, free zoom between them allowed while the wheel is moving. Since 0.4.0 zoom 1 is the opening view (a floor is 72 css px, as zoom 2 was on the 8 px grid) and the furthest out is 0.175 (a floor 12.6 css px, unchanged).
