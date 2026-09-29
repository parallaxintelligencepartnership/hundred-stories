# Lane F1: Renderer core at 0f05723

Host: arm64 (uname -m). All reads and probes in the read-only checkout. Probe file: scratchpad/f1-0928/f1.test.ts (the reconcile.test.ts stub-pixi harness, with the canvas listeners captured so taps go through the real pointer handlers). Run: `cd scratchpad/f1-0928 && ./node_modules/.bin/vitest run --root . --silent=false --reporter=verbose f1.test.ts`.

The 2026-09-25 findings F1 S1 to S8 and verify-F N2 are fixed at this commit and are not raised again: worldReplaced (renderer.ts:2785) drops every per-id cache, the strip signature, the weather and the curb; picks and rings use drawnAt (:2197, :2337, :2371); the modifier guard is at :2607; pickRoomAt takes the highest connector id (:237); builtFloorExtents uses spanFloors (:720).

## Suspicions

### S1. A tap on a person selects the neighbor one tile to the right, and the left one cannot be tapped at all (proposed: IMPORTANT)
- Where: src/render/renderer.ts:764-787 (`pickSimAt`: every drawn sim within PICK_RADIUS_TILES = 1.5 is a candidate, and `sim.id > best.id` wins, whatever the distance), with :805-819 (`inRoomSlot` puts the in-room people one pitch apart, in id order).
- Input: an office at x 100 on floor 3 with two sampled workers inside (ids 4 and 8). The office pitch is floor((9-2)/6) = 1 tile, so they are drawn at tiles 101 and 102, next to each other. The same happens with two walkers one tile apart in a lobby.
- Wrong outcome: a tap anywhere on the worker at tile 101 (tile 100.6, 101.0 or 101.4) returns `{"simId":8}`, the worker at tile 102. Worker 4's sprite spans 100.5 to 101.5, and every point of it is within 1.5 tiles of worker 8, so worker 4 cannot be picked by a tap. It can only be reached through the room panel's occupant list, which works (the ring then goes round tile 101). The "newest draws on top" rationale (:757) only holds when the sprites overlap. Here they do not overlap at all. This breaks the lane invariant "Picking returns the thing the player sees on top". For walkers there is no workaround until they move apart.
- Reproduce: probe P1. The output is `drawn people [101,102]`, then `tap at tile 100.6 -> {"simId":8}`, `101 -> 8` and `101.4 -> 8`. In the pure rule, a tap at the dead center of sim 4 (120.0), with sim 8 drawn at 121, gives 8. Fix direction: pick the nearest drawn point and use the id only as a tie-break. tests/render/crowd.test.ts only covers overlapping sprites.

### S2. A chrome re-measure throws away a camera move made with the minimap or a gamepad (proposed: ADVISORY)
- Where: src/render/renderer.ts:2943-2950 (`setChrome` calls `frameInitial` while `!userMoved`). `userMoved` is set only by canvas pointerdown, wheel and keys (:2480, :2574, :2595, :2608). The minimap (ui/minimap.ts:287) and the gamepad (ui/ui.ts:1661, 1666) move the camera directly and never set it.
- Input: a player moves the view only with the minimap or a pad, then something changes the chrome band: the phone build sheet opens (ui.ts:414), the palette is collapsed (ui.ts:1781), Larger text is turned on, or a resize wraps the top bar.
- Wrong outcome: the view jumps back to the opening shot. The probe gives an opening of x 1608 / y -96 at zoom 0.5, a pan to x 4608 / y -896, and after `setChrome(60,300)`, x 1608 / y 204 at zoom 0.5.
- Reproduce: probe P4.

### S3. A burning shop keeps its neon strip blinking at night, and the restaurant steam and cinema marquee run while closed or burning (proposed: ADVISORY)
- Where: src/render/ambient.ts:187-210. The sign strip is gated only on `night && shopOpen`. The steam and the marquee are not gated at all, and nothing reads `room.onFire`. The renderer's own rule at :1754 and :1782-1783 is "A burning room gives no light: ... its lit sign go out while it burns".
- Input: a shop on floor 2 at 20:00 (open, night), set on fire.
- Wrong outcome: the lit sign face is hidden, but the amber neon strip under it stays visible and keeps blinking over the flames. A restaurant steams at 03:00 when it is closed. A cinema marquee cycles its colors all night.
- Reproduce: probe P2 prints `shop onFire = true | lit sign face visible = [ false ] | neon strip visible = [ true ] tint f0c419`.

### S4. Once the art falls back to flat rectangles, stairs and escalators draw nothing (proposed: ADVISORY)
- Where: src/render/renderer.ts:653-665 and :675 (after `broken`, the guarded `interior` still exists but returns Texture.EMPTY), with :1636 (`roomTexture` sends overlay kinds to `art.interior` whenever it exists). The fallback's connector diagonal (:552-562) is never reached.
- Input: any throw from the real `art.room`. In the probe, the boot bake (bakeRoomStates, :1110) throws once.
- Wrong outcome: the stairs sprite is `{ empty: true, w: 128, h: 112 }`. It is invisible, but it can still be picked and hovered. The fallback is meant to keep the tower readable.
- Reproduce: probe P3.

### S5. The car floor indicator reads "1" until the car is three quarters of the way down to B1 (proposed: ADVISORY)
- Where: src/render/led.ts:45-48 (`Math.round(y)`). The ground is skipped, so the drawn position is band (y+1)/2 for y between -1 and 1 (camera.ts:78). `Math.round(-0.5)` is -0, so the label shows "1".
- Input: a car travelling from floor 1 to B1.
- Wrong outcome: the label shows "1" down to y = -0.5 (band 0.25, 75 percent of the way down). Going up, it shows "B1" until 25 percent of the way. Between two floors above ground, the label switches at the midpoint.
- Reproduce: `node -e` over y in [1, 0.5, 0, -0.5, -0.51]. The labels are 1, 1, 1, 1, B1.

## Questions for the owner
- After a tower switch (Today's tower, a friend's tower, Open a saved file, New game), game.ts:576, :1284 and :1351 call `camera.reset()`: zoom 1, the middle of the lot, the street at 0.68. So neither BB-1's whole-tower opening nor D-1's roof framing is applied. `frameInitial` is private, and `userMoved` is never reset. Should a switched-to tower open whole, as the game does at boot? Home already does this on a keyboard. A phone has no Home key.
- The flicker counter (renderer.ts:2273) and the art sweep clock use real time or their own counters. That is correct: none of it reaches the world. It is noted here only because the brief lists determinism leaks. No write to the world was found (grep for assignments to world, room, sim, shaft and car fields in the lane files: none).

## What the tests do not prove
- tests/render/crowd.test.ts: pickSimAt is tested only with overlapping sims. There is no case of two drawn sims one tile apart, which is S1.
- tests/render/reconcile.test.ts: it never taps through the pointer handlers (the fake canvas drops listeners). It has no fire over a venue's ambient emitters (S3), no degraded art path (S4), and no check that the price and the buildFx flash leave with a room demolished mid-effect.
- tests/render/camera.test.ts: it never turns reduced motion on while an easeY or easeX is running. setReducedMotion (camera.ts:215) zeroes inertia and lands a snap but leaves an ease to finish, for up to about 0.5 s of eased motion. It never tests setChrome after a non-pointer camera move (S2).
- tests/render/input.test.ts: pure helpers only. The renderer's pointer state machine (regrip, a third finger, right and middle pan, toolOwnsDrag) is untested.
- tests/render/structure-version.test.ts: covers commands and startFire. Fire spread and put-out, bomb damage, and occupancy crossing zero through a real tick are not driven.
- tests/render/overlays*.test.ts: no basement rooms, and nothing for the wait view's shaft stop tints (drawShaftStops) or the stripe alignment across neighboring rooms.
- tests/render/car-indicator.test.ts: it never tests the label across the missing floor 0 (S5).

## Coverage
- Read in full: src/render/renderer.ts (3029 lines), camera.ts, input.ts, interpolate.ts, grid.ts, palette.ts, light.ts, anim.ts, ambient.ts, buildfx.ts, overlays.ts, thumbnail.ts, hierarchy.ts, smoke.ts, led.ts; tests/render/reconcile, camera, input, structure-version, overlays, overlays-color-blind; .itworks/DECISIONS.md, the MAP.md Gotchas, the LANES.md F1 section and its rules; audit-2026-09-25 lane-F1.md and verify-F.md. Read in part for tracing: sim/world.ts (the structure-version writers, roomsOnFloor, shaftAt), sim/build.ts (cost, lobby floor), sky.ts (isNight, gradient), venue.ts (venueOpen), illustrated.ts (signBoard, shopSignStrip), game.ts (swapWorld, attach, advance), ui/ui.ts (watchChrome, gamepad, minimap wiring), ui/minimap.ts, ui/layout.ts, main.ts (the smoke DEV gate), crowd.test.ts, snapshot.test.ts (by grep), and pixi 8.21.0 GenerateTextureSystem (the snapshot frame is in the stage's local space, cleared transparent, and the sky gradient covers the screen).
- Skipped: none in scope.
- Probes run:
  - `npx vitest run` on the six lane test files: 123 of 123 pass.
  - f1.test.ts P1 to P4: all four print the outcomes quoted above.
  - Demo world: src/render/smoke.ts is imported only by main.ts:109, behind `import.meta.env.DEV`, and by the landing hero (site/hero.ts:125, settled 2026-09-19 and 2026-09-20). No build was run: a vite build would write a config timestamp file into the checkout.
  - Reduced motion: interpolated() returns the target, drag inertia is zeroed, the wheel snap lands at once, ambient emitters are empty, buildFx is cleared, the doors snap, poses hold, and there is no load fade. The one gap is the ease noted under camera.test.ts.
- Coverage gaps (need a real browser or GPU): the share snapshot on a phone GPU, and WebGL context loss (grep of src finds no handler). To close them, open https://hundredstories.xyz/play/ on a phone with Safari Web Inspector attached, press Share, and watch the console for errors. The other gap is a pan key held before Cmd is pressed on macOS: press W, then Cmd, release W, then Cmd, and watch whether the view keeps drifting.
