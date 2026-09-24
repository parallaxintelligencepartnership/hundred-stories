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

Grid (since 0.4.0): the base grid is 16 px tiles and 72 px floors, twice the 0.3 grid, so a room has a real interior at zoom 1. Lines, outlines and mullions are 2 px. Structural textures bake at the device pixel ratio rounded to 1 or 2 with nearest neighbour sampling; illustrated textures bake at twice that (see the two texture classes below). The constants live in src/render/grid.ts and nothing else may assume a pixel size.

World art, layered illustrated 2D (decision of 2026-09-23, package 2). The 2026-09-19 rule that the world must read like the original SimTower is superseded: the tower keeps its side-on cutaway, its tile rhythm and dark readable outlines as the nostalgic thread, and draws people and venues as modern illustration inside the same grid. Bright, high contrast and daytime dominant still hold. Every token below that still applies is kept.

Two texture classes (src/render/art.ts TEXTURE_CLASS):
- structural: room shells, slabs, shafts, the ghost. Pixel art from rectangles, baked at the bake resolution (device pixel ratio rounded to 1 or 2), nearest sampling, `antialias: false`. Room textures are cached by kind, size, variant and window state and are never rebaked for occupancy or weather.
- illustrated: people, venue fixtures and signs, closed-hours shutters and blinds, the elevator car, the curb scene. Anti-aliased canvas paths, arcs and gradients (src/render/figure.ts, src/render/illustrated.ts), baked at twice the bake resolution (2 or 4), linear sampling, so silhouettes are smooth at zoom 1 and crisp close up. Every illustrated shape carries a 2 px `#222222` outline so the cutaway still reads. Motion layers (people, doors, activity, light pools) are separate sprites over the cached room textures.
- budget: baked texture bytes for the demo tower stay within 1.6 times the 2026-09-23 baseline. Person textures are shared by every role that dresses alike, a mirrored walk or weight shift frame reuses its twin flipped, venue textures cover only the rows they draw, and a person texture no sprite shows is freed after 4 seconds unasked for.
- sky: day `#9fd3f5` at the top to `#dcefff` at the horizon, flat with no haze; dawn and dusk are short transitions (about one game hour each) through `#f6b98a` and `#e08a7a`; night `#0d1b3d` to `#1c2f5c`, never black
- horizon, the low horizon (decision 2026-09-22, replacing the single skyline strip; still no tall city): far hills `#c7d6e3`, a smooth curve 40 px high at zoom 1 at parallax 0.15, and near roofs `#b9cfe0`, two to four storey flat roofed silhouettes 64 px high at parallax 0.3, both standing on the street at the opening shot and tinted toward night; six soft white clouds at 55 percent drift right to left at 4 css px a second at parallax 0.1, and hold still under reduced motion
- underground: concrete gray `#6b6f78` with floor lines `#4c5058`, not brown or black
- slab `#e6e6e6`, the bottom 6 px of a floor (y 66 to 71) with a 2 px `#333333` top edge, casting a 4 px `#333333` shadow at 25 percent over the top of the floor below; every room cell has a 2 px `#222222` outline so rooms read as bright cells like the original
- walls are two tone: the lit face, and a shadow face about 13 percent darker on the rightmost 8 interior px (4 px on a one tile lobby); windows are 12 by 12 panes, one per tile at x 2 + 16n, y 6, with 2 px mullions and a sill at y 18 to 19
- room walls: office `#f7f5ee`, condo `#f2e8d8`, hotel `#eef2f7`, fast food `#fff1c9`, restaurant `#f3e3e3`, shop `#e9f2e4`, cinema `#2b2b3a` (dark by nature), party hall `#f5e8f2`, medical `#f2f8f7`, security `#e4e8ee`, housekeeping `#eeeae2`, parking `#8d9199`, recycling `#dfe6dc`, metro `#c9ced8`, cathedral `#f4efe4`, lobby white marble `#f8f8f6` with `#3a3a3a` columns
- windows (since 0.4.1, four states): day `#7fb6e0`; lit, someone inside at night, `#ffd866` with a 2 px `#fff3b0` header; vacant, nobody inside at night, `#2a3550`; housekeeping, a dirty hotel room at night, `#2a3550` with only the lamp on; a lobby is lit while people stand on its floor
- light: one screen sized multiply layer at 40 percent over the world and the sky (not the ghost or selection), tinted `#bfd8ff` at 06:00, `#ffffff` 07:00 to 17:00, `#ffd0a0` at 18:00, `#6078b0` 19:00 to 05:00, linear between
- shafts: `#d8dbe0` rails on `#3b3f47` cavity, a 2 px `#3b3f47` cable to the top of the shaft, and a 4 px shadow cast up the shaft at 25 percent over the car; the car itself is illustrated (below)
- people: illustrated figures in the same 1 tile by 3 tile box (16 by 48 px), feet on the slab line, so picking and the selection ring are unchanged. Five adult builds (average, tall, short, broad, slim; no child height), the build from seed and id, and the hairstyle, clothing cut and skin tone from the identity look key (0 to 7, src/sim/identity.ts), so a person keeps their look across saves. Four wardrobes: casual, worker office wear, the housekeeper's teal uniform and white apron, the VIP's camel long coat and dark glasses. Role props as overlays in the hand: worker briefcase, resident bag, hotel guest suitcase, shopper bag, visitor camera. Poses from existing state: a three frame walk cycle; waiting, a weight shift every 1.4 s; impatient (a wait past STORY.longWaitMinutes), the same shift with a glance at the watch for 0.7 s in every 3.2 s; inside a room, sitting at an office or restaurant, browsing in a shop, standing in a hotel room. Under reduced motion every pose holds its first frame and the impatient glance is a static tilt
- stress: no longer a whole body recolour. A mark 4 px wide at zoom 1 over the head: a pink `#ff7ad9` dot in the middle band, a red `#ff2d2d` exclamation in the top band, nothing when calm
- person panel: a 48 px portrait beside Who, the same figure standing, cropped to head and shoulders on `#e9edf2`
- venues (src/render/venue.ts `venueOf(seed, roomId, kind)`, pure): three treatments each. Office: design studio (pinboard, shared bench of laptops, pendants), finance office (ticker screen, walnut desks with twin monitors, credenza, clock), creative agency (poster, whiteboard easel, beanbag, string lights). Shop: boutique (mannequin, garment rail, mirror), bookshop (tall shelves of spines, a table of stacks), grocer (produce crates, drinks fridge); every shop has a striped awning and a counter with a register. Restaurant: bistro (round clothed tables, bentwood chairs, chalkboard), noodle bar (counter of stools, red lanterns), grill (high backed booths, brick, bare bulbs, the grill's glow); every restaurant has a kitchen pass with a steaming pot. Shops and restaurants carry a sign over the window band with a brand from 24 fictional names per kind (eight per treatment) on an accent board; the room panel shows the same name. The venue shell (VENUE_SHELL) is the structural room without furniture
- venue light and hours: open hours come from the schedules (offices weekdays 08:00 to 18:30, shops 10:00 to 21:00, restaurants 11:30 to 21:00). Closed: a roll-down shutter over a shop front, blinds drawn over an office or restaurant window band (a restaurant also hangs a Closed card), the sign dimmed. Open at night: the sign over a warm glow. Occupied at night: warm pools of light `#ffd678` at 50 percent under the ceiling. A clerk behind the counter or a cook at the pass while open and occupied
- elevator car (illustrated): a cab with a rounded crown, amber `#f7d34d` to `#dcae1c` (service grey), a warm lit interior `#fff3c4` to `#f0bf62` with a handrail, brushed metal door panels sliding out, and a floor indicator above the doors: the floor and a direction arrow in `#ffb347` segments
- curb scene: the street outside the ground lobby's two doors, behind the tower. Up to 12 commuters sampled from people outside or leaving walk in from off screen and out again; umbrellas open when rain and storm together pass 0.5 in the eased weather; the VIP's car pulls up on the vip.arrival beat and leaves on vip.rated; a fire engine or a police car waits at the curb while a fire or a bomb is active. All motion stops under reduced motion
- hierarchy and far zoom (src/render/hierarchy.ts): below zoom 0.75 a wall coloured veil mutes the window band by 20 percent and the stairs and escalators draw at 80 percent, so occupied rooms lead. Below zoom 0.5 every room is one flat block in its category colour (palette.ts BLOCK: offices blue, homes warm, hotels violet, food orange, shops green) with a 1 px outline (a lobby run outlined once), its occupancy a lighter fill from the floor up; no furniture and no people but the selected one. Selection, the ghost, the information views and fire stay at full strength at every zoom
- ghost green `#5fd38a`, refused red `#ff5c4d`; the chrome keeps the steel tokens above, and the contrast between dark chrome and bright world is the composition

Type:
- Display and UI: Bricolage Grotesque (Google Fonts), weights 400 and 600. Panel titles at 600, everything else 400.
- Readouts only: Share Tech Mono, for clock, cash, floor and population numbers in the top bar.
- Scale: 12, 14, 16, 20, 28. Line height 1.4 for UI, 1.1 for readouts. Sentence case everywhere. No tracked out caps, no eyebrows.

Layout:
```
+-------------------------------------------------------------+
| [cash, delta] [pop, trend] [stars] [dial clock day] [speed] |  status bar, 56px
+------+------------------------------------------------------+
| pal  |                                                      |
| ette |                 TOWER VIEW (canvas)                   |
| 232  |                                                      |
| px   |                                            [query]   |  right panel slides in on click
+------+------------------------------------------------------+
| event ticker (one line, newest, click to open the log)      |  28px
+-------------------------------------------------------------+
```
Left aligned. The palette is a building directory board: groups as bold rows, then a tile per tool (since 0.4.3): the room's own day art as a 72 by 36 thumbnail, the name at 14 px, the footprint and cost at 12 px, 88 px tall. Selected is amber with `aria-pressed`; locked is dim with `aria-disabled`, still focusable, showing the stars needed and a 4 px bar of stars now over stars needed; unaffordable shows the cost in alert with "Short $X" and stays selectable. On phone width the palette becomes a bottom sheet with two tiles to a row, 104 px tall.

Status bar (since 0.4.3), 56 px, readouts as hairline separated columns of label, value (20 px readout face) and meta (12 px): cash with its change since the quarter began, population with an arrow and its change since midnight (a dash until the first boundary on an older save), six star icons with a tooltip of the next star's requirements, a 24 hour dial (midnight at the top, 23:00 to 06:00 shaded) with the time and date, then the night mode ("Night x8, effective x16") beside the speed buttons, Share and Menu. On a phone: two 56 px rows, cash, population and stars, then the clock and the controls.

Icons: one inline SVG symbol sheet in the DOM, referenced by `<use>`, no icon font, 16 px line drawings in the current color. Every panel header is section icon, title and Close; the icon never stands without its words.

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
5. Structural pixel art at integer scales (illustrated textures are smooth by design and sample linear): `antialias: false`, `roundPixels: true`, zoom steps snap to 0.5, 1, 2, 3 for crisp rendering, free zoom between them allowed while the wheel is moving. Since 0.4.0 zoom 1 is the opening view (a floor is 72 css px, as zoom 2 was on the 8 px grid) and the furthest out is 0.175 (a floor 12.6 css px, unchanged).
