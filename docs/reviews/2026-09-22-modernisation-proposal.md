# Hundred Stories: modernisation proposal

Date: 2026-09-22. Author: the orchestrating session (Fable 5.1), with a performance investigation by an Opus 5.5 specialist at docs/reviews/2026-09-22-performance-investigation.md. Status: proposal, nothing here is built or decided until Matt says so.

Scope: what Matt asked for on 2026-09-22. The game is meant to be a modern take on the 1994 original; the code is modern but the look is not, the play freezes on a tower under ten floors, and the next step may be app stores (Apple, Google, maybe Steam) with the website as the landing page and possibly a browser demo. This document covers four things: where the freezes come from and what to change in the engine, what a 2026/2027 look means for this game, what the UX needs, and how the store move should be sequenced. Sound is in scope with an off toggle.

## 1. The short version

1. The freeze is a motion timing defect, not a CPU stall. On an eight floor tower the main thread is over 90 percent idle at 60 fps; the people and cars stand still in a fifth to two fifths of frames because the sim ticks on a 50 ms timer out of step with the display and the renderer's interpolation saturates. One loop fix, no sim change, no hash change. Section 3.
2. Fix the engine before wrapping it. Capacitor, Trusted Web Activity, Tauri and Electron all run the same JavaScript and WebGL the browser runs today. A store build of the current code stutters the same way, on weaker hardware. Section 3 has the ranked round.
3. The look is dated because it is a faithful reproduction. The 2026-09-19 decision chose "bright and flat like the original": 8 px tiles, 36 px floors, cream cells with dark outlines, no city. That is authentic 1994. A 2026 take keeps the cross-section diorama and raises the fidelity: 16 px base tiles, real lighting by hour, depth, motion, and a UI with icons, sound and a goal ladder. Section 4.
4. The UX has no first-run experience. A new player gets a three-load hint line and a text palette. The star ladder is the game's progression and it is invisible until a locked row says "Needs 2 stars". Section 5.
5. Stores after the engine and UI work, as a Capacitor build for iOS and Android and a Tauri build for Steam, from one codebase. The website stays the landing page. Whether the web build is the full game or a capped demo is a business decision, laid out in section 6.

## 2. What was examined

- The itworks state, the decisions log, the shipped notes and the performance round of 0.2.3 and 0.2.4.
- Fresh-profile headless screenshots of the landing page and the demo tower at 1440 by 900 (per the MAP gotchas, never the extension's capture).
- A Sonnet researcher's inventory of the UI surface, first-run path, art pipeline and landing page.
- An Opus 5.5 specialist's profile of a real eight-floor tower in headless Chrome, plus a static read of every per-frame and per-tick code path. Its report is the companion document.

## 3. Performance and engine

Companion report: docs/reviews/2026-09-22-performance-investigation.md (Opus 5.5 specialist, measured on this Mac's GPU in headless Chrome, production build, an eight floor tower of about 180 people built to match Matt's description, plus the 4,920 person bench tower and a phone proxy at 4x CPU throttle).

### 3.1 What the freeze actually is

The freeze is not a CPU stall. On the eight floor tower every run held 60 fps with zero long tasks at 1x, 2x and 4x, with the main thread 88 to 97 percent idle and a sim tick costing 0.01 to 0.3 ms. The phone proxy held 60 fps too. The time box and route cache from 0.2.3 did their job.

What does reproduce, on a real GPU at a steady 60 fps, is motion that stops and lurches. The sim ticks on a 50 ms timer that is not synced to the display, the renderer runs on requestAnimationFrame, and the interpolation alpha in the frame function saturates before the next batch of ticks lands. So a walker or a car covers its movement in the first half of the interval, stands still for the rest, then jumps. Timer jitter of about one millisecond turns two tick batches into one or three, and a three tick move is past the teleport threshold, so the sprite snaps.

| speed | frames where a moving person does not move | frames with a jump over three times the normal step |
|---|---|---|
| 1x | 21% | 1.7% |
| 2x | 27% | 0.8% |
| 4x | 42% | 12.7% |

At 4x, alpha is clamped at 1 in 91 percent of frames. On a 120 Hz display it is worse. This is what reads as "the people and elevators keep freezing": the CPU is idle and the pictures are still standing still.

Caveat: this is the Mac. If Matt sees the whole page lock up with input dead, rather than the people and cars stalling while the chrome stays live, that is a different defect and the machine and browser he plays on need to be named so it can be reproduced there.

### 3.2 The engine round, ranked

1. **Loop and interpolation.** src/game/game.ts (the frame function and the 50 ms interval) and src/render/renderer.ts (the interpolated helper). Drive the tick drain from the frame loop while the tab is visible and keep the 50 ms interval only as the hidden tab fallback. Snapshot every drawn entity before each tick batch and interpolate from snapshot to current with alpha equal to real time since the batch started over the time the batch stands for. Scale the teleport threshold by ticks in the batch so only true discontinuities snap. Expected: still frames from 21 to 42 percent down to near zero, lurches gone, CPU unchanged, bench hashes unchanged. Risk medium, in the loop tests and the hidden tab path. This single fix is the answer to Matt's complaint.
2. **The evening rush is the real sim ceiling.** The time box drops ticks between ticks; it cannot cut one slow tick. On the 4,920 person tower the evening rush costs 25 to 59 ms per tick in node, almost all in the people pass and route search: every waiting sim re-asks routing on a retry schedule, each ask searches from its exact tile and then scans every settled state to pick the goal, and the priority queue is a linear scan with splice. The bench samples 09:00 only and never sees this. Fixes, in order: an evening sample in the bench; index settled nodes by floor; a binary heap; then key the per minute search cache by floor and connector rather than tile. The last one can move tie breaks, so it is checked against the six hashes. Expected: the large tower's evening rush under 8 ms per tick.
3. **Every room is rewritten every frame.** The room reconcile sets size, position and tint on every room and slab each frame even when nothing changed. About 1.2 ms per frame at 1,200 rooms, roughly 10 ms at 100 floors, which is what would make a big tower unplayable. Reconcile the static tower on a change counter, later cache floor bands as render textures and cull bands outside the camera. Render only, hashes unchanged.
4. **UI work per step.** The HUD updates twice per step, a tool in hand forces a layout each frame, and the log panel rebuilds 200 rows on every change. Small today, a phone cost later.
5. **Sky gradient leak.** A new gradient texture per colour change, the old one never destroyed. No measurable cost in 30 seconds, a slow leak over an evening's play.

### 3.3 Architecture answers

- **Web Worker for the sim:** not needed for a tower like Matt's, and not the fix for the freeze. It is the right end state for the 100 floor goal because a single rush hour tick cannot be sliced and only a worker takes it off the frame. The boundary is a transferable snapshot per tick batch (drawn sims, cars, dirty rooms as typed arrays) plus deltas for cash, clock, population, stars and log lines, with commands applied at tick boundaries in the worker to keep determinism and the hash tests. The cost is that every UI read of the world becomes a mirror or a round trip, so this comes last, only if items 1 to 4 leave rush hour ticks over about 8 ms at the target size.
- **Renderer:** motion fix first, static tower layer on a change counter, camera culling of floor bands, a texture atlas baked at boot behind a loading screen (today textures bake lazily, so the first dusk bakes the lit variants mid play), and sprite pooling or the particle path at any count.
- **Ceiling:** the current architecture holds 60 fps at about 5,000 people on this Mac with the sim in slow motion through both rushes. A 100 floor tower with 15,000 to 25,000 people and 5,000 rooms would spend 5 to 10 ms per frame on room reconcile alone and stay in slow motion through both rushes; phones two to four times worse. Items 1 to 4 above are the shortest path; the worker is the last step.

### 3.4 What this means for the store plan

None of this changes with a wrapper. The store builds inherit whatever the engine round delivers, so the engine round is the gate for the store round, not a parallel track.

## 4. The look: from 1994 reproduction to a 2026 diorama

What the screenshots show today: an 8 px tile grid at zoom 1 on a 1440 px wide window, so a floor is 36 px tall and a hotel room is a thumbnail. Rooms are flat cream cells with a one pixel dark outline, the sky is a flat gradient, underground is flat gray bands, elevators are a yellow box with two doors, people are 8 by 16 stick figures in three colours. The landing page chrome (Bricolage Grotesque, the basement-level sections, the yellow call to action) reads as 2026; the game world reads as a 1994 emulator.

The direction in docs/VISUAL.md is right ("an architect's diorama cross-section, bright, flat, high contrast"). It has just been executed at the original's resolution. The proposal keeps the diorama and the flat palette, and changes four things.

### 4.1 Resolution and scale
- Base tile 16 px and floor 72 px (double today), textures baked at the device pixel ratio up to 2. Everything is authored twice as large, so a room has room for a real interior rather than four pixels of desk. Zoom snaps stay at 0.5, 1, 2, 3 relative to the new base.
- Default desktop zoom so a floor is about 72 CSS px on a laptop. Today's default puts a nine-floor tower in a quarter of the screen, which is exactly what Matt is seeing.
- Rooms drawn with two tone walls (a lit face and a shadow face), a slab with a cast shadow under it, and a floor-plate edge. Depth without perspective.

### 4.2 Light and time
- A light layer over the world tinted by hour: cool blue dawn, neutral noon, amber evening, deep blue night with warm lit windows. Windows light per room state (occupied, vacant, dirty hotel room shows housekeeping light). The sky already changes by hour; the tower does not.
- Interior lights off in vacant rooms at night, on in occupied ones. This makes occupancy readable from across the tower, which is gameplay information as well as decoration.
- Elevator shafts with a lit car interior and a visible cable, the car casting a soft shadow up the shaft.

### 4.3 Motion
- Elevator doors that slide, not toggle. Cars that ease into a stop.
- People with a three frame walk cycle, an idle sway when waiting, an impatience shuffle at high stress, a small burst of variety in outfits (hat, bag, coat) chosen from the sim id so it is stable.
- Build feedback: the 4 px settle in VISUAL.md plus a dust puff, and a soft flash on the new room.
- Ambient life: a shop sign that blinks at night, restaurant steam, a cinema marquee. All behind the reduced motion switch.

### 4.4 Backdrop
- The 2026-09-19 decision said no tall city backdrop, and this proposal does not reopen it. It proposes a low horizon: distant low buildings and hills as two parallax bands, plus clouds that drift. This gives the camera depth cues without competing with the tower. If Matt wants the original's empty sky kept, this item is dropped and nothing else changes.

### 4.5 The chrome
- Keep the "directory board, not a dashboard" idea and the two fonts. Replace the text-only palette with tiles: a live thumbnail of the room (rendered from the same texture cache, no new art), name, cost, footprint, and for locked rows the star needed with a progress bar to it.
- Replace the top strip readouts with a compact status bar: cash with a delta since last quarter, population with a trend arrow, stars as icons with the next star's requirement in a tooltip, a clock dial that shows the auto 8x night as a visible mode rather than a surprise.
- Panels get section icons and a consistent header pattern. A single iconography set drawn in code as SVG symbols, no icon font.

### 4.6 Sound
- A small synthesised set through the Web Audio API, no audio files: elevator chime and door, build thunk, cash register on rent day, a soft alert for events, a short sting on a new star. Ambient bed by hour (traffic at noon, crickets at night) at low level.
- A master toggle in settings, off state remembered in localStorage next to the theme, and separate sliders for effects and ambient. Muted by default until the player's first interaction, because browsers block audio before a gesture anyway.

## 5. UX

### 5.1 Tutorial and onboarding
Today a new player gets a one line controls hint for three loads and nothing else. The star ladder, the game's whole progression, is invisible until a locked palette row says "Needs 2 stars".

- **Intro card on the first new game:** three short screens, what the game is, what a star is, what kills a tower (stress, noise, an empty elevator). Skippable in one tap, never shown again once dismissed, re-openable from settings under Help.
- **Guided first tower:** five steps in a side card, each with the target palette row lit and the valid placement band highlighted in the world: build a lobby, add an office, add an elevator that reaches it, wait for the first tenants, reach the population for the second star. The card advances on the real event, not on a timer. Skippable at any step, and finishing it marks it done in localStorage next to the theme and sound choices.
- **Contextual tips:** the first time each thing happens (a hall call waits too long, a tenant leaves, the first quarter's rent lands, the first event fires, night speed kicks in, a panel opens), one tip in the toast slot with a "got it". Each tip fires once. The auto 8x night is the one most players will read as a bug, so it gets a tip and a visible mode in the status bar.
- **Goals card:** once the guided tower is done, the same card shows the next star's requirements as a checklist with live progress, plus one nudge when a requirement stalls (for example, "12 people waited over 5 minutes for a car this hour").
- **Help entry:** settings gets Help with the intro, the controls list, and a link to the guide page. The guide page already exists at /how-to-play/ and stays the long form.
- **Phone:** the cards use the existing bottom sheet, one at a time, and the placement highlight works with the two step tap and Build flow.

### 5.2 Feedback and information layers
- Overlay toggles on the status bar: stress heat, noise, vacancy, elevator wait. The original had an evaluation view; this game's evaluation is computed and never shown.
- Hovering a shaft shows waiting counts per floor and the car settings inline. Hovering a room shows eval, rent and tenants (the query panel has this; hover should preview it).
- Placement: a ghost that shows the footprint and the floors a shaft will serve, with the refusal reason in the chip (exists) and a short explainer for the common refusals.

### 5.3 Controls
- Number keys select palette groups, letters select tools, Escape clears the tool, Space pauses. Show them in the tile tooltips.
- A minimap when the tower is taller than the viewport.

### 5.4 Phone
- The bottom sheets are the right shape. The thumbnail palette makes them usable at a glance. Sound and the light layer are fine on phones; the parallax bands are cheap.

## 6. Distribution

### 6.1 The decision that matters
A wrapper does not change the engine. Capacitor and Trusted Web Activity run the game in a WebView. Tauri runs it in the platform WebView, Electron in bundled Chromium. Each of them will show today's freezes, on phones more often than on the Mac. So the order is: engine work (section 3), then the look and UX (sections 4 and 5), then wrap and submit.

### 6.2 Options

| Option | Effort | Web demo | Stores | Ceiling |
|---|---|---|---|---|
| A. Fix the web engine, wrap with Capacitor (iOS, Android) and Tauri (Steam, Windows, Mac) | weeks, one codebase | yes, same build | all four | high for 2D once the sim is off the main thread |
| B. Port to Godot 4 | months, full rewrite, second codebase for the site | only via a heavy web export | all four, first class | highest |
| C. Wrap today's code now | days | yes | yes | same freezes, worse on phones; store reviews would say so |

Recommendation: A. The sim is pure TypeScript with no DOM dependency, which is exactly the shape that moves to a Web Worker or a native wrapper without a rewrite. B only pays off if 2D WebGL turns out to be the limit, and for a sprite game it is not.

### 6.3 Web build versus store build
This is Matt's call, not the engineering's. Three shapes:
1. Full game free on the web, store builds paid and adding offline play, cloud saves and achievements. Simplest marketing, weakest store conversion.
2. Web build capped as a demo (for example two stars or 15 floors, then a card with store links), full game in the stores. The landing page already frames the browser build as the product; the copy would change.
3. Full game everywhere, stores paid, web free. Only works if the web build is deliberately the lesser experience (no sound, no cloud save).

The PolyForm Strict licence chosen on 2026-09-20 fits all three.

### 6.4 Store mechanics
- iOS: Capacitor in Xcode; Matt has the account. Needs a native splash, the save moved from IndexedDB to the Capacitor filesystem or Preferences plugin, and Game Center for achievements if wanted.
- Android: Capacitor as well, rather than a Trusted Web Activity, so both phones share one native shell and the save path. TWA stays possible for a lightweight listing.
- Steam: Tauri 2 (small binary, platform WebView) with the Steamworks SDK through a Rust crate for achievements and overlay. Electron only if the WebView gap on Windows bites.
- Cloud save: a later item; the sim's save format is already a versioned string, so it syncs as a blob.

## 7. Sequencing

1. Engine round (section 3): the ranked fixes, measured against the bench hashes so behaviour does not change. Ship as 0.3.0.
2. Look round (section 4): resolution and scale first, then light, then motion, then sound. Each is a ship.
3. UX round (section 5): first run and goals, then overlays, then controls.
4. Store round (section 6): Capacitor iOS first because the account is ready, Android second, Steam last.

Each round ends with the itworks closeout as before. Mandate (Matt, 2026-09-22): the implementing session runs all four rounds top to bottom without waiting for a go between them, closing out and deploying each; it stops only for store account actions, pricing, or a new licence question. Wall publishes still need a separate explicit yes.

## 8. Questions and answers

Answered by Matt on 2026-09-22 and recorded in .itworks/DECISIONS.md:

0. The freeze is the people and cars stalling while the chrome stays live. The loop fix in section 3.2 item 1 is the answer; the engine round spec is at docs/reviews/2026-09-22-engine-round-spec.md.
2. Low horizon: yes. Two parallax bands of distant low buildings and hills, drifting clouds. No tall city.
3. Web versus store: the browser build is a demo capped by tower size only (floors and footprint), everything else open within the cap. Store builds carry the full game with a generous listing. The cap figure is set in the look round, once the new default zoom shows how much tower fits a screen.

4. Double resolution: structure (tiles, floors, slabs, shafts, cars, people) in one pass, then rooms kind by kind across ships, hotel and office first. A tower with mixed room fidelity may ship for a round or two; a mixed grid may not.

Nothing is open. The plan of record is sections 3 to 7 in that order.
