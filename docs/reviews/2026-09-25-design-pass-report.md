# Design pass report, 2026-09-25

Art direction review of the game and design critique of the site, with a ranked polish backlog. Read only: nothing was run, edited or captured for this report. Every finding names the file and the code or text it changes; findings drawn from code alone say so in their Evidence line.

## 1. Scope

I looked at every image the brief names that exists on disk, before reading any render code, then read the documents and code in the brief's order. The shipped chrome matches the 2026-09-24 UI polish spec (floating glass pills, a left dock and a phone build sheet, cards and bottom sheets, toasts and a News panel), not the flat directory board with an event ticker that docs/VISUAL.md still describes. It departs from the approved spec in one place: the phone top bar is two rows where the spec asks for one (D-31, D-43).

| Looked at | What |
| --- | --- |
| Contact sheet, captured | game-desk-z1-1300, -2300, -1300-dock, -1300-person, -1300-settings, -1300-views; game-phone-z1-1300, -1300-sheet; site-home-desk-light, site-home-desk-dark, site-home-phone-light, site-guide-desk-light (12) |
| Contact sheet, on disk | public/og.png, public/icons/icon-512.png, public/icons/icon-192.png |
| Earlier sets (older chrome or none) | baseline-2026-09-23 (4), illustrated-2026-09-23 (12), weather-2026-09-23 (10), rollout-2026-09-23 (10) |
| Render code | palette, grid, art, light, sky, illustrated, figure, person, venue, interiors, curb, hierarchy, weather, weatherfx, anim, ambient, buildfx, overlays, renderer; also camera, thumbnail, smoke |
| Chrome code | ui.css, ui.ts, status, palette, panels (query shell, settings, sound, share), cards, hover, icons, layout, onboarding (head), alerts (head), vip (head), toast, build, minimap |
| Site | index.html, how-to-play, privacy (head), 404.html, site.css, hero.ts, theme.ts, fonts.css, public/_headers, docs/LANDING-SPEC.md, make-og.mjs, make-icons.mjs, make-store-shots.mjs |

Not seen, and why. I describe none of these as if seen.

| View | Why not seen |
| --- | --- |
| game-desk-z1-1300-room | The restaurant sat outside the band under the top bar at the opening view (NOT-CAPTURED.md). |
| game-desk-z1-0900-fire | No dev hook raises a fire; the fire card and the fire engine at the curb are unseen with the current chrome. |
| game-desk-z1-1300-ghost | The Office tile sits under another dock tab; the ghost fill, outline and placement chip are unseen in every set. |
| game-phone-z1-1300-person | The waiting worker sat outside the band; the phone person card is unseen. |
| site-404-desk-light | vite preview serves the landing page for unknown paths. |
| Desktop at 09:00, at dusk and at dawn | Not in the fixed list; dusk and dawn findings (D-9, D-15) are from code. |
| Phone at night with the current chrome | Not in the fixed list; the older phone night shots show the world only. |
| Any light theme game screen | Every game shot is dark theme; D-25 is from code. |
| Zoom 0.5 with illustrated people; any zoom but 1 with the current chrome | Not in the fixed list; rollout close shots show zoom 2 and 3 with the old chrome. |
| All motion (walk, doors, rain, toasts, fades) | Stills only; motion findings are from code. |
| Overcast and storm with the current weather art | The weather set predates visible rain; the sheet has rain only. |
| Guide on phone, guide in dark, privacy page | Not in the fixed list. |
| News, finances, stories, recap, chronicle, daily, VIP, alert and star cards | Not in the fixed list. |
| Reduced motion | Not in the fixed list. |

Capture notes that affect how the sheet reads:

| Note | Cause found in code |
| --- | --- |
| Opening, dock and views shots at 13:00 are much darker than the person and settings shots at the same hour and weather | The renderer's load fade (a black cover driven by the ticker's capped frame time) was still running; see D-2. |
| The elevator hover card in the person shot reports 6 people waiting 281 minutes | The sheet script moves the fixture's clock to the shot's hour without ticking, so every waitStart is hours old. A capture artifact, not the game. |

## 2. Verdict

To a stranger, Hundred Stories looks like a well made dollhouse seen through a screen door. The illustrated rooms and people charm up close, but the first frame is a wall of identical blue window strips, a barcode of lobby tiles and a gray stair zigzag, roof cut off, concrete below. At night the tower turns lavender instead of glowing, and its few lit windows come out olive. The chrome is calm, though two solid amber controls outshine the tower, and on a phone it crowds the top and bottom of the screen. The landing page can open on a black box; the link preview and icon still sell the old pixel game.

Three things are most in the way: repetition out-shouts the rooms, the night has no light in it, and the front door does not show the game.

After the hero tier, the first frame is a bright building with its roofline in the sky, rooms that read before their windows and a lobby that reads as one hall. At night occupied floors glow and empty ones go dark. The site opens on that tower in daylight, and a shared link shows it.

## 3. If you only do ten things

1. D-4: Light the night: lit windows, lamps, signs and car indicators glow above the night tint, and empty rooms go dark
2. D-5: Calm the daytime window band so the rooms lead
3. D-11: Draw a lobby run as one hall, not a fence of one tile cells
4. D-1: Frame the opening on the building, so its roofline and sky show when they fit
5. D-34: Open the landing page on a daytime sky, never a black box or a squeezed pitch
6. D-35: Compose the hero: a daytime clock and a smaller, varied tower beside the copy
7. D-36: Make the link preview show the illustrated tower
8. D-2: Run the load fade on the wall clock, from the chrome's steel, after the first frame is drawn
9. D-31: Give the phone one row at the top and put speed and Menu under the left thumb
10. D-14: Make placing a room feel like switching it on

## 4. Findings by lens

Tiers: hero changes the first second, strong the first ten minutes, polish is felt but not noticed. No finding adds a baked texture to the game; see L9.

## L1, first read

Three shots show a first read with the current chrome: the desktop at noon and at night and the phone at noon. On the desktop the eye goes to amber first; on the phone it goes to the stairs. In all three the tower's repeated patterns come before its rooms, so it reads as a texture before it reads as a building.

| Shot | First second | Next | What competes | A stranger would think |
| --- | --- | --- | --- | --- |
| game-desk-z1-1300 | The solid amber pause disc, then the blue window strips | The stair zigzag, the lobby barcode | Amber pause disc, amber dock tab, the wide Next card | A management sim of many small identical rooms |
| game-desk-z1-2300 | The amber Paused chip and pause disc | Two warm condo strips and the lobby strip | The amber chip | The lights are off; nothing is happening |
| game-phone-z1-1300 | The gray stair zigzag down the middle | The amber Build button | Two rows of chrome at the top, the map, a toast and the Next card at the bottom | A cute room builder, seen through a frame |

### D-1: Frame the opening on the building, so its roofline and sky show when they fit

Lens: L1

Tier: hero

Evidence: game-desk-z1-1300 and game-desk-z1-2300; the street sits about two thirds down, the top floors run under the top bar with no sky, and the lower third is basement and bare concrete. game-phone-z1-1300 shows the same framing with the bottom quarter under a toast, the Next card and the Build button.

Now: src/render/renderer.ts frameInitial calls camera.reset(), camera.centerOn(6, averageRoomX) and camera.setGroundLine(DEFAULT_GROUND_LINE), a fixed 0.68 of the free band (src/render/camera.ts), whatever the tower's height.

Change: 1) In src/render/camera.ts add and export `openingGroundLine(topFloor: number, bandPx: number, zoom: number, phone: boolean): number` returning `clamp(((topFloor + 1) * FLOOR_PX * zoom) / bandPx, DEFAULT_GROUND_LINE, phone ? 0.8 : 0.9)`; an empty lot or a short tower still gets 0.68. 2) In src/render/renderer.ts keep the top inset passed to setChrome in a local `chromeTop` (0 until called). In frameInitial compute `topFloor` as the highest `room.floor + room.height - 1` over lastWorld.rooms and `shaft.floorMax` over lastWorld.shafts, at least 1; `bandPx = app.screen.height - chromeTop`; `phone = app.screen.width <= 720`; call `camera.setGroundLine(openingGroundLine(topFloor, bandPx, camera.zoom, phone))` in place of DEFAULT_GROUND_LINE. Home and setChrome already call frameInitial. 3) Add cases to tests/render/camera.test.ts: topFloor 3 at band 810 gives 0.68; topFloor 7 gives 0.711; topFloor 17 gives 0.9; phone topFloor 17 gives 0.8.

Why it reads better: The first frame shows a building with a top edge against the sky instead of a wall of rooms over concrete, which is the silhouette the direction calls the one bold element.

Cost: S; texture bytes: none; shares: setGroundLine and the chrome band already measured.

Verify: Retake game-desk-z1-1300 and game-phone-z1-1300: the street sits at 90 percent of the band on desktop (80 on phone) and about one basement floor shows; on a tower of seven floors or fewer (new capture) a strip of sky one floor tall shows over the roof.

### D-2: Run the load fade on the wall clock, from the chrome's steel, after the first frame is drawn

Lens: L1

Tier: hero

Evidence: game-desk-z1-1300, game-desk-z1-1300-dock and game-desk-z1-1300-views are markedly darker than game-desk-z1-1300-person and game-desk-z1-1300-settings at the same hour and weather; site-home-desk-dark and site-home-phone-light show the hero tower half dark. The load fade is the only full canvas darkening in the code path at 13:00.

Now: src/render/renderer.ts draws `fadeCover`, a black rect over the whole stage, and onFrame lowers it by `fadeLeft -= app.ticker.deltaMS` from LOAD_FADE_MS 900. PixiJS caps deltaMS at 100 ms a frame (minFPS 10) and the first frames bake every window state (bakeRoomStates) and every interior, so on a slow device the fade stretches over seconds of dark tower.

Change: In src/render/renderer.ts: 1) add `let firstRendered = false`, set true at the end of the first `render()` call; 2) replace `fadeLeft` with `let fadeStart: number | null = null`; in onFrame, once firstRendered, `fadeStart ??= performance.now()`, `alpha = Math.max(0, 1 - (performance.now() - fadeStart) / LOAD_FADE_MS)`, then `fadeCover.clear(); fadeCover.rect(0, 0, width, height).fill({ color: 0x1c232e, alpha })`, hiding it at alpha 0; 3) before firstRendered draw the cover at alpha 1 in 0x1c232e (the chrome steel), so the page never shows black; 4) reduced motion keeps no fade (cover hidden once firstRendered); 5) add `fadeIn?: boolean` to RendererOptions, default true, false skips the cover (used by D-34). Update VISUAL.md Motion to "fades from the chrome steel".

Why it reads better: The one page-load moment stays a 900 ms reveal on any device instead of a dim gray tower for the first seconds, and it opens out of the chrome's own color rather than a black frame.

Cost: S; texture bytes: none; shares: fadeCover.

Verify: Retake game-desk-z1-1300 and game-desk-z1-1300-dock; both match game-desk-z1-1300-person in brightness. Measurement: with the CPU throttled six times, fadeCover is hidden 900 to 1000 ms after the first render.

### D-3: Keep solid amber for the primary action; pressed toggles wear an amber ring

Lens: L1

Tier: strong

Evidence: game-desk-z1-1300: the solid amber pause disc and the solid amber Structure tab on the dock rail are the two brightest shapes in the frame; game-phone-z1-1300 has the amber disc at the top and the amber Build button at the bottom.

Now: src/ui/ui.css `.hs-speed-btn[aria-pressed='true']` and `.hs-build-tab[aria-selected='true']` set `background: var(--amber); color: var(--on-amber)`; one of each is always pressed, so two amber blocks are always on screen.

Change: In src/ui/ui.css set both rules to `background: rgba(244, 185, 66, 0.18); color: var(--amber-text); box-shadow: inset 0 0 0 2px var(--amber-text);` (token from D-25; use var(--amber) until D-25 lands). Add `.hs-speed-btn[aria-pressed='true'][aria-label='Pause'] { background: var(--amber); color: var(--on-amber); box-shadow: none; }` so a stopped game still shows it. Keep solid amber on `.hs-tool[aria-pressed='true']`, `.hs-build-fab`, `.hs-place-btn.is-primary` and `.hs-btn.is-primary`. The phone category pills take the ring rule too.

Why it reads better: The eye goes to the tower first, and amber keeps its stated meaning of signage and primary action instead of marking which speed is on.

Cost: S; texture bytes: none; shares: existing tokens.

Verify: Retake game-desk-z1-1300-dock (the sheet is paused, so pause stays solid): the Structure tab shows a ring, not a block; a new running capture shows no solid amber in the top bar. Icon contrast 4.67:1 on the dark glass.

## L2, color and light

The world palette is two systems that never meet. The room walls are near white tints chosen one at a time, so at zoom 1 an office, a condo and a hotel room read the same, and color lives only in the furniture. The far zoom BLOCK colors are a coherent district family, but nothing at zoom 1 prepares the eye for them, and the minimap uses a third palette. The sky ramps are coherent. The night is neither beautiful nor dark: it is the day scene under a lavender multiply, which flattens the illustrated interiors, keeps empty rooms as bright as occupied ones and turns the lit windows olive, so the lit windows do not carry the composition. Dusk was not captured; in code the tower warms before the sky does. The dark chrome against a bright world works by day; at night it holds only because the world never gets dark.

| Hour | World behind the chrome | Separation | Seen in |
| --- | --- | --- | --- |
| 13:00 | Bright rooms (dim only while the load fade runs) | Strong | game-desk-z1-1300-person |
| 23:00 | Lavender rooms, navy sky | Holds over rooms, weak over sky | game-desk-z1-2300 |
| Dusk, dawn | Not seen | Not seen | None |

### D-4: Light the night: lit windows, lamps, signs and car indicators glow above the night tint, and empty rooms go dark

Lens: L2

Tier: hero

Evidence: game-desk-z1-2300: every room is the day scene under a lavender wash; the few lit window strips are a dull olive and empty rooms are as bright as occupied ones. illustrated-2026-09-23/after-desktop-22 and rollout-2026-09-23/desktop-22 show the same.

Now: src/render/renderer.ts puts one multiply sprite (layers.light, LIGHT_ALPHA 0.4, night tint #6078b0) over worldRoot, and everything that should give light sits under it: the lit panes baked into the shells (art.ts drawWindowBand, #ffd866 comes out near #bfaa59), the pools (venuePoolLayer, POOL_ALPHA 0.5), the sign glows and the car indicator LEDs (indicatorLayer). Room sprites are tinted only for fire (reconcileRooms).

Change: In src/render/renderer.ts createRenderer: 1) add `const emissiveRoot = new Container()` labeled 'emissive'; stage order `layers.sky, layers.cityFar, layers.cityNear, worldRoot, layers.light, emissiveRoot, overlayRoot`; in onFrame give it worldRoot's scale and position. 2) Move `venuePoolLayer`, `indicatorLayer` and `markLayer` into emissiveRoot, in that order; set each pool glow sprite's `blendMode = 'add'` and change src/render/illustrated.ts POOL_ALPHA to 0.35. 3) Add `signGlowLayer` and `signLitLayer` Containers to emissiveRoot; syncVenue parents signGlow to signGlowLayer with `blendMode = 'add'` and alpha 0.8, and makes a second Sprite on the same sign texture in signLitLayer, visible only when updateVenues computes sign state 'lit'. 4) Add Graphics `litHalo` (blendMode 'add') then `litPanes` to emissiveRoot. In reconcileRooms at night clear both, then for every room with hasWindowBand(kind) in state 'lit', for each floor f (y = floorTopY(f)) and each pane x = WIN_PANE_X + 16n while x + 14 <= width: `litPanes.rect(px + x, y + 6, 12, 12).fill(0xffd866)` and `litPanes.rect(px + x, y + 6, 12, 2).fill(0xfff3b0)`; in state 'housekeeping': `litPanes.rect(px + x, y + 14, 12, 4).fill({ color: 0xffd866, alpha: 0.55 })`; one `litHalo.rect(px, y + 4, width, 16).fill({ color: 0xffd866, alpha: 0.12 })` per lit floor. Skip panes whose tile column lies inside a shaft on that floor or inside a stairs or escalator room covering that floor. By day clear both. 5) Night grade: export `NIGHT_GRADE = { day: 0xffffff, lit: 0xffffff, vacant: 0x9aa5c6, housekeeping: 0xb4bcd6 }` from src/render/light.ts; in reconcileRooms set `entry.node.tint = room.onFire ? 0xff8a72 : night ? NIGHT_GRADE[state] : 0xffffff` and apply the same tint to the room's VenueEntry fixtures, decor, wall, staff and closed sprites. 6) In VISUAL.md, the light line becomes: the multiply grades everything but the ghost, the selection and the emissive layer.

Why it reads better: At night the tower becomes a lantern: occupied floors glow warm and empty ones fall back, so lit windows carry the composition as the original's night did.

Cost: M; texture bytes: none (Graphics, and a second sprite on existing sign textures); shares: the glow texture, sign textures, pane geometry from grid.ts.

Verify: Retake game-desk-z1-2300: a lit pane samples at or above #f0cc58 (today about #bfaa59); a vacant office wall is visibly darker than a lit condo wall (luminance ratio at least 1.4); shuttered shops stay dim; ghost and selection colors unchanged.

### D-5: Calm the daytime window band so the rooms lead

Lens: L2

Tier: hero

Evidence: game-desk-z1-1300-person and game-phone-z1-1300: the blue pane strip with black mullions on every floor is the loudest repeated pattern on screen, and every pane carries the same white corner glint. The 2026-09-23 direction review named this band; the veil in hierarchy.ts mutes it only below zoom 0.75.

Now: src/render/art.ts drawWindowBand, state 'day', fills every pane #7fb6e0, draws mullions in INK #222222 (7.33:1 against the pane) and adds two white 55 percent glint boxes to every pane.

Change: In src/render/palette.ts add `windowMullionDay: 0x506274` and `windowDayGlint: 0xb3d6f0`. In src/render/art.ts pass the floor index f from drawShell into drawWindowBand. For state 'day' only: fill pane n (n = (x - WIN_PANE_X) / TILE_PX) with `(n + 2 * f) % 5 === 2 ? PALETTE.windowDayGlint : PALETTE.windowDay`; draw both mullions in PALETTE.windowMullionDay; delete the two glint boxes. Keep the head rail and sill in INK and leave the 'lit', 'vacant' and 'housekeeping' states as they are. Day shells rebake under the same keys.

Why it reads better: The band still reads as glass under a dark head rail, but it stops out-shouting the illustrated interiors, and the staggered lighter panes read as reflected sky rather than a printed stripe.

Cost: S; texture bytes: none (same keys and sizes); shares: the day shell textures.

Verify: Retake game-desk-z1-1300-person and game-phone-z1-1300: mullion to pane contrast 2.90:1; at arm's length the eye lands on furniture before the window strip.

### D-6: Put stars in the clear night sky

Lens: L2

Tier: strong

Evidence: game-desk-z1-2300 and weather-2026-09-23/desktop-clear-22: the night sky is a flat navy gradient; the direction review's weather table asks for clear stars on a clear night.

Now: src/render/sky.ts createSky draws the gradient, hills, roofs and clouds; nothing is added at night.

Change: In src/render/sky.ts createSky add `const stars = new Graphics()` to layers.sky right after the gradient. Build it once from `createRng(0x57a25)`: 90 dots in a 2048 by 640 css px field, radius `0.6 + rng.int(0, 6) / 10`, fill `{ color: 0xffffff, alpha: 0.4 + rng.int(0, 5) / 10 }`. In update: `stars.alpha = nightness(minuteOfDay) * Math.max(0, 1 - (0.7 * w.overcast + w.rain + w.storm))` from the weather view weights; x = `-((cam.x * cam.zoom * 0.05) % 2048)`, drawn twice side by side so it tiles; the field's bottom at `bandBaseY(street, viewH, CLOUD_PARALLAX) - 60`. No motion of its own.

Why it reads better: The night gets depth and a reason to look up, and weather reads by the stars going out.

Cost: S; texture bytes: none; shares: the sky layer and the weather view.

Verify: New capture game-desk-z1-2300 on a clear night: stars above the hills, none under clouds.

### D-7: Give every room a thin floor line in its district color, so zoom 1 teaches the far zoom colors

Lens: L2

Tier: strong

Evidence: game-desk-z1-1300-person: office, condo and hotel walls (#f7f5ee, #f2e8d8, #eef2f7) read the same; illustrated-2026-09-23/after-far-13 and rollout-2026-09-23/far-13: at far zoom the same rooms become saturated blue, tan, violet, green and orange blocks with nothing at zoom 1 that prepares the eye.

Now: src/render/art.ts drawShell paints wall, shadow face, window band and slab; src/render/palette.ts BLOCK is used only by renderer.ts rebuildBlocks.

Change: In src/render/art.ts drawShell, for every kind except lobby, skyLobby and the overlay kinds, after each floor's slab draw `box(g, LINE_PX, sy - 2, w - 2 * LINE_PX, 2, BLOCK[kind])` (y 64 to 65, just above the slab edge). Import BLOCK from palette.ts. The illustrated layer draws over it, so furniture legs stand on the line.

Why it reads better: A player learns offices blue, homes warm, hotels violet, food orange and shops green from the rooms themselves, and the far blocks read as the same tower rather than a chart.

Cost: S; texture bytes: none (same keys, rebaked); shares: BLOCK.

Verify: Retake game-desk-z1-1300-person: each room shows a 2 px floor line in its BLOCK color; the lobby shows none.

### D-8: Let the far zoom blocks glow where people are at night

Lens: L2

Tier: strong

Evidence: illustrated-2026-09-23/after-far-22 and rollout-2026-09-23/far-22: at night the far tower is the day chart made darker, with no light anywhere; illustrated-2026-09-23/before-far-22 at least showed lit strips.

Now: src/render/renderer.ts rebuildBlocks fills each block in BLOCK[kind] and its occupancy in a lighter tint (BLOCK_FILL_LIFT 0.45), all under the night multiply.

Change: rebuildBlocks takes `night` (isNight of the world's minute of day). At night draw the base block as `lerpColor(BLOCK[kind], 0x0d1b3d, 0.45)` and skip the lighter occupancy fill. Add Graphics `blockGlow` to emissiveRoot (D-4), visible only when plan.blocks and night, rebuilt with the blocks: for each room with occupancy level above 0, `rect(x, y + bh * (1 - level), bw, bh * level).fill({ color: 0xffd678, alpha: 0.85 })`. By day blockGlow is hidden and blocks draw as now.

Why it reads better: From far away at night the tower shows its life as warm light instead of a dimmed diagram.

Cost: S; texture bytes: none; shares: rebuildBlocks, the emissive root.

Verify: New capture at zoom 0.25 at 22:00 framed like rollout-2026-09-23/far-22: occupied blocks glow amber from the floor up, empty blocks are dark navy.

### D-9: Warm the tower with the sky's dusk, not before it

Lens: L2

Tier: polish

Evidence: Not in the sheet (no dusk shot). From code: the tower tint peaks warm at 18:00 while the sky keeps full day blue until 18:00 and peaks at dusk at 18:30.

Now: src/render/light.ts TINT_ANCHORS ramps noon to evening from 17:00 to 18:00 and to night by 19:00, dawn from 05:00; src/render/sky.ts KEYFRAMES put dusk at 18:00 to 19:00 and dawn at 05:30 to 06:30.

Change: src/render/light.ts TINT_ANCHORS minutes and colors: 0 night, 330 night, 360 dawn #bfd8ff, 405 noon, 1050 noon, 1110 evening #ffd0a0, 1155 night, 1440 night. Update tests/render/light.test.ts.

Why it reads better: Warm light reaches the rooms with the orange sky, so dusk reads as one moment.

Cost: S; texture bytes: none; shares: lightTintAt.

Verify: New capture game-desk-z1-1830: the sky's lower gradient and the tower tint are warm in the same frame.

### D-10: Give the glass controls an inset hairline so they hold at night

Lens: L2

Tier: polish

Evidence: game-desk-z1-2300: where a pill crosses the navy sky its soft shadow disappears; D-4 darkens the night tower further.

Now: src/ui/ui.css `.hs-status-pill, .hs-speed, .hs-round, .hs-speed-mode, .hs-pill-btn` use `box-shadow: var(--shadow-1)` only.

Change: Add `--glass-edge: rgba(232, 236, 242, 0.10)` to :root and `rgba(21, 28, 37, 0.10)` in both light theme blocks; set those selectors and `.hs-news-toast` to `box-shadow: var(--shadow-1), inset 0 0 0 1px var(--glass-edge);`.

Why it reads better: The controls keep a quiet edge on a dark tower and a dark sky, so chrome and world stay two layers at every hour.

Cost: S; texture bytes: none; shares: glass tokens.

Verify: Retake game-desk-z1-2300: a faint light edge on each pill over navy; by day it is invisible.

## L3, form and silhouette

People hold up. At zoom 1 the six wardrobes read by color and prop (the guard's navy and cap, the collector's vest, the housekeeper's teal and apron), the builds differ only a little, and faces are skin discs, which is right at this size; zoom 0.5 was not captured. At zoom 2 and 3 (rollout close shots) the outlines stay clean; only the structural window panes turn to coarse squares. Offices, condos, the cinema, the medical center, the metro and the recycling center have the right density. The hotel rows read as wallpaper and the lobby as a fence. The elevator car is the most saturated object in the tower and reads as the second hero even though its shaft is faint. The curb adds life at the frame's edges and is small in every shot. The far zoom carries shape and district at a glance but reads as a chart and dies at night (D-8, BB-2).

### D-11: Draw a lobby run as one hall, not a fence of one tile cells

Lens: L3

Tier: hero

Evidence: game-desk-z1-1300-person and game-phone-z1-1300: the ground lobby reads as a barcode of dark vertical lines and darker strips at every tile, over its column and palm rhythm; the far zoom already outlines a lobby run once (rebuildBlocks).

Now: Lobby and sky lobby rooms are one tile wide. src/render/art.ts drawShell paints a 4 px shadow face (LOBBY_SHADOW_PX) at the right of every tile, drawWindowBand darkens the pane over it, and drawCellOutline boxes every tile in a 2 px #222222 outline.

Change: 1) src/render/art.ts: for LOBBY_KINDS skip the shadow face box in drawShell and the shaded glass box in drawWindowBand. 2) drawCellOutline: for LOBBY_KINDS draw only the top and bottom 2 px lines (per floor for lobby; top of the first and bottom of the last floor for skyLobby). 3) src/render/renderer.ts: add Graphics `lobbyEdges` to layers.tower right after roomLayer; in reconcileRooms group lobby and skyLobby rooms into runs by (floor, height) where the next room's x equals the run's end; for each run with left edge xl, right edge xr (world px), top y and height h: `rect(xl, y, 2, h).fill(0x222222)`, `rect(xr - 2, y, 2, h).fill(0x222222)`, and per floor top yf `rect(xr - 10, yf + 22, 8, 44).fill(0xd7d7d4)` as the run's shadow face.

Why it reads better: The floor where every trip starts reads as one marble hall with a column rhythm, and the dark outline stays where it belongs, around the room.

Cost: S; texture bytes: none (same lobby keys); shares: the run grouping in rebuildBlocks.

Verify: Retake game-desk-z1-1300-person: inside a lobby run no vertical dark line shows except at shafts and at the run's two ends.

### D-12: Let stacked stairs recede at zoom 1

Lens: L3

Tier: strong

Evidence: game-phone-z1-1300 and game-phone-z1-1300-sheet: the stacked flights make a gray zigzag down the middle of the phone screen, the largest shape in view; game-desk-z1-1300 shows the same diagonal through the tower's center.

Now: src/render/hierarchy.ts layerPlan gives connectors 1 at zoom 0.75 and up; src/render/interiors.ts drawStairs draws a 2.5 px #5a6472 handrail with a post every third step.

Change: 1) src/render/hierarchy.ts: add `export const CONNECTOR_ALPHA_FULL = 0.85` and return it for connectors in the full tier. 2) src/render/interiors.ts drawStairs: handrail '#8a97a8' at width 2; posts only at i = 0 and i = steps. The flight keeps its #c4c9d1 fill and 2 px #222222 outline. Update tests/render/hierarchy.test.ts.

Why it reads better: The stairs stay a clear path, and the rooms and people beside them lead, as the direction review asked of shafts and stairs.

Cost: S; texture bytes: none (the stairs texture rebakes under its key); shares: the connector layer's alpha.

Verify: Retake game-phone-z1-1300: the eye lands on the rooms either side of the flight before the flight.

### D-13: Break the hotel row's repetition with painted walls and mirrored rooms

Lens: L3

Tier: strong

Evidence: game-desk-z1-1300-person, second floor from the top: one single room, bed, nightstand and picture, repeated across the floor.

Now: src/render/interiors.ts INTERIORS hotelSingle, hotelTwin and hotelSuite have `variants: HOTEL_VARIANTS` (1), no looks and no `flips`.

Change: In src/render/interiors.ts add `HOTEL_LOOKS` with four looks per hotel kind, all `base: 0` and `decor: []`, walls: single [null, P.mist, P.blush, P.sage]; twin [null, P.butter, P.lilac, P.mist]; suite [null, P.slate, P.clay, P.sage]. Set each hotel spec to `variants: 4, bases: 1, looks: HOTEL_LOOKS[kind], flips: true`. interiorVariant keeps `mod(room.id, n)` and interiorFlip mirrors by hash. Update tests/render/interiors.test.ts.

Why it reads better: A hotel floor reads as a row of different guests' rooms, with no new texture.

Cost: S; texture bytes: none (walls are Texture.WHITE tinted; mirroring is the sprite's); shares: the paint tokens and the look system.

Verify: Retake game-desk-z1-1300-person: neighboring hotel rooms differ in wall color or facing.

## L4, motion and game feel

Motion is judged from code, since stills show none. The walk cycle has a hitch; the waiting shift and glance are well timed; the doors tween on three baked frames and read; the car stops dead with no settle; the build feedback is small and fast and the price lives in the chrome chip, so placing a room gives little back in the world. Clouds and rain run on real time and stop or slow correctly under reduced motion. The page-load fade stretches on slow frames (D-2). The cheapest unclaimed idle is the tower lighting up at dusk, which VISUAL.md promises and nothing builds; signs and marquees blink in lockstep. Motion outside the rule: routine news toasts rise into view without the player acting (D-19).

### D-14: Make placing a room feel like switching it on

Lens: L4

Tier: strong

Evidence: Not in the sheet (game-desk-z1-1300-ghost was not captured). From code: the world's only answer to a placement is a 4 px settle, a 200 ms white flash and six 2 px specks over 300 ms.

Now: src/render/buildfx.ts buildFxAt and createBuildFx run the settle, flash and dust; src/render/renderer.ts reconcileRooms starts them for a room placed this frame.

Change: 1) src/render/buildfx.ts start() gains `bands: { y: number; h: number }[]` (each floor's window band, y = floorTop + WIN_TOP, h = WIN_SILL + LINE_PX - WIN_TOP; empty for kinds without a band) and `label: string`. Per band add a Sprite of Texture.WHITE tinted 0x2a3550 covering `x + revealed` to `x + w`, `revealed = w * (1 - (1 - k) * (1 - k))`, `k = Math.min(1, t / 360)`. 2) Add src/render/led.ts: move the 3 by 5 digit map out of renderer.ts drawIndicator, add '-': [0,0,7,0,0], ',': [0,0,0,2,4], '$': [7,6,7,3,7], and `drawLedText(g, text, x, y, cell, color)`; drawIndicator imports it. 3) The floater: a Graphics on layers.overlay (above the light layer): a 0x1c1f26 plate as wide as the text plus 8, 18 tall, then `drawLedText(g, label, x + 4, y + 4, 2, 0xffb347)` with label `'-$' + ROOMS[kind].cost.toLocaleString('en-US')`, centered 8 px over the room's top; it rises 16 px over 900 ms and fades from 600 to 900 ms. 4) BUILD_FX_MS becomes 900. All of it stays off under reduced motion, as now.

Why it reads better: The room answers the click in the world, its windows lighting left to right and its price dropping out of it in the elevator indicator's own face.

Cost: M; texture bytes: none (Graphics and Texture.WHITE); shares: the indicator digit map, buildfx timing.

Verify: After the sheet script can open the dock tab that holds the Office tile, capture a placement at 0, 200 and 600 ms; measurement: tests/render/ambient.test.ts (which holds the build feedback timing) asserts the reveal is 75 percent of w at 180 ms.

### D-15: Light the tower window by window at dusk, and put it out the same way at dawn

Lens: L4

Tier: strong

Evidence: Not in the sheet (no dusk shot). From code: when nightness reaches 0.5 every room changes state on the same frame; VISUAL.md Motion promises "window flicker at dusk" and nothing implements it.

Now: src/render/light.ts windowStateOf takes one `night` flag for the tower; src/render/renderer.ts reconcileStaticTower reconciles on lightBand, one value all day and one per game hour at night.

Change: 1) src/render/light.ts: add `export function roomNight(seed: number, roomId: number, minuteOfDay: number): boolean` with `h = mix((seed | 0) ^ 0x51ed27, roomId)` (venue.ts mix), `on = 1095 + (h % 45)`, `off = 330 + ((h >>> 8) % 45)`, returning `m >= on || m < off`. 2) lightBand returns `10000 + Math.floor(m / 5)` while m is in 1080 to 1155 or 315 to 390, else as now, so the reconcile runs every five game minutes then. 3) renderer.ts reconcileRooms passes `roomNight(w.seed, room.id, minuteOfDay)` to windowStateOf per room, and computes floorsWithPeople whenever the global night or either window is on. Pools and signs keep the global flag. Every state is baked at boot (bakeRoomStates), so this only swaps textures.

Why it reads better: The tower comes on like a real building across the dusk hour, the most watchable idle there is, and goes out the same way at dawn.

Cost: S; texture bytes: none; shares: bakeRoomStates' pre-baked states.

Verify: New capture game-desk-z1-1830: some occupied rooms lit, others still showing day panes; measurement: tests/render/light.test.ts asserts no room takes a night state before 18:15 and every room does by 19:00.

### D-16: Walk on four beats instead of three

Lens: L4

Tier: strong

Evidence: Motion is not visible in stills. From code: the cycle is stand, stride, mirrored stride, so one step passes through the standing frame and the next does not, a hitch every third frame on every walker.

Now: src/render/anim.ts walkFrameAt returns `t % 3` over SIM_FRAMES [0, 1, 2] at WALK_FRAME_MS 120.

Change: src/render/anim.ts: add `const WALK_SEQUENCE: readonly SimFrame[] = [0, 1, 0, 2]` and return `WALK_SEQUENCE[t % 4]`; in poseAt use `phaseOf(id, WALK_FRAME_MS * 4)`; in src/render/curb.ts change the walk phase offset to `% 480`. Update tests/render/anim.test.ts.

Why it reads better: Every step passes through the standing frame, so hundreds of walkers stride evenly instead of limping.

Cost: S; texture bytes: none (frames already baked); shares: the person textures.

Verify: Measurement: over 960 ms the frames are 0, 1, 0, 2, 0, 1, 0, 2.

### D-17: Give each sign and marquee its own rhythm

Lens: L4

Tier: polish

Evidence: From code: every shop sign strip blinks on one shared clock, 900 ms on and 900 ms off, every cinema marquee steps in unison, and steam is three 2 px squares.

Now: src/render/ambient.ts createAmbient update computes one `lit` and one marquee color for all emitters; STEAM_PX 2.

Change: In src/render/ambient.ts: per emitter `phase = mix(e.roomId) % 3000` (anim.ts mix); a sign is lit unless `(clock + phase) % 3000` is in 2600 to 2720 or 2840 to 2920 (a neon stutter, on most of the time); marquee color `marqueeColour(clock + (phase % 1800))`; STEAM_PX 3. No emitters under reduced motion, as now.

Why it reads better: The small lights feel like separate businesses rather than one clock.

Cost: S; texture bytes: none; shares: Texture.WHITE strips.

Verify: Measurement: tests/render/ambient.test.ts asserts two shops with different ids are not both off at one clock value.

### D-18: Let a car settle a pixel when it arrives

Lens: L4

Tier: polish

Evidence: From code: a car stops on the tick and opens its doors; REVIEWS.md records the car easing into a stop as deferred.

Now: src/render/renderer.ts drawCar places the car at the interpolated target and steps the doors.

Change: Add `settle: number` to CarEntry. In drawCar: `const wasOpen = entry.open; entry.open = open; if (open && !wasOpen && !reducedMotion) entry.settle = 120;` and place the sprite at `target.y + (entry.settle > 60 ? 1 : 0)`; in onFrame beside stepCarDoors, `entry.settle = Math.max(0, entry.settle - dt)`.

Why it reads better: The second hero lands instead of stopping dead.

Cost: S; texture bytes: none; shares: the car sprite.

Verify: Measurement: the car sits 1 px low for the first 60 ms after its doors open and level after.

### D-19: Let news arrive without moving, and drop its clock stamp

Lens: L4

Tier: polish

Evidence: game-desk-z1-1300-dock: the toast reads "Weekday 1 1:00 PM" before its sentence; the News panel was redone on 2026-09-25 with no clock stamps.

Now: src/ui/ui.ts refreshNews passes `time: formatTimestamp(minute)` to toastLayer.show; src/ui/ui.css @starting-style lifts `.hs-news-toast` by --toast-rise as it appears, though no player acted.

Change: In src/ui/ui.ts refreshNews remove the `time` option from both show() calls. In src/ui/ui.css split the @starting-style rule so `.hs-news-toast` starts at `opacity: 0` only; `.hs-alert-toast` keeps its rise.

Why it reads better: The chrome moves only when the player acts, and routine news speaks in the News panel's plain voice.

Cost: S; texture bytes: none; shares: the toast layer.

Verify: Retake game-desk-z1-1300-dock: the toast shows only its sentence.

## L5, chrome and type

The chrome is the polish spec's, well built: glass for controls, near solid surfaces for text, one radius family, 44 px targets. The status pill carries cash and the clock in Share Tech Mono, but in plain ink, so the segmented readout signature has faded to the green of one icon. The five sizes are used as tokens, but a reset rule makes button rows render a size smaller than div rows in the same list. Spacing sits on a four pixel rhythm with a few six and ten pixel paddings, not worth a finding. The chrome looks like a different designer from the world, soft glass against ink outlines; that contrast is intended and works. What does not work: two solid amber controls that are always on, a Next line said twice, and cards that land on the thing just clicked.

### D-20: Stop the button reset from shrinking the settings rows and the rent stepper

Lens: L5

Tier: strong

Evidence: game-desk-z1-1300-settings: "Today's tower", "New game" and the Saving rows are smaller than "Sound", "Music" and "Background" in the same sheet.

Now: src/ui/ui.css `.hs-ui button, .hs-ui input, .hs-ui select { font: inherit; }` outranks `.hs-set-row { font-size: var(--size-16) }` and `.hs-stepper-btn { font-size: var(--size-20) }`, so every button row renders at the inherited 14 px while div rows render at 16 px, and the rent stepper's plus and minus at 14 px.

Change: In src/ui/ui.css change that selector to `.hs-ui :where(button, input, select)`, keeping the reset with no specificity.

Why it reads better: One list, one type size; the scale works as a scale.

Cost: S; texture bytes: none; shares: none.

Verify: Retake game-desk-z1-1300-settings: every row label is 16 px; measurement: the stepper glyphs compute to 20 px.

### D-21: Bring back the one signature: the clock and the floor readout in the indicator face

Lens: L5

Tier: strong

Evidence: game-desk-z1-1300: cash and the clock are in the readout face but the same ink as everything else, green only on the cash icon; game-desk-z1-1300-person: "Floor 1" in the bar is in the UI face. baseline-2026-09-23/android-phone-1-tower shows the old green readouts.

Now: src/ui/ui.css `.hs-clock-digits` takes --ink; the hover readout (src/ui/ui.ts hoverReadout, class hs-status-hover) uses `.hs-readout-value` in Bricolage 600.

Change: In src/ui/ui.css add `.hs-clock-digits { color: var(--indicator); }` and `.hs-status-hover .hs-readout-value { font-family: var(--font-readout); font-weight: 400; letter-spacing: 0.02em; color: var(--indicator); }`. Cash stays ink, since green would read as a gain. Light theme --indicator per D-25.

Why it reads better: The elevator indicator face again marks the two readouts that tell time and place, the one signature the direction keeps.

Cost: S; texture bytes: none; shares: --indicator.

Verify: Retake game-desk-z1-1300-person: time and "Floor 1" are green, 8.90:1 on the dark glass over the brightest world.

### D-22: Say "Next" once: fold the collapsed goals card into a small progress pill

Lens: L5

Tier: strong

Evidence: game-desk-z1-1300 and game-desk-z1-2300: "Next: 2 stars" sits under the stars in the bar and again as a full width card title under Menu; game-desk-z1-1300-views: the Views popover lands on that card.

Now: src/ui/cards.ts createSideCard showGoals, when collapsed, keeps the card at --panel-w (360 px) with goals.title and Show.

Change: In src/ui/cards.ts showGoals, when collapsed set the head title to `Goals, ${done} of ${total}` (items with done true, over all items). In src/ui/ui.css add `.hs-card.is-collapsed { width: max-content; }` above 720 px. The stars readout keeps "Next: 2 stars".

Why it reads better: The top right goes back to the tower and each fact is said once.

Cost: S; texture bytes: none; shares: the side card.

Verify: Retake game-desk-z1-1300 and game-desk-z1-1300-views: the collapsed card is a short pill and the popover no longer covers it.

### D-23: Keep the selected person or room in view beside an open card, and keep the hover card out from under it

Lens: L5

Tier: strong

Evidence: game-desk-z1-1300-person: the selected worker's amber ring is half behind the Worker card at the lobby's right edge, and the elevator's hover card (waits and cars) sits under the card's lower edge.

Now: src/ui/ui.ts refreshPanel mounts the card without looking at the selection; src/ui/hover.ts hoverCardBox keeps the hover card clear of the top and bottom chrome only and shows it while a card is open.

Change: 1) src/render/renderer.ts: keep the last selection box drawn in drawOverlay and add `selectionScreenRect()` to Renderer, mapped through camera.worldToScreen as ghostScreenRect is. 2) src/render/camera.ts: add `easeX` mirroring `easeY` (FOLLOW_EASE_MS, instant under reduced motion) and `easeToX(x: number)`. 3) src/ui/ui.ts refreshPanel: after mounting a query panel at 900 css px and wider, `cardLeft = shellWidth - (panelW + 2 * edge)`; if `rect.x + rect.w > cardLeft - 24`, call `renderer.camera.easeToX(camera.x + (rect.x + rect.w - (cardLeft - 24)) / camera.zoom)`. 4) src/ui/hover.ts: createHoverCard takes `keepOutRight: () => number | null` (the open card's left edge); hoverCardBox flips the card left of the pointer when `left + card.width > keepOutRight - PLACE_GUTTER`; update hides the card while its target is the current selection.

Why it reads better: The thing clicked stays on screen next to its story, and cards never stack on cards.

Cost: M; texture bytes: none; shares: ghostScreenRect's mapping, the camera ease.

Verify: Retake game-desk-z1-1300-person: the ring sits fully left of the card with 24 px clear; no hover card under the card.

### D-24: Draw the build tiles larger and sharper, on sky instead of gray

Lens: L5

Tier: strong

Evidence: game-desk-z1-1300-dock: tile pictures are small, soft and sit on a gray placeholder fill; the stairs and escalator tiles are a thin line on gray. rollout-2026-09-23/palette-13 shows the same pictures reading better larger.

Now: src/ui/palette.ts THUMB_W 72 and THUMB_H 36 are stretched to the picture box (about 93 css px wide on the dock, 108 on the phone); src/ui/ui.css `.hs-tool-pic` background is var(--press-tint); src/ui/ui.ts queueThumbnails draws every tile.

Change: src/ui/palette.ts THUMB_W 112, THUMB_H 56. src/ui/ui.css `.hs-tool-pic { background: linear-gradient(180deg, #9fd3f5 0%, #dcefff 100%); }`. src/ui/ui.ts queueThumbnails queues only rows with `row.group === build.category()`, and the build dock's changed callback queues the new category.

Why it reads better: The picture leads the tile as the polish spec asked, and a room reads as a cutaway against daytime sky.

Cost: S; texture bytes: none (DOM canvases of about 100 KB at DPR 2, drawn for the shown category only); shares: renderer.thumbnail.

Verify: Retake game-desk-z1-1300-dock: the stairs tile reads as a flight against sky; measurement: each canvas is 224 by 112 device px.

### D-25: Split amber into a fill and a text color so the light theme passes contrast

Lens: L5

Tier: strong

Evidence: Not in the sheet (no light theme game screen). From code: light theme --amber #b57a04 with --on-amber #fdf6e6 gives 3.39:1 for text on selected tiles, pressed segments and primary buttons, and --indicator #0c7a53 on the light glass gives 4.28:1, both under 4.5:1 at 12 and 14 px. site-home-desk-light shows the dark ochre Play beside a lemon button.

Now: src/ui/ui.css and src/site/site.css use one --amber for fills, text, strokes and the focus ring; the light theme darkens it for all of them.

Change: In src/ui/ui.css :root add `--amber-text: #f4b942`; in both light theme blocks set `--amber: #f4b942; --on-amber: #14181f; --amber-text: #8a5a00; --indicator: #0a6a48;` and set `--focus-color: var(--amber-text)`. Use var(--amber-text) where amber is text or a line: `.hs-speed-mode`, `.hs-log-item.is-warn .hs-log-text`, `.hs-goal.is-done .hs-row-value`, `.hs-panel-icon`, `.hs-controls-icon`, `.hs-palette-toggle:hover`, `.hs-toast-close:hover`, `.hs-card-nudge` border, `.hs-place-chip` border, `.hs-tool.hs-tool-hint` outline, `.hs-dial-hand` stroke, `.hs-dial-pin` fill, and `color` (the stroke) on `.hs-star.is-earned` and `.hs-count-glyph` (their fill stays --amber). Mirror the names in src/site/site.css (`.challenge` uses --amber-text; `.nav-play` per D-38).

Why it reads better: One amber wherever a player presses, and every word in or on amber readable in both themes.

Cost: S; texture bytes: none; shares: theme tokens.

Verify: Measurement: text on selected tiles 10.05:1; warn text 5.57:1 on #f6f8fb; the night mode chip 4.74:1 on the light glass. New light theme capture of game-desk-z1-1300-dock shows the same amber as dark theme.

### D-26: Replace the trash can on the Services tab

Lens: L5

Tier: polish

Evidence: game-desk-z1-1300-dock: the Services tab icon, between the shop and the wrench, is a bin that reads as delete.

Now: src/ui/icons.ts SYMBOLS.services draws a bin.

Change: SYMBOLS.services = `<path d="M2 12.75h12" ${LINE}/><path d="M3.5 12.75a4.5 4.5 0 0 1 9 0" ${LINE}/><path d="M8 8.25V6.5M6.75 6.5h2.5" ${LINE}/>`, a service bell on a counter.

Why it reads better: A young player can guess the tab, and nothing on the rail suggests demolishing.

Cost: S; texture bytes: none; shares: the icon sheet.

Verify: Retake game-desk-z1-1300-dock.

### D-27: Round the keycap badges on tiles and group titles

Lens: L5

Tier: polish

Evidence: game-desk-z1-1300-dock: the L, K, T, E letters and the group "1" sit in square hairline boxes, the last square borders in the dock.

Now: src/ui/ui.css `.hs-tool-key` and `.hs-group-key` use `border: 1px solid var(--line)` and no radius.

Change: For both: `border: 0; background: var(--press-tint); border-radius: 4px; padding: 0 4px;`.

Why it reads better: The dock speaks one shape language.

Cost: S; texture bytes: none; shares: none.

Verify: Retake game-desk-z1-1300-dock.

### D-28: Dim the whole sound row when sound is off

Lens: L5

Tier: polish

Evidence: game-desk-z1-1300-settings: with Sound off the sliders fade but "Music 60", "Sound effects 70" and "Background 50" stay full ink.

Now: src/ui/ui.css dims only `.hs-level input[type='range']:disabled` (opacity 0.45).

Change: Add `.hs-level:has(input:disabled) .hs-set-label, .hs-level:has(input:disabled) .hs-level-value { color: var(--ink-dim); }`.

Why it reads better: The row says it is inactive as a whole.

Cost: S; texture bytes: none; shares: none.

Verify: Retake game-desk-z1-1300-settings.

## L6, phone

At phone width the tower looks good where it shows, but the chrome frames it on both ends: the status pill plus a second row of controls at the top, the map over the rooms beside them, and a toast, the Next card and the Build button stacked at the bottom. The controls used most, speed and Menu, sit where a thumb reaches worst. The open build sheet covers the lobby, which is fine because picking a tool shrinks it to a bar; its pictures, though, can be blank and its close button covers a tile. The phone person card was not captured.

### D-29: Draw the build tiles' pictures on a phone

Lens: L6

Tier: strong

Evidence: game-phone-z1-1300-sheet: every tile picture is an empty gray box.

Now: src/ui/ui.ts drawThumbnailsSoon returns early while `paletteCollapsed` is true. That flag is the desktop dock's (hs.palette.collapsed), and the phone sheet opens through build.open without touching it, so any browser that ever folded the dock gets blank tiles on a phone, and the placing bar copies the blank.

Change: In src/ui/ui.ts replace the `paletteCollapsed` test in drawThumbnailsSoon with `boardHidden()`: `inSheetLayout() ? !(build.sheet() === 'row' || build.sheet() === 'full') : paletteCollapsed`. Add a test in tests/ui/build.test.ts: collapsed flag true, phone width, sheet opened, the queue drains.

Why it reads better: Tiles lead with the picture on the device where it matters most.

Cost: S; texture bytes: none; shares: the thumbnail queue.

Verify: Retake game-phone-z1-1300-sheet: every visible tile shows its room.

### D-30: Move the close control into the build sheet so the round button stops covering a tile

Lens: L6

Tier: strong

Evidence: game-phone-z1-1300-sheet: the amber close button sits on the third tile, over its size line and price.

Now: src/ui/build.ts keeps the 60 px fab in the corner over the open sheet; src/ui/ui.css pads `.hs-build-items` for the fab only at the end of the scroll.

Change: In src/ui/build.ts create `sheetClose`, a button with class `hs-build-close`, the close icon and aria-label "Close build", appended to the palette after the handle; a click closes the sheet and focuses the fab. In src/ui/ui.css: `.hs-build-close { display: none; }` everywhere; in the phone block `.hs-palette:is(.is-sheet-row, .is-sheet-full) .hs-build-close { display: inline-flex; position: absolute; top: 2px; right: calc(8px + var(--safe-right)); width: var(--touch); height: var(--touch); align-items: center; justify-content: center; border: 0; border-radius: 50%; background: var(--press-tint); }`, `.hs-build-fab[aria-expanded='true'] { display: none; }` and `.hs-build-items { padding-right: 12px; }`.

Why it reads better: The sheet owns its own close, and the row shows its tiles uncovered.

Cost: S; texture bytes: none; shares: the close icon.

Verify: Retake game-phone-z1-1300-sheet: the close sits top right of the sheet at 44 px and no tile is covered.

### D-31: Give the phone one row at the top and put speed and Menu under the left thumb

Lens: L6

Tier: strong

Evidence: game-phone-z1-1300: the status pill and a second row of speed, Views, Share and Menu fill the top of the screen, where a thumb reaches worst; the approved polish spec says the phone's top bar is one row.

Now: src/ui/ui.css phone block keeps `.hs-top-actions` as the second row of `.hs-top`.

Change: In src/ui/ui.css phone block: `.hs-top-actions { position: fixed; top: auto; left: calc(var(--edge) + var(--safe-left)); bottom: calc(var(--edge) + var(--safe-bottom)); margin: 0; min-height: 0; }`; hide `.hs-views-btn` and `.hs-round[aria-label='Share']`; `.hs-speed-mode { top: auto; bottom: calc(100% + 4px); left: 0; right: auto; }`; `.hs-ui.is-building .hs-top-actions, .hs-ui.is-panel-open .hs-top-actions { display: none; }`. In src/ui/ui.ts toggle `is-building` on the shell from the build dock's changed callback (sheet row or full). In src/ui/panels.ts createSettingsPanel, at phone width, add "Views" and "Share" action rows to the Game group through new PanelContext hooks openViews and openShare, wired in ui.ts to view.open and setPanel('share').

Why it reads better: The tower gets its top back, and the controls used most sit under one thumb with Build under the other.

Cost: M; texture bytes: none; shares: the existing controls.

Verify: Retake game-phone-z1-1300: the top holds the status pill alone; the speed pill and Menu sit bottom left, clear of Build; every speed button stays 44 px.

### D-32: Clear the phone's bottom edge: the goals open from the star count

Lens: L6

Tier: strong

Evidence: game-phone-z1-1300: a toast, the "Next: 2 stars" card and the Build button stack over the basement.

Now: src/ui/ui.css shows the collapsed side card as a bottom card on phones; the star count in the pill opens only the tooltip.

Change: In src/ui/ui.css phone block add `.hs-card.is-collapsed { display: none; }`. In src/ui/ui.ts add a click listener on status.stars that, at phone width, sets goalsCollapsed false, stores the flag and calls update(), so the goals open as today's phone card; its Hide folds and hides it again.

Why it reads better: The phone's bottom shows the tower and one control each side, and the goals are one tap away on the star that names them.

Cost: S; texture bytes: none; shares: the side card.

Verify: Retake game-phone-z1-1300: the bottom edge holds only the speed cluster, Build and, briefly, a toast.

### D-33: Show the phone map only while the player pans, and hide the desktop map behind an open card

Lens: L6

Tier: strong

Evidence: game-phone-z1-1300: the map sits over the condos at top right whenever the tower is taller than the screen; game-desk-z1-1300-person and game-desk-z1-1300-settings: with a card open the map steps left onto the metro.

Now: src/ui/minimap.ts refresh shows the map whenever minimapVisible is true; src/ui/ui.css moves it left of an open card at 900 px and wider.

Change: In src/ui/minimap.ts keep `lastMoveMs`, set whenever the camera x or y differs from the previous frame; on a compact screen show the map only while `performance.now() - lastMoveMs < 1500`, with no fade. In src/ui/ui.css replace the `.hs-ui.is-panel-open .hs-minimap` right offset rule (900 px and wider) with `display: none`.

Why it reads better: The map appears while the player travels and leaves the tower alone while they watch.

Cost: S; texture bytes: none; shares: the map's view key.

Verify: Retake game-phone-z1-1300 (no map) and game-desk-z1-1300-person (no map over the world).

## L7, the site

The site's idea is good: the page is the building in section, floors going underground with slabs between them and floor numbers as readouts. Its execution sells a different, older product. The hero can open black or dim and puts a white card over the tower; the tower it shows has offices and condos only and runs a full day in forty seconds, so about half the time a visitor meets it at night. The call to action is clear but its lemon yellow does not match the nav's amber. Light and dark change only the header and footer, by design. On the phone the hero comes first, the right order. Below the hero there is no picture of the game, so there is little reason to scroll. The link preview and the icon show the 2026-09-19 pixel identity. The 404 page was not captured.

### D-34: Open the landing page on a daytime sky, never a black box or a squeezed pitch

Lens: L7

Tier: hero

Evidence: site-home-desk-light: the hero is black and the pitch is crushed into a narrow column at the far right; site-home-desk-dark and site-home-phone-light: the tower shows but half dark.

Now: src/site/hero.ts adds `has-canvas` before createRenderer resolves (the renderer measures the host) and hides #hero-shot only after; at 720 px and wider `.hero.has-canvas` is a flex row, so while the renderer boots the still image and the copy share the row and the copy is squeezed. #hero-view's background is #070b1a and the renderer fades in from black (D-2).

Change: In src/site/site.css add `.hero.has-canvas #hero-shot { display: none; }` and change the `.hero.has-canvas #hero-view` background to `linear-gradient(180deg, #9fd3f5 0%, #dcefff 100%)`. In src/site/hero.ts call `createRenderer(view, world, { crowd: 'all', fadeIn: false })` (option from D-2). The catch path already removes has-canvas, which brings the still image back.

Why it reads better: A visitor's first look is the game's own daylight, then the tower in it, with the pitch laid out as designed.

Cost: S; texture bytes: none; shares: the day sky tokens.

Verify: Retake site-home-desk-light and site-home-desk-dark at 500 ms and at 2500 ms after navigation: no frame is black and the panel keeps its width.

### D-35: Compose the hero: a daytime clock and a smaller, varied tower beside the copy

Lens: L7

Tier: hero

Evidence: site-home-desk-dark: the white card covers the left of a tower of offices and condos only; rollout-2026-09-23/hero-1280 shows the same in daylight. From code the hero runs one day every 40 s from 08:00, so rooms are in night state about half of each loop.

Now: src/site/hero.ts runs animateDemo at MINUTES_PER_MS 1440 / 40000 and centers on CENTER_TILE 130; src/render/smoke.ts buildDemoWorld is a lobby, two office floors and three condo floors, 80 tiles wide.

Change: 1) src/render/smoke.ts: add `buildHeroWorld()` and leave buildDemoWorld for ?smoke: lobby tiles x 110 to 149 on floor 1; floor 2 shop 110, shop 122, fastFood 134; floor 3 restaurant 110, shop 134; floors 4 and 5 office 110, 119, 128, 137; floor 6 hotelSuite 110, hotelTwin 120 and 126, hotelSingle 132, 136, 140; floors 7 and 8 condo 110 and 126; a standard shaft at x 146 over floors 1 to 8 with two cars; 24 sims cycling worker, resident, guest, shopper, staff, guard, visitor; shops, fast food and restaurant with occupancy above 0. 2) src/site/hero.ts: use buildHeroWorld; set `world.time.minute = 600 + tri(elapsed / 45000) * 600` each frame (10:00 to 20:00 and back, tri the 0 to 1 to 0 triangle) and call animateDemo with minutesPerMs 0; at 720 css px and wider center the camera on `CENTER_TILE - dx / TILE_PX`, where dx is the offset from the hero's center to the middle of the space right of `.hero-panel` (getBoundingClientRect on resize), CENTER_TILE 130.

Why it reads better: The site shows the illustrated game a visitor is about to play, in daylight most of the time with the evening lights as the payoff, beside the words instead of under them.

Cost: M; texture bytes: about 2 MB more at DPR 2 on the landing page for the venue, hotel and fast food textures; the game's budget is untouched; shares: the game's art module.

Verify: Retake site-home-desk-light, site-home-desk-dark and site-home-phone-light: shop signs show right of the panel on desktop and above it on phone; a capture at 60 s shows evening lights, at 10 s daylight.

### D-36: Make the link preview show the illustrated tower

Lens: L7

Tier: hero

Evidence: public/og.png: the wordmark in lit window cells and the tagline on night navy, with no tower, no people and no daylight; it is the only picture a shared link shows, and make-store-shots.mjs cuts the Steam and Play graphics from it.

Now: scripts/make-og.mjs draws og.png in Node from the wordmark scene and a 5 by 7 cell font.

Change: In scripts/make-store-shots.mjs add an `og` graphic built in the page: open the app bundle with the store fixture (D-44's once it lands) at 1200 by 630, device pixel ratio 1, on the first day whose `weatherAt(seed, day * 1440 + 780).kind` is 'clear' (import src/game/weather.ts the way make-design-sheet.mjs imports grid.ts), minute 13:00, paused, `.hs-ui` set to `visibility: hidden`; capture; compose on a 1200 by 630 canvas: the capture drawn at x 360 (its left 360 px cropped), a #0b1020 panel from x 0 to 420 whose right 60 px fade to transparent, public/wordmark-dark.png scaled to 360 px wide at (30, 190), and "Build a tower. Run it well." in Bricolage Grotesque 600, 30 px, #e8ecf2, at (30, 330). Write public/og.png; keep make-og.mjs as the offline fallback; regenerate the store graphics.

Why it reads better: A friend's first look at the game is the game, a bright cutaway full of people beside its name.

Cost: M; texture bytes: none at runtime (og.png grows by roughly 300 KB on disk); shares: the store shot machinery and the wordmark.

Verify: Open public/og.png: the tower fills the right two thirds in daylight and the wordmark reads at a 600 px preview width.

### D-37: Redraw the app icon as a lit cutaway tower

Lens: L7

Tier: strong

Evidence: public/icons/icon-512.png and icon-192.png: an amber stepped block on navy that reads as a cake or a pyramid, with none of the window cells the wordmark uses.

Now: scripts/make-icons.mjs makeSkylinePixels draws three stacked amber rectangles.

Change: Replace makeSkylinePixels' drawing: background #0b1020; stroke t = max(2, round(s / 64)); a block from 0.28s to 0.72s across and 0.12s to 0.88s down, filled #222222; inside it, inset by t, an amber #f4b942 frame; six equal rows, the bottom a lobby (#f8f8f6 inset by t, two #222222 door gaps 0.05s wide either side of center) and five floors of three cells each (inset by t, #f2e8d8, the top 45 percent a pane: #ffd866 where the pattern is 1 and #2a3550 where 0, rows top to bottom [1,0,1], [1,1,0], [0,1,1], [1,0,1], [1,1,1]); a #e6e6e6 slab line t tall under each floor row. The adaptive foreground and round icons call the same function.

Why it reads better: The icon says tower, cutaway and lit windows in one shape and matches the wordmark.

Cost: S; texture bytes: none; shares: world tokens.

Verify: Regenerate and view public/icons/icon-192.png at 48 px: five floors and the lit panes are countable.

### D-38: Make the site's controls look like the game's, with one amber

Lens: L7

Tier: strong

Evidence: site-home-desk-light: tracked uppercase mono nav, a dark ochre PLAY box and lemon hero buttons with hard offset shadows; site-home-desk-dark: the same beside "B1 · THE NAME" chips in tracked caps; the game in game-desk-z1-1300 is rounded glass in sentence case.

Now: src/site/site.css sets `border-radius: 0` on everything, `.site-nav a` and `.theme-toggle` in Share Tech Mono uppercase with 0.08em tracking, `.nav-play` on --amber (#b57a04 in light with #fdf6e6 text, 3.39:1), `.button` on --w-car #f0c419 with a 3 px hard shadow, and `.floor-tag` in tracked caps; the platform switcher and store links are already round, so the page mixes both.

Change: In src/site/site.css: `.site-nav a, .theme-toggle { font-family: var(--font-ui); font-size: var(--size-14); text-transform: none; letter-spacing: 0; }`; `.nav-play { padding: 6px 14px; border: 0; border-radius: 999px; background: #f4b942; color: #14181f; }`; `.button { border: 0; border-radius: 999px; background: #f4b942; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2), 0 8px 20px rgba(0, 0, 0, 0.18); }`, `.button:hover { transform: translateY(-1px); }`, `.button-secondary { background: var(--w-lobby); box-shadow: inset 0 0 0 2px var(--w-outline); }`; `.foot-col h2` and `.foot-mark` in Bricolage 600, sentence case, no tracking; `.floor-tag` keeps the steel chip and green readout face. In index.html and how-to-play/index.html each floor tag becomes the floor alone ("B1", "B2" and so on), since the h2 names the section. Floors, slabs and the underground bands stay.

Why it reads better: The site looks like the front of the product the player opens, and the elevator readout stays a signature instead of a caps label.

Cost: S; texture bytes: none; shares: the game's radius and amber tokens.

Verify: Retake site-home-desk-light and site-guide-desk-light: one amber, no tracked uppercase, pill buttons.

### D-39: Show the game below the fold with room specimens drawn by the game's own code

Lens: L7

Tier: strong

Evidence: site-home-desk-dark below the hero and site-guide-desk-light: every floor section is text on beige; nothing below the hero shows a room, a person or a stress mark.

Now: index.html loads hero.ts and the theme scripts; how-to-play loads the theme script only. The art functions are pure canvas code: src/render/figure.ts (drawPerson, its stress marks, drawPortrait) and src/render/illustrated.ts (drawVenueFixtures, drawSign, drawCarIllustrated).

Change: Add src/site/specimens.ts, a module on both pages. For each `<canvas class="specimen" data-specimen="...">` size it to 288 by 144 css px at the device pixel ratio and draw on a #f8f8f6 wall with a 2 px #222222 outline and a D-5 window band: 'stress' three people in a lobby (calm, pink dot, red exclamation); 'office' the office fixtures from drawVenueFixtures (first base) in a 144 px room with a seated worker; 'shop' the shop fixtures (second base) in a 192 px room with its sign; 'car' drawCarIllustrated at its middle door frame; 'people' four drawPortrait heads. Then swap each canvas for an img with `src = canvas.toDataURL('image/png')` and the canvas's aria-label as alt. Canvases are hidden until drawn (`.specimen:not(.is-drawn) { display: none; }`). Place: landing B1 'people', B2 cards 'office' and 'shop', B4 'car'; guide Rooms 'office', Elevators 'car', Tenants and stress 'stress', People and their stories 'people'.

Why it reads better: Every step of the scroll shows the illustrated game the words describe, in the game's own drawing.

Cost: M; texture bytes: none (about 0.66 MB decoded per image at DPR 2 while on screen); shares: figure.ts and illustrated.ts.

Verify: Retake site-home-desk-dark scrolled one screen and site-guide-desk-light: each floor section shows its specimen.

### D-40: Give the 404 page the site's header band and a way into the game

Lens: L7

Tier: polish

Evidence: Not seen (the preview served the landing page at /nothing-here). From code: 404.html has the wordmark but no nav, and its main is a bare wrap with a heading, a line and a link.

Now: 404.html main is a `.wrap` with "That floor does not exist."

Change: In 404.html add the same `<nav class="site-nav">` as index.html, wrap the content in `<div class="page-head"><div class="wrap"><div class="hero-panel">` and close them, and add `<a class="button" href="/play/">Play in your browser</a>` after "Back to the lobby".

Why it reads better: A lost visitor lands in the same building as every other page, one tap from playing.

Cost: S; texture bytes: none; shares: page-head and hero-panel styles.

Verify: Capture the 404 from `npm run preview:worker` (vite preview serves the landing page instead): its head matches site-guide-desk-light.

### D-41: Call the theme choice "Auto" on the site, as the game does

Lens: L7

Tier: polish

Evidence: site-home-desk-light shows "THEME: LIGHT", whose third state reads "Theme: System"; game-desk-z1-1300-settings offers Auto, Light and Dark.

Now: src/site/theme.ts themeLabel returns 'Theme: System' for system.

Change: themeLabel returns 'Theme: Auto' for system; update tests/site/theme.test.ts.

Why it reads better: The same choice has the same name in both places.

Cost: S; texture bytes: none; shares: none.

Verify: tests/site/theme.test.ts.

### D-42: Describe the hero's still image as it is

Lens: L7

Tier: polish

Evidence: index.html gives #hero-shot the alt "A tower of cream office cells against a dark sky, with the words Hundred Stories"; public/og.png shows only the wordmark and the tagline.

Now: index.html, the img with id hero-shot.

Change: alt="The words Hundred Stories drawn in lit window cells on a night sky"; after D-36, alt="An illustrated tower in daylight beside the Hundred Stories name".

Why it reads better: A screen reader hears what a sighted visitor sees.

Cost: S; texture bytes: none; shares: none.

Verify: tests/site/landing.test.ts asserts the alt.

## L8, system consistency

The site keeps its own copies of the world colors, the chrome keeps its steel tokens twice, and the minimap keeps a third category palette. Most copies agree; the car color is stale and the category colors disagree. A parity test is worth it; a build step that generates CSS from TypeScript is not, for this many values. The documentation drift is larger than the brief lists: VISUAL.md describes the old chrome, motion timing, readout faces and a dusk flicker that does not exist; the brief itself says the fonts load from Google, but they are bundled; SHIPPED.md still says pixel art. The store fixture shows a tower no player could have.

| Color | Game source | Other copies | Same? |
| --- | --- | --- | --- |
| #222222 | palette.ts PALETTE.outline, INK | site.css --w-outline | yes |
| #e6e6e6, #333333 | PALETTE.slab, slabEdge | --w-slab, --w-slab-edge | yes |
| #6b6f78, #4c5058 | sky.ts CONCRETE_COLOR, CONCRETE_LINE | --w-concrete, --w-concrete-line, footer stripe | yes |
| #f8f8f6, #f2e8d8, #e4e8ee | PALETTE.wall lobby, condo, security | --w-lobby, --w-condo, --w-security | yes |
| #7fb6e0 | PALETTE.windowDay | --w-window | yes |
| #3b3f47, #d8dbe0 | PALETTE.shaftCavity, shaftRail | --w-shaft, --w-rail | yes |
| #f0c419 | PALETTE.carBody (retired; the car is #f7d34d to #dcae1c in illustrated.ts) | --w-car, the hero button | stale |
| #dcefff | sky.ts DAY_BOTTOM | .page-head background | yes |
| #070b1a | smoke.ts host | #hero-view background | yes |
| Steel tokens #1c232e and the rest | ui.css :root and light blocks | site.css :root and light blocks; .floor-tag and .site-foot hardcoded; make-icons SPLASH_BG | yes, copied three ways |
| #0b1020 | index.html theme-color | make-og BG, make-icons BG, site --page | yes |
| Amber | ui.css --amber #f4b942 | PALETTE.amber #f0c419; site --w-car | two ambers |
| Category colors | palette.ts BLOCK | minimap.ts GROUP_COLORS, different values | no |

### D-43: Rewrite VISUAL.md's chrome, motion and type sections to the shipped chrome, and log the drift

Lens: L8

Tier: strong

Evidence: Every game shot in the sheet shows floating glass pills, a dock and toasts; docs/VISUAL.md describes a flat directory board, a 232 px palette column, a 28 px event ticker, "no cards, no shadows, no gradients in the UI" and "panels slide 160 ms".

Now: docs/VISUAL.md Layout, Principles 1 and 2, Status bar, Icons, Motion and Type describe the 0.4.x chrome; docs/reviews/2026-09-24-ui-polish-spec.md (approved) describes the shipped one, except that the phone bar ships as two rows.

Change: Rewrite those sections of docs/VISUAL.md from the code: glass for controls rgba(22, 28, 38, 0.88) and near solid text surfaces rgba(28, 35, 46, 0.99); radii 12, 16, 20 and pill; the shadow tokens; the floating 52 px status pill; the 288 px dock with its 56 px rail; the phone sheet and 60 px Build button; 360 px cards at 900 px and wider, bottom sheets below; toasts and the News panel in place of the ticker; icon only buttons on phones and in the speed pill, named by aria-label and title; motion: sheets 200 to 280 ms on the spring, press scale 0.96, under reduced motion chrome moves become 200 ms opacity fades and the world has none; the readout face on cash and the clock (and the floor readout after D-21); fonts self-hosted under font-src 'self'. Remove "window flicker at dusk" until D-15 builds it. Add a "Drift log" list with dates. In docs/reviews/2026-09-25-design-pass-brief.md, the CSP constraint line says the two faces are bundled, not loaded from Google Fonts.

Why it reads better: The direction document again describes the game, so the next reviewer judges the real chrome.

Cost: S; texture bytes: none; shares: none.

Verify: Every chrome element in game-desk-z1-1300 and game-phone-z1-1300 matches a line of VISUAL.md.

### D-44: Make the store tower one a player could build

Lens: L8

Tier: strong

Evidence: game-desk-z1-1300: the tower shows one star of six while it holds a metro (four stars), a cathedral (five) and escalators, shops and restaurants (three); cash and population show a dash where their change should be.

Now: store/fixtures/demo-tower.json holds every room kind (tests/store/fixture.test.ts requires it for the art captures) at one star with no quarter or day baselines; scripts/make-store-shots.mjs FIXTURE points at it.

Change: Add store/fixtures/store-tower.json, made by a new script that builds a tower through applyCommand the way scripts/bench/bench3.ts buildTower does (lobby, office floors, standard shafts with cars), adds a security office, housekeeping, two shop rows, a restaurant, fast food, a hotel floor with a suite, parking and a recycling center (every kind at three stars or fewer), ticks across a quarter boundary so quarterStartCash and dayStartPopulation are set, and saves with save.ts serialize at a weekday 13:00. Run it the way bench3.ts is run and add no dependency. Point make-store-shots.mjs FIXTURE at it; keep demo-tower.json and its test for the art captures. Add tests/store/store-fixture.test.ts: it loads, stars is 3, no room needs more than 3 stars, both baselines are numbers.

Why it reads better: Store screenshots show a believable three star tower with its readouts filled in, the game a buyer gets.

Cost: M; texture bytes: none; shares: the bench tower recipe.

Verify: Run the store shots: every capture shows three stars and both changes as figures.

### D-45: Draw the minimap in the far zoom's district colors

Lens: L8

Tier: polish

Evidence: game-desk-z1-1300 bottom right against rollout-2026-09-23/far-13: the map colors homes blue gray and offices gray, while the far zoom colors offices blue and homes warm.

Now: src/ui/minimap.ts roomColor uses its own GROUP_COLORS and KIND_COLORS.

Change: roomColor(kind) returns BLOCK[kind] (src/render/palette.ts) mixed 30 percent toward #8a9099, as a css string; delete GROUP_COLORS and KIND_COLORS; SHAFT_COLOR stays #5d6574.

Why it reads better: One color per district wherever the tower is shown small.

Cost: S; texture bytes: none; shares: BLOCK.

Verify: tests/ui/minimap.test.ts asserts the office color equals the mixed BLOCK office color.

### D-46: Hold the site's world colors to the game's palette with a test, and fix the stale car color

Lens: L8

Tier: polish

Evidence: src/site/site.css repeats the world colors in the table above by hand; --w-car #f0c419 is the retired car body.

Now: The copies are kept in step by comments; ui.css and site.css each carry the steel tokens and their light remap.

Change: Add tests/site/tokens.test.ts: read src/site/site.css, parse each `--w-*: #hex` and assert it equals its source (outline PALETTE.outline; slab; slab-edge slabEdge; window windowDay; shaft shaftCavity; rail shaftRail; lobby, condo, security from PALETTE.wall; concrete and concrete-line from sky.ts, exported as CONCRETE_COLOR and CONCRETE_LINE; car from a new `CAR_BODY_TOP = 0xf7d34d` exported by illustrated.ts and used in drawCarIllustrated), and assert the steel tokens in ui.css and site.css match in both themes. Change --w-car to #f7d34d.

Why it reads better: Site and game cannot drift apart unnoticed.

Cost: S; texture bytes: none; shares: palette exports.

Verify: The test passes and fails if any one hex changes.

### D-47: Say "illustrated art" where the records still say "pixel art"

Lens: L8

Tier: polish

Evidence: SHIPPED.md "What this is" calls the game "a tower-building sim with pixel art drawn in code".

Now: SHIPPED.md, What this is.

Change: Replace "pixel art drawn in code" with "illustrated art drawn in code, inside a pixel grid".

Why it reads better: The record matches the game since package 2.

Cost: S; texture bytes: none; shares: none.

Verify: Read SHIPPED.md.

## L9, cost and budget

No finding adds a baked texture to the game, so the demo tower stays at the 1.48 times baseline package 8b measured. Every finding's Cost line gives its size and what it shares; the table sums what sits outside the game budget.

| Where | Findings | Bytes or count | Kind |
| --- | --- | --- | --- |
| Game, baked textures | all | 0 new | Graphics geometry, Texture.WHITE tints, second sprites on existing textures, rebakes under existing keys |
| Game, DOM canvases | D-24 | about 100 KB per tile shown, one category at a time | build tile thumbnails |
| Landing page, GPU | D-35 | about 2 MB more at DPR 2 | hero venue, hotel and fast food textures |
| Landing and guide, images | D-39 | about 0.66 MB decoded per specimen while on screen | data URL images |
| Repository | D-36 | about 300 KB more for public/og.png | generated by script |
| Size of the work | all 47 | S 39, M 8, L 0 | Cost lines |

## 5. Bold bets

These break a stated rule, decision or constraint. They are Matt's to decide and are not ranked with the backlog.

### BB-1: Open on the whole tower, then let the player zoom in

Lens: L1

Tier: hero

Evidence: game-desk-z1-1300 and game-phone-z1-1300: at zoom 1 no tower taller than the screen shows its roof.

Now: src/render/renderer.ts frameInitial calls camera.reset(), zoom 1.

Change: In frameInitial, when the whole built tower (top floor to lowest basement plus one floor of sky) fits the free band at zoom 0.5, set zoom 0.5 and center on the tower's middle; otherwise open at zoom 1 with D-1's framing. Nothing animates; the first wheel notch or pinch goes to zoom 1 as today.

Why it reads better: The first second shows the whole building standing in its sky, the silhouette that says tower.

Cost: S; texture bytes: none (zoom 0.5 draws the same textures in the muted tier); shares: the camera's snap stops.

Verify: Retake game-desk-z1-1300 on a tower of up to twenty floors: the whole tower and its roofline show.

Breaks: VISUAL.md principle 5, "Since 0.4.0 zoom 1 is the opening view", and DECISIONS 2026-09-22, "default zoom 1 (a floor is 72 CSS px)".

Case: Zoom 1 gives a room a real interior, which a player gets by zooming in; as the opening it makes the first frame of every grown tower a crop, and that frame starts every session.

Reversible: One constant, OPENING_WHOLE_TOWER, in renderer.ts; false restores zoom 1.

### BB-2: Draw the far zoom as a lit facade and move the districts into Views

Lens: L3

Tier: strong

Evidence: illustrated-2026-09-23/after-far-13 and rollout-2026-09-23/far-13, far-22: below zoom 0.5 the tower is a patchwork of flat blocks, a chart by day and a darker chart by night.

Now: src/render/renderer.ts rebuildBlocks draws BLOCK colors with occupancy fills; hierarchy.ts hides rooms below 0.5.

Change: Below zoom 0.5 draw each built floor as a facade band: #dfe6ee wall, a 2 px #222222 slab line, one pane per two tiles in #7fb6e0 by day, and at night #ffd866 for occupied rooms and #2a3550 for empty ones on the emissive layer (D-4); shafts as darker vertical strips. The block view becomes a "Districts" entry in the Views popover, drawn by the overlay pass.

Why it reads better: Stepping back shows a skyscraper whose windows say where people are, day and night; the district chart is one tap away.

Cost: M; texture bytes: none (Graphics); shares: rebuildBlocks, overlays.ts.

Verify: New captures at zoom 0.25 at 13:00 and 22:00: a building by day, a lit building by night.

Breaks: VISUAL.md hierarchy: "Below zoom 0.5 every room is one flat block in its category colour ... its occupancy a lighter fill from the floor up".

Case: The blocks buy legibility at a glance but turn the one bold element into a diagram exactly when the player steps back to admire it.

Reversible: The block pass stays behind the Districts view; a flag makes it the far zoom again.

### BB-3: Show the daytime cutaway without the window band

Lens: L2

Tier: hero

Evidence: game-desk-z1-1300-person and game-phone-z1-1300: the pane strip takes the top fifth of every floor and repeats across the tower.

Now: src/render/art.ts drawWindowBand draws day panes on every glass room.

Change: For state 'day' draw no panes, only the head rail at y 4 to 5 and a sill line at y 18 to 19 in #222222 with the wall between; lit, vacant and housekeeping keep their panes, so windows appear at dusk and carry the night (D-4, D-15).

Why it reads better: By day the rooms read as open dioramas at full height, and night becomes the moment the windows appear.

Cost: S; texture bytes: none; shares: drawWindowBand.

Verify: Retake game-desk-z1-1300-person: rooms read floor to ceiling.

Breaks: VISUAL.md world tokens: "windows are 12 by 12 panes, one per tile at x 2 + 16n, y 6, with 2 px mullions and a sill at y 18 to 19" and "windows (since 0.4.1, four states): day `#7fb6e0`".

Case: The band was the original's way to say building at 8 px; with illustrated interiors it spends a fifth of every floor repeating one pattern, and D-5 only softens it.

Reversible: One condition in drawWindowBand.

### BB-4: A distant downtown after dark

Lens: L2

Tier: strong

Evidence: game-desk-z1-2300 and weather-2026-09-23/desktop-clear-22: at night the tower stands against low hills and flat navy.

Now: src/render/sky.ts draws hills at parallax 0.15 and two to four storey roofs at 0.3.

Change: Add a third band behind the hills at parallax 0.06: flat topped towers 120 to 360 px tall in #aebdd0 at 35 percent by day, and at night #243457 with a sparse grid of 2 by 2 px #ffd866 windows at 60 percent, placed by the sky's own rng, with no motion.

Why it reads better: The subject is a downtown high rise; a quiet field of lights far behind frames it as the brightest building in a city.

Cost: S; texture bytes: none (Graphics); shares: the horizon band code.

Verify: New capture at 22:00: the skyline sits below the tower's brightness and never crosses its outline.

Breaks: DECISIONS 2026-09-19, "no tall city backdrop", restated 2026-09-22, "the 2026-09-19 ruling against a tall city backdrop stands".

Case: The ruling protected the bright daytime look; a band barely visible by day that becomes a field of lights at night keeps that and gives the night composition a setting.

Reversible: One band in createSky; delete it or set its alpha to 0.

### BB-5: A watch mode where the chrome steps aside

Lens: L5

Tier: strong

Evidence: game-desk-z1-1300: the top bar, the dock rail, the Next card and the map frame the tower on three sides while the player is only watching.

Now: The polish spec keeps every control in place at all times.

Change: After 20 s with no pointer, key or pad input and no panel open, fade the top bar (except the clock), the dock, the goals card and the map to opacity 0 over 400 ms; any input restores them at once. A Settings switch, "Watch mode", off by default. Under reduced motion they hide and show without a fade.

Why it reads better: When a player is watching, the tower is the only thing on screen, which is the stated job of every screen.

Cost: S; texture bytes: none; shares: none.

Verify: A capture 25 s after the last input shows the tower and the clock only.

Breaks: The approved polish spec addendum, "controls never move or hide with context", and VISUAL.md Motion, "Ambient motion only in the world ... Never in the chrome".

Case: The rule guards against controls vanishing when needed; an opt-in idle state after twenty seconds without input keeps that and serves the audience that likes watching small systems run.

Reversible: The switch; off is today's behavior.

## 6. Packages

Each package is independent and leaves the game shippable; the order is by leverage. D-3 can land before D-25 on var(--amber). D-34 needs D-2's fadeIn option. D-8 needs D-4's emissive root. Before P5, P6 and P8, extend scripts/make-design-sheet.mjs so the ghost (open the Shops and fun tab), the room and person targets (pick ones inside the band) and the 404 (serve it with npm run preview:worker) can be captured, and so moving the clock shifts waitStart with it.

| Package | Findings | Days | Retake before and after |
| --- | --- | --- | --- |
| P1 First frame | D-1, D-2, D-3, D-11 | 2 | game-desk-z1-1300, game-desk-z1-1300-dock, game-desk-z1-1300-person, game-phone-z1-1300 |
| P2 Daytime read | D-5, D-7, D-12, D-13 | 2 | game-desk-z1-1300-person, game-phone-z1-1300, game-phone-z1-1300-sheet |
| P3 Night | D-4, D-6, D-8, D-9, D-10, D-15 | 3 | game-desk-z1-2300; new game-desk-z1-1830; new zoom 0.25 at 22:00 |
| P4 Chrome | D-19, D-20, D-21, D-22, D-23, D-24, D-25, D-26, D-27, D-28 | 3 | game-desk-z1-1300-dock, -person, -settings, -views; new light theme dock |
| P5 Phone | D-29, D-30, D-31, D-32, D-33 | 3 | game-phone-z1-1300, game-phone-z1-1300-sheet, game-phone-z1-1300-person |
| P6 Game feel | D-14, D-16, D-17, D-18 | 2 | game-desk-z1-1300-ghost at 0, 200 and 600 ms; the listed tests |
| P7 Front door | D-34, D-35, D-36, D-37, D-42 | 3 | site-home-desk-light, site-home-desk-dark, site-home-phone-light, public/og.png, public/icons |
| P8 Site system | D-38, D-39, D-40, D-41 | 2 | site-home-desk-light, site-guide-desk-light, site-404-desk-light |
| P9 Records | D-43, D-44, D-45, D-46, D-47 | 2 | store shots; game-desk-z1-1300 (map colors) |

## 7. Appendix A: first impressions, unedited

Written after looking at each image and before reading any render code.

| Shot | First impression |
| --- | --- |
| game-desk-z1-1300 | Rainy 1 PM reads as dusk: the whole world is gray-blue and dim, the repeated blue window band and the long stair diagonal lead the eye, not the rooms; the tower is cut at the top with no sky, and the floating dark pills are quiet but the amber pause button is the brightest thing on screen. |
| game-desk-z1-2300 | Night is the day scene under a lavender veil; the only warm notes are two condo window bands and the lobby band; the bottom half of the frame is gray basement, and the Paused chip is the loudest warm thing. |
| game-desk-z1-1300-dock | The dock opens as a big dark panel with four small tiles, two of them locked; only the Lobby thumbnail reads as a picture, the stairs tile is a thin line; the world is dim gray again and a toast with a clock stamp sits bottom center. |
| game-desk-z1-1300-person | Here the same 1 PM world is suddenly bright and white, which is how it should look; the Worker card is clear, but a second stale card (shaft waits, cars) peeks out under it and the minimap jumps left onto the metro; the selected person is hidden behind the card. |
| game-desk-z1-1300-settings | Settings reads like a phone settings app, calm and grouped; the slider rows are twice the height and a size bigger than the button rows, and the sliders stay lit while Sound is off. |
| game-desk-z1-1300-views | A clean popover of four icon rows, but it lands on top of the Next card and cuts its text; the world under it is dimmed gray again. |
| game-phone-z1-1300 | Bright and legible at zoom 1, tower first; but the gray stair zigzag is the largest shape on screen, the top 14 percent is two rows of chrome plus a minimap over the rooms, and the bottom stacks a toast, the Next card and the Build button. |
| game-phone-z1-1300-sheet | The build sheet looks like a modern app, but every tile thumbnail is an empty gray box, the close button covers the third tile's text, and the world ghosts through the sheet. |
| site-home-desk-light | A black void fills 85 percent of the first frame and the pitch is crushed into a 285 px column at the far right; nothing on screen says tower. |
| site-home-desk-dark | The hero shows the tower, but dimmed to slate and half covered by a large white card with a hard black border; the beige 'B1 · THE NAME' section keeps its light background in dark theme. |
| site-home-phone-light | Tower first, then copy, the right order for a phone; the hero tower is dim gray, and the tracked-caps nav and pixel wordmark feel like a different product from the game chrome. |
| site-guide-desk-light | The guide is a clever cross section of floors going underground (B1 Rooms, B2 Elevators), but it is all text, no picture of a room or a person, and the right 40 percent of the page is empty. |
| public/og.png | A charming wordmark of lit windows on night navy, but no tower, no people and no daylight; it sells the 2026-09-19 pixel game, not the illustrated one. |
| public/icons/icon-512.png, icon-192.png | An amber stepped block on navy reads as a cake or a pyramid, not a tower with floors; it has none of the lit windows the wordmark already owns. |
| baseline-2026-09-23/android-phone-1-tower | Pure pixel art: silhouette stick people with hats, identical desk rows, a repeated blue window band, and the blue escalator diagonal is the brightest, biggest shape on screen. |
| baseline-2026-09-23/android-phone-2-wide | Half the frame is empty sky over a thin tower band, and a Stairs hover card covers a third of the tower. |
| baseline-2026-09-23/android-phone-3-close | At close zoom the pixel escalator is a giant blue and purple diagonal that owns the frame. |
| baseline-2026-09-23/android-phone-4-closer | Identical to the tower shot; the closer zoom was never captured. |
| illustrated-2026-09-23/before-desktop-13 | Pixel silhouettes and identical office rows under a storm label, with a sunny tower. |
| illustrated-2026-09-23/after-desktop-13 | Same tower with colored people, venue signs and studio offices; better, but at DPR 1 the new detail is tiny and the escalator still leads. |
| illustrated-2026-09-23/before-desktop-22 | Night is the day scene with a lavender wash and a yellow lobby band; rooms fully lit, so it reads dimmed, not night. |
| illustrated-2026-09-23/after-desktop-22 | Blinds and shutters make closed hours legible and one warm pool shows; the lavender wash still flattens the night. |
| illustrated-2026-09-23/before-far-13 | Far zoom is a busy smudge of furniture on a pale sky; half the frame is concrete. |
| illustrated-2026-09-23/after-far-13 | Far zoom as flat category blocks; legible zones, but it reads as a chart, the occupancy fill barely shows, and concrete is half the frame. |
| illustrated-2026-09-23/before-far-22 | The old far night at least showed lit lobby and hotel strips. |
| illustrated-2026-09-23/after-far-22 | The block view at night has no lit windows at all: a flat chart on navy, nothing says people live there. |
| illustrated-2026-09-23/before-phone-13 | Pixel escalator owns the center; silhouettes; basement concrete fills a quarter. |
| illustrated-2026-09-23/after-phone-13 | People read as people now; mixed fidelity is obvious next to unchanged pixel hotel rooms and escalator. |
| illustrated-2026-09-23/before-phone-22 | At 22:32 the rooms are as bright as noon; night is only the window band stripes. |
| illustrated-2026-09-23/after-phone-22 | Shutters and blinds read, but the interiors are daylight bright at 22:22 on the phone. |
| weather-2026-09-23/desktop-clear-13 | Clear day at mid zoom: a small busy band under flat blue sky; stairs are the landmark. |
| weather-2026-09-23/desktop-clear-22 | Clear night: navy sky and scattered lit yellow bands, the best thing in the night set, but interiors unchanged by night. |
| weather-2026-09-23/desktop-overcast-13 | Overcast looks exactly like sunny; only a sliver of pale sky hints at weather. |
| weather-2026-09-23/desktop-overcast-22 | Overcast night: a lavender filter over fully furnished rooms. |
| weather-2026-09-23/desktop-rain-13 | Labeled rain, no rain visible. |
| weather-2026-09-23/desktop-rain-22 | Rain night: faint dashes in the sky; rain barely reads. |
| weather-2026-09-23/desktop-storm-13 | Storm at noon indistinguishable from overcast and clear; weather is a word under the clock. |
| weather-2026-09-23/desktop-storm-22 | Storm night: faint dashes and one dark cloud; otherwise the clear night. |
| weather-2026-09-23/phone-rain-22 | The tower is a band across the middle; basement concrete fills the bottom 40 percent; rain is faint dashes. |
| weather-2026-09-23/phone-storm-13 | Storm day on the phone is a gray sky strip and a sunny-looking tower; weather lives in the letters ST. |
| rollout-2026-09-23/close-selected-13 | At zoom 3 the illustration holds: clean outlines, a readable guard with a red exclamation and an amber selection box; the window panes are coarse flat squares next to smooth furniture. |
| rollout-2026-09-23/close-upper-13 | Upper floors up close are rich: cathedral, cinema, party hall, medical, security; the cinema's lit film still is the most striking thing on screen. |
| rollout-2026-09-23/desktop-13 | Every room illustrated; basement parking, recycling and metro add a second story below the street; the straight gray stairs are a big improvement over the blue escalator. |
| rollout-2026-09-23/desktop-22 | Night: blinds, shutters and lit bands, but rooms stay daylit behind a lavender veil; the basement looks like day. |
| rollout-2026-09-23/far-13 | Far block view: a patchwork of saturated category blocks, legible as zones, reads as a chart; the top is cut by the chrome. |
| rollout-2026-09-23/far-22 | Far at night: the same blocks, darker, with no light at all. |
| rollout-2026-09-23/hero-1280 | The landing hero in daylight at last: bright sky, lit tower, elevators; but the white card sits across the tower and the wordmark is doubled. |
| rollout-2026-09-23/palette-13 | The old directory palette: big labeled tiles with readable thumbnails; the elevator thumbnails are two thin lines, near invisible. |
| rollout-2026-09-23/phone-13 | Phone at 1 PM is legible and friendly; the stair zigzag is the tallest continuous shape; recycling fills the lower third. |
| rollout-2026-09-23/phone-22 | Phone at 22:24: a faint lavender veil on the upper floors; shutters read; the basement looks like day. |

Three of these first impressions were corrected by the code: the dim desktop shots are the load fade still running (D-2), not the rain; the "stale card" under the Worker card is the elevator hover card (D-23); and the sound sliders are dimmed, only their labels are not (D-28).

## 8. Appendix B: color tokens proposed

| Token | Now | Proposed | Contrast against its usual background |
| --- | --- | --- | --- |
| PALETTE.windowMullionDay (new; day mullions) | #222222 | #506274 | 2.90:1 on pane #7fb6e0 (was 7.33:1) |
| PALETTE.windowDayGlint (new; every fifth day pane) | two white 55 percent glint pixels per pane | #b3d6f0 | 1.43:1 on #7fb6e0 |
| NIGHT_GRADE.vacant (new; tint) | #ffffff | #9aa5c6 | not text; multiplies the room |
| NIGHT_GRADE.housekeeping (new; tint) | #ffffff | #b4bcd6 | not text |
| POOL_ALPHA and blend | 0.5, normal, under the light layer | 0.35, add, above it | not text |
| Load fade cover | #000000 | #1c232e | not text |
| Clock digits and floor readout (dark) | --ink #e8ecf2 | --indicator #8ff0c0 | 8.90:1 on the glass over the brightest world (#31363f) |
| --indicator (light) | #0c7a53 | #0a6a48 | 5.30:1 on the light glass #e3e6ec (was 4.28:1) |
| --amber (light, fills) | #b57a04 | #f4b942 | fill; see --on-amber |
| --on-amber (light) | #fdf6e6 | #14181f | 10.05:1 on #f4b942 (was 3.39:1 on #b57a04) |
| --amber-text (new) | not present | dark #f4b942, light #8a5a00 | light 5.57:1 on #f6f8fb, 4.74:1 on #e3e6ec |
| --focus-color (light) | #b57a04 | var(--amber-text) #8a5a00 | 5.57:1 on #f6f8fb |
| Pressed speed button and category tab | solid --amber | rgba(244, 185, 66, 0.18) with a 2 px --amber-text ring | icon 4.67:1 dark, 4.43:1 light |
| --glass-edge (new) | none | rgba(232, 236, 242, 0.10) dark; rgba(21, 28, 37, 0.10) light | decorative edge |
| .hs-tool-pic background | var(--press-tint) | gradient #9fd3f5 to #dcefff | picture backdrop |
| #hero-view background | #070b1a | gradient #9fd3f5 to #dcefff | not text |
| site .nav-play | #b57a04 with #fdf6e6 text (light) | #f4b942 with #14181f text, both themes | 10.05:1 (was 3.39:1 in light) |
| site .button | --w-car #f0c419 | #f4b942 | 10.05:1 with #14181f |
| site --w-car | #f0c419 | #f7d34d | decoration only |
| Minimap room colors | GROUP_COLORS grays | BLOCK mixed 30 percent toward #8a9099 | not text |
| Stairs handrail | #5a6472 at 2.5 px | #8a97a8 at 2 px | not text |
| Connector alpha at zoom 0.75 and up | 1 | 0.85 | not text |
| Night stars (new) | none | #ffffff at 0.4 to 0.9 | not text |
| Far zoom night occupancy (new) | lighter tint of the block color | #ffd678 at 0.85 above the light layer | not text |
| District floor line (new) | none | BLOCK[kind] | not text |
