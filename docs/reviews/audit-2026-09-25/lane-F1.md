# Lane F1: Renderer core at 7b4e60f

## Suspicions

### S1. After a world swap, a room that reuses an old id stays in the old layer: an office in the connector layer, or stairs in the room layer (proposed: IMPORTANT)
- Where: src/render/renderer.ts:1180-1193 (a kind change only swaps the texture, never the parent layer), with src/game/game.ts:385-397 (swapWorld keeps the renderer, calls resetMotion) and src/sim/world.ts (nextId starts at 1 in every world)
- Input: My tower has stairs with id N. Switch to Today's tower, Friend's tower, a new game or an opened file where id N is an office (ids restart at 1, so shared ids are certain). The reverse also happens: id N is an office in one tower and stairs in the other.
- Wrong outcome: the office sprite stays in `connectorLayer`, above the venue layers, slabs and shafts. Its solid shell covers its own furniture and signs and covers any shaft behind it. In the reverse case the stairs sit in `roomLayer`, under the furniture and the shafts, while `pickTargetAt` still picks them first. This lasts as long as that room exists, until the page reloads. A fresh renderer puts the same office in `rooms`.
- Reproduce: scratchpad/f1probe/f1.test.ts test P1 (world A: stairs id 1; world B: office id 1; render A, resetMotion, render B). Output: `office sprite parent label = connectors`; a fresh renderer gives `rooms`. Run: `cd scratchpad/f1probe && <repo>/node_modules/.bin/vitest run --root . --silent=false --reporter=verbose f1.test.ts`

### S2. A tap selects a person where nobody is drawn: people inside rooms are picked and ringed at the room's center, not at their seat, and at far zoom people nobody can see are picked (proposed: IMPORTANT)
- Where: src/render/renderer.ts:702-716 (pickSimAt uses `sim.pos.x`), :1728 (a person in a room is drawn at `inRoomSlot`), :1866-1875 (the ring uses `sim.pos.x`), :1891-1898 (pickAt never checks `plan.people`)
- Input: (a) An office at x=100 with a sampled worker inside. `enterRoom` sets pos.x to 104, the room's center (people.ts:505). The sprite is drawn at slot tile 101. (b) Zoom below 0.5, where only blocks are drawn, then tap the middle of an occupied office.
- Wrong outcome: (a) A tap on the person drawn at tile 101 misses them (|104-101| > 1.5) and opens the office. A tap on an empty desk at tile 104 opens that person's panel, and the ring sits around empty floor. Picking a person from the room panel's occupant list who is outside the one in four sample also rings empty floor. (b) At far zoom a tap on a block opens a person nobody can see. That breaks the 2026-09-20 ruling that "a tap can only select a drawn sim" and the invariant that the pick is the thing on top.
- Reproduce: f1.test.ts test P4 prints `sprite drawn at tile 101 pos.x (pick and ring) at 104`, `tap on the sprite -> null`, `tap on empty desk at pos.x -> 4`. For (b), trace pickAt at :1898: `pickSimAt(... sampleCrowd)` runs whatever `plan.people` is.

### S3. After a world swap, a shop or restaurant sign keeps the previous tower's brand and mirror (proposed: ADVISORY)
- Where: src/render/renderer.ts:1208-1211 and :1259 (a venue is rebuilt only when its kind, height, width or variant changes; the brand from `venueOf(seed, ...)` and the flip from `interiorFlip(seed, ...)` are not compared)
- Input: both towers have a shop with the same id, width and interior variant but different seeds.
- Wrong outcome: the sign shows the old tower's brand while the room panel (ui/panels.ts:273) shows the new one, and the room stays mirrored as it was in the old tower.
- Reproduce: f1.test.ts test P2. For seed 5 the panel name is "Juniper & Co." and the sign drawn is "Ashby Supply"; seed 6 gives "Vela Boutique" against "Ashby Supply".

### S4. The floor strips, the curb doors and the weather floor boxes skip their rebuild when a swapped world has the same built signature (proposed: ADVISORY)
- Where: src/render/renderer.ts:1111-1141 (`builtSignature` counts rooms and shaft spans, not room positions); resetMotion (:2306) does not reset `stripSignature`
- Input: the two towers have the same room count and the same shafts. For example, an office on floor 5 at x=100 against an office on floor 2 at x=300. Saving to a file, then demolishing one room and building one elsewhere before opening that file, also collides.
- Wrong outcome: the old tower's floor strips stay painted (a floor band floating where the new tower has nothing, and none under its rooms). `curbDoors` (the curb walkers) and `weatherFloors`/`weatherBasement` (rain) also stay stale until the room count changes.
- Reproduce: f1.test.ts test P3. The strip bounds are `1600 -360 144` both before and after swapping to a world whose office is at x px 4800.

### S5. The camera keeps panning after a Cmd+letter shortcut on macOS (proposed: ADVISORY, needs a browser check)
- Where: src/render/renderer.ts:2120-2133 (the Ctrl/Meta guard covers only plus and minus; `camera.setKey(event.code, true)` runs for KeyA, KeyD, KeyS and KeyW whatever modifier is held)
- Input: on a Mac, press Cmd+A (select all) and release A before Cmd.
- Wrong outcome: macOS browsers do not send keyup for a key released while Cmd is held, so KeyA stays in `keys` and the view drifts left each frame until A is pressed again or the window loses focus. Other platforms still pan while Ctrl+A is held. The ui's own keys ignore chords (ui/keys.ts:62); the camera does not.
- Reproduce: in a browser on macOS at /play/, press Cmd+A and watch the view drift. By code trace: keydown with metaKey and code KeyA reaches `camera.setKey('KeyA', true)`.

### S6. The ring on a selected person stays at the hall while they ride (proposed: ADVISORY)
- Where: src/render/renderer.ts:1866-1875
- Input: select a person waiting for an elevator; they board (elevators.ts:295 sets `pos = {floor, x: shaft.x}`, then `state = 'riding'`).
- Wrong outcome: the ring stays at the shaft's left edge on the boarding floor for the whole ride, around nothing. `drawSolo` checks `simIsVisible`; `drawOverlay` does not. The same happens for a selected person who goes `outside`.
- Reproduce: code trace. `drawOverlay` draws a box for any `w.sims.get(simId)` with no state check.

### S7. Two overlapping flights: the pick follows x order, but drawing follows build order (proposed: ADVISORY)
- Where: src/render/renderer.ts:216-223 (`pickRoomAt` takes the last connector in `roomsOnFloor`, which is sorted by x) against :1177 (connector sprites stack in the order they were made)
- Input: stairs A at x=108 based on floor 2 are built first; stairs B at x=100 based on floor 3 are built second. This is legal: different base floors (DECISIONS 2026-09-19). Tap floor 3 at tile 110.
- Wrong outcome: B is drawn on top, but the pick (and the hover card, ui/hover.ts:28-31) returns A.
- Reproduce: code trace. roomsOnFloor(3) is [B(100), A(108)], so the last connector is A, while connectorLayer's children are [A, B].

### S8. A B1-to-ground flight draws no floor strip on the ground floor (proposed: ADVISORY)
- Where: src/render/renderer.ts:662 (`for f = room.floor; f < room.floor + room.height`) covers -1 and 0, and 0 is skipped. It should use `spanFloors`, as rebuildFloorIndex does.
- Input: stairs or an escalator at floor -1 (height 2) where floor 1 has no other room at those tiles.
- Wrong outcome: no strip is drawn behind the ground floor half of the flight, and that span is also missing from the weather floor boxes.
- Reproduce: `builtFloorExtents` on a world holding only that stairs has no key 1.

## Questions for the owner
- The hourly lag for a hotel room going dirty at night is by design (light.ts lightBand, and tested). Nothing else was found that needs a structureVersion bump: car range, serves and stops draw nothing on the static tower, and every onFire, occupancy crossing zero, add or remove goes through the world.ts helpers.
- The smoke and hero worlds set `world.time.minute` to a fraction. That is fine for the hero, but anything that later assumes an integer minute would misread it.

## What the tests do not prove
- tests/render/reconcile.test.ts: the "replaced world" test keeps the same kind and id. It never swaps a connector for a room, never covers venues or signs across seeds, and never checks floor strips or curb doors after a swap.
- tests/render/crowd.test.ts (read for context): pickSimAt is tested only with walkers. There is no in-room person, no ring position, and no far-zoom case.
- tests/render/structure-version.test.ts: covers commands and startFire only. Fire spread and put-out, bomb destruction and occupancy changes through tick are not driven.
- tests/render/input.test.ts: pure helpers only. The renderer's pointer state machine (regrip, pinch to pan, tap vs pan with toolOwnsDrag) and the key handler (modifier chords) are untested.
- tests/render/camera.test.ts: no test turns reduced motion on mid-ease (easeY keeps running) or mid-snap.
- tests/render/overlays*.test.ts: no basement or multi-floor rooms. The wait view's shaft stop tint is not asserted.

## Coverage
- Read in full: src/render/renderer.ts (2447 lines), camera.ts, input.ts, interpolate.ts, grid.ts, palette.ts, light.ts, anim.ts, ambient.ts, buildfx.ts, overlays.ts, thumbnail.ts, hierarchy.ts, smoke.ts; src/sim/types.ts, src/game/api.ts; .itworks/DECISIONS.md, docs/DESIGN.md, docs/VISUAL.md; tests/render/reconcile, camera, input, structure-version, overlays, overlays-color-blind. Read in part for tracing: sim/world.ts, sim/build.ts, sim/people.ts, sim/events.ts, sim/elevators.ts, game/game.ts swapWorld, ui/hover.ts, ui/panels.ts, ui/palette.ts, illustrated.ts carFinishes, vite.config.ts.
- Skipped: none in scope.
- Probes run:
  - `npx vitest run` on the six lane test files: 93 of 93 pass.
  - scratchpad/f1probe/f1.test.ts (stub pixi harness copied from reconcile.test.ts; node_modules symlinked in the scratchpad): P1 to P4 confirm S1 to S4.
  - `grep 20260918 dist/assets/*.js`: only main-*.js (the landing page). play/index.html loads play-*.js and shared chunks without it, and dist-app has none. dist was built at 23:55, after the last src commit. The smoke import in main.ts is behind `import.meta.env.DEV`. The demo world stays out of /play/.
  - grep of src/render for world writes, `.rng`, `Math.random` and `Date`: no writes. The only `Date.now` is art.ts:1850 (the sweep clock, render only). The sim helpers called from render (roomsOnFloor, shaftAt, stressBand, averageTenantStress, noisyNeighborsOf) are read only.
  - Reduced motion: interpolation returns the target, camera inertia and snapping are cut, ambient emitters and build feedback are empty, poses hold, doors snap, and the load fade is skipped. No leak found.
