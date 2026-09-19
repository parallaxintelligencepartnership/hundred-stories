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

Color (world, procedural art):
- sky keyframes by minute of day: night `#070b1a`, dawn `#f0a070` over `#4a5a9a`, day `#8fc4f0` over `#d8ecfa`, dusk `#f06a4a` over `#2a2f6a`
- slab `#2f3238`, slab edge `#4a4e57`
- window unlit `#1a2233`, window lit warm `#ffd27a`, window lit office `#cfe6ff`
- room wall palette per kind, muted and desaturated so lit windows and stress tints carry the signal
- stress tints on sims: calm none, pink `#ff9ad5`, red `#ff4d4d`, black `#101010`

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
5. Pixel art at integer scales: `antialias: false`, `roundPixels: true`, zoom steps snap to 0.5, 1, 2, 3 for crisp rendering, free zoom between them allowed while the wheel is moving.
