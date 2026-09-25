# Verification of lanes F1, F2, F3 at 7b4e60f

Host: arm64 (uname -m). HEAD 7b4e60f. I read DECISIONS.md in full. I re-ran the reviewers' probes and got the same output: f1probe/f1.test.ts (P1 to P4), f2/probe.ts (222 ghosts, 1374.9 MB, 15,984 px) and f3/probe.ts. My own probes are in scratchpad/verifyF/. render.test.ts is the reconcile.test.ts stub harness, with the canvas and window listeners captured so taps and keys go through the real handlers, and the real createGame for the ghost feed. ghost.test.ts runs the real game ghost feed into the real createArt at DPR 2. f2s34.ts is a vite-node script. Run each with `node_modules/.bin/vitest run --root <scratchpad>/verifyF --silent=false <file>`, or `npx vite-node@6.0.0 <file>` from the repo. I did not touch the repo.

Read in full: src/render/renderer.ts, curb.ts, render/weather.ts, tests/render/reconcile.test.ts. Read in part: art.ts (1-60 and 1820-2161, the cache, paint, ghost, shaft and sweep; the drawing code is not involved), game.ts (240-300, 375-400, 540-850), camera.ts, hierarchy.ts, people.ts and elevators.ts (the sites I cite), and a grep of weatherfx.ts and status.ts.

## Verdicts: lane F1

### S1. A room id reused across towers keeps the old layer - CONFIRMED (final: IMPORTANT)
- Reproduction: I built both towers with real `applyCommand`: 24 lobby tiles, then stairs in tower A and an office in tower B. Both got **id 25**. Render A, then run the swapWorld sequence (resetMotion, setSelection(null), setGhost(null), camera.reset), then render B. The office sprite's parent is `connectors`. In the reverse direction, the stairs end up in `rooms` and the connector layer is empty. A fresh renderer puts the office in `rooms`. Ids restart at 1 in every world, so this is common after Today's tower, a friend link, New game or Open a file. It lasts until reload, and nothing tells the player to reload.
- Fix spec: in reconcileRooms (renderer.ts:1180-1193), when `drawsOverRooms(entry.kind) !== drawsOverRooms(room.kind)`, reparent or recreate the sprite. Better: on a world swap, drop every per-id cache (room, slab, venue, shaft and car sprites, and `stripSignature`). That also fixes S3 and S4. Test: P1 as a reconcile test, with the office parent `rooms` after the swap. It fails today. Must not change: no rebuild on a same-world render, and build feedback still plays only on newly placed rooms.

### S2. People are picked and ringed at the room center, and at far zoom people nobody can see get picked - CONFIRMED (final: IMPORTANT)
- Decision quoted (2026-09-20): "the renderer draws one sim in four, chosen by id so a sim is always drawn or never drawn; the simulation, economy and save are untouched, and **a tap can only select a drawn sim**". This finding enforces that ruling. It does not re-flag it.
- Reproduction (render.test.ts "F1 S2", real pointer handlers): office at x 100, worker id 400 in the room, pos.x 104 (roomCenter, people.ts:507). The sprite is drawn at tile 101. A tap on the drawn person gives `{"roomId":17}`. A tap on empty floor at tile 104 gives `{"simId":400}`. The ring spans x 1648..1680, but the sprite is at 1608..1624. At zoom 0.300 the people layer and the solo sprite are both hidden, yet a tap on the office block gives `{"simId":400}`. That breaks the quoted rule outright.
- Fix spec: record each drawn sim's draw point in reconcileSims and hit-test against it in pickAt, not against `sim.pos`. Skip sim picks when `plan.people === 'selected'`. Put the ring on the same recorded point. Test: in the harness, a tap on the in-room sprite gives the simId, a tap on the empty center gives the roomId, and a far-zoom tap gives the roomId. Must not change: undrawn (unsampled) sims stay unpickable, and a walker's pick radius stays at 1.5 tiles.

### S3. A shop sign keeps the old tower's brand and mirror - CONFIRMED (final: ADVISORY)
- Reproduction: P2 re-run. With seed 5, the panel says "Juniper & Co." and the sign says "Ashby Supply". With seed 6, "Vela Boutique" against "Ashby Supply". renderer.ts:1210 and 1259 never compare `venue` or `flip`.
- Fix spec: the world-swap cache drop from S1, or compare `venueOf(...).name` and `interiorFlip` in syncVenue. Test: P2 expects the sign to match the panel name.

### S4. Floor strips, curb doors and weather boxes skip their rebuild when the built signature collides - CONFIRMED (final: ADVISORY)
- Reproduction: P3 re-run. The strip bounds are `1600 -360 144` before and after the swap, while world B's office is at 4800 px. `curbDoors`, `weatherFloors` and `weatherBasement` are set only in rebuildFloorStrips (renderer.ts:1119-1121), so they go stale too.
- Fix spec: reset `stripSignature = -1` on a world swap. Test: P3 expects the bounds to move.

### S5. The camera keeps panning after Cmd+A - PARTIAL (final: ADVISORY)
- Holds: dispatching keydown `{code:'KeyA', metaKey:true}` through the real window listener moved camera.x from 3016 to 2152 in 1 s with no keyup. The Ctrl and Meta guard (renderer.ts:2120) covers only plus and minus.
- UNVERIFIABLE HERE: the claim that macOS browsers drop the keyup of a key released while Cmd is held. Manual step: in Safari or Chrome on macOS at /play/, press Cmd+A, release A, then Cmd, and watch whether the view keeps drifting left.
- Fix spec: skip `camera.setKey` when `metaKey || ctrlKey || altKey`. Test: the same probe expects camera.x unchanged.

### S6. The ring on a riding person stays at the hall - CONFIRMED (final: ADVISORY)
- Reproduction: a sim riding in a car at y 9. The ring is visible at y -62..2 (floor 1). The car sprite is at floor 9. Boarding (elevators.ts:315-316) never moves `pos`.
- Fix spec: in drawOverlay, hide the ring for `!simIsVisible(sim)` as drawSolo does, or ring the car. Test: this probe.

### S7. Overlapping flights: pick follows x order, drawing follows build order - PARTIAL (final: ADVISORY)
- Does not hold as written: stairs are 8 tiles wide, so A at x 108 (tiles 108..115) and B at x 100 (tiles 100..107) do not overlap. Tile 110 is only in A.
- Holds with a corrected input: A at floor 2, x 104 and B at floor 3, x 100. Both are accepted by `applyCommand` (ids 43 and 44). The draw order is [104, 100], so B is on top. `pickRoomAt(floor 3, tile 106)` returns A (id 43).
- Fix spec: among the connectors covering a tile, pick the one drawn last (highest id, with sprites ordered by id). Test: this probe expects id 44.

### S8. A B1-to-ground flight gets no ground-floor strip - CONFIRMED (final: ADVISORY)
- Reproduction: stairs at floor -1 are legal (`{"ok":true}`). `builtFloorExtents` on that world returns only `[-1]`.
- Fix spec: use `spanFloors(room.floor, room.height)` at renderer.ts:662. Test: the keys are -1 and 1.

## Verdicts: lane F2

### S1. Elevator drag bakes a full-height ghost per span, never freed - CONFIRMED (final: IMPORTANT; CRITICAL if the phone step below shows context loss)
- Reproduction (ghost.test.ts, real game.ts ghostFor and showPendingGhost into the real createArt at resolution 2):
  - A, mouse drag of an express from 1 to 100: **100 textures, 558.5 MB, tallest 14,400 device px, 44 over 8192**.
  - B, drag-extend of an existing express from 1..60 to 100: 41 textures, 362.7 MB, every one over 8192.
  - C, touch drag from 1 to 30 parked, then the up button 40 times: 30 textures (34.3 MB), then 70 textures, 183.2 MB, tallest 10,080 px, 14 over 8192.
  - D, a realistic mid game (standard shafts 1..15 and 15..44): 30 textures, 34.3 MB, tallest 4,320 px.
  - E, the shaft panel's Extend up pressed 98 times: **98 `shaft:` textures, 558.2 MB**. The old spans are never freed (art.ts:1946-1949).
  - The cache key is (tiles, floors, ok), so growth is bounded at 440 ghost keys. Re-dragging the same spans costs nothing.
- Normal play or not: game speed plays no part. Every `setGhost` caller is pointer or placement code (game.ts:250-622), and no tick path touches it, so a 4x player is no worse off than a 1x player. The texture passes 8192 px at DPR 2 for any span of 57 floors or more (57 × 144 = 8,208). /play/ is the 'web' edition with no floor cap (rules.ts:277-279), so floors run from -10 to 100. The trigger is a normal late-game action: an express (3 stars) or a nudged standard spanning more than 56 floors, which is how a player serves a 100-floor tower. On a phone one drag cannot cover 100 floors: at min zoom 0.175 a floor is 12.6 CSS px, so a portrait screen holds about 50-55 floors. Path C (drag, then the ▲ button) reaches it anyway. Early and mid game (under about 57 floors, standard shafts up to 30) stays near 34 MB and under the limit.
- UNVERIFIABLE HERE: what a phone does with a 14,400 px RenderTexture and about 0.5 GB of GPU memory. Phone step: open https://hundredstories.xyz/play/ on the phone with Safari Web Inspector (or Chrome remote debugging) attached and run `(()=>{const g=document.createElement('canvas').getContext('webgl2');return g.getParameter(g.MAX_TEXTURE_SIZE)})()`. Then, in a 3-star tower, take the Express elevator, drag up from floor 1 and press ▲ past floor 60. Watch for the outline vanishing past floor 56 and for "WebGL: context lost" or a blank canvas. The app has no context-loss handling (grep of src finds none). Pixi's handler (GlContextSystem.js:178) only calls preventDefault, and baked RenderTextures do not survive a restore.
- Fix spec: do not bake a ghost per height. Draw it as a Graphics redrawn on change, or as a one-floor texture with a nine-slice or tiled body, or evict the previous `ghost:` key when the key changes. The same goes for `shaft:`: tile per floor, or free the old span on extend. Test (art-classes style, a recording fake generateTexture): ghosts for 1..110 and shafts for 1..110 bake no texture over 8192/resolution logical px and leave at most a few live ghost keys. It fails today. Must not change: how the ghost and shaft look at 1 to 30 floors, and the stop bands.

### S2. The elevator ghost is one floor off across the ground floor - CONFIRMED (final: ADVISORY)
- Reproduction: the real game feed gives `{heightFloors:3, floor:-1}` for a new drag from B1 to 1 (game.ts:624 uses `floorMax - floorMin + 1`), and `{heightFloors:5, floor:-3}` for an extend from B3..1 to B3..2. The renderer draws them at y -72..144, which is floors 1 to B2 (should be -72..72), and y -72..288, which is floors 1 to B4 (should be -144..216, floors 2 to B3).
- Fix spec: use the band count at game.ts:624. Have renderer.ts:1836 and :2354 place the top at `floorTopY(floorAtBand(bandOf(floor)+h-1))`, or pass `floorMax` in the Ghost. Test: the probe's expected y ranges. Must not change: room ghosts, including stairs at -1 with height 2, which are correct today.

### S3. A null 2D context is cached for good as a blank texture - CONFIRMED (final: ADVISORY)
- Reproduction (f2s34.ts): `getContext` returning null gives the same texture on both calls, 1 getContext call, 0 warnings, and 1 illustrated texture counted.
- Fix spec: on a null context, warn once and do not cache (or throw so guardArt falls back). Test: the second call tries getContext again and one warning is logged.

### S4. Dirty, infested and backlogged rooms draw like clean ones - PARTIAL (final: ADVISORY)
- Holds: `windowStateOf` gives `vacant` for an empty dirty office at night, `day` for a dirty hotel at noon and `day` for an infested hotel. Only a dirty hotel at night gives `housekeeping`.
- Does not hold as a defect: VISUAL.md:37 specifies exactly these four states ("housekeeping, a dirty hotel room at night"). The stricter rule is the audit's own lane invariant (LANES.md:130), not a spec. This is an owner question: should dirty or infested rooms get an in-world mark?
- Fix spec (only if the owner says yes): add a `dirty` or `infested` mark layer in syncVenue. The test is a window-state or mark assertion per kind.

### S5. The header says five door positions are baked; the code bakes three - CONFIRMED (final: ADVISORY)
- Reproduction: art.ts:19 says "cars with five baked door positions", but art.ts:1954-1956 maps to `[0,2,2,2,4]`.
- Fix spec: correct the comment.

## Verdicts: lane F3

### S1. The curb draws people walking into the door during a fire - CONFIRMED (final: IMPORTANT)
- Reproduction ("F3 S1", the real renderer and curb): a ground lobby from x 100 to 139, an office on fire with a fire event, and 40 `outside` workers, stepped over 40 s. The fire engine is at the curb (`vehicle|fire`, visible). **23 street figures were tracked, all 23 moving toward a door, and 19 reached within 3 px of it** before vanishing through it. curbFigures (curb.ts:51, 63) gives every `outside` sim `heading:'in'` and never reads `world.events`. The sim holds these people outside (people.ts:247-249). The picture breaks the 2026-09-24 ruling "no arrivals enter the tower while a fire is burning", given for Matt's reason that "people walking into a burning building is bad design". It also breaks the lane invariant "Figures drawn during a fire are not walking into the entrance".
- Fix spec: pass the fire state into curbFigures and give held kinds `heading:'out'` or a standing pose while `emergencyVehicle(world) === 'fire'`. Test in curb.test.ts: with a fire event, no figure has heading 'in' and none reaches offset 0. Must not change: the umbrellas, the 12-figure sample, or the no-fire behavior.

### S2. Rain, umbrellas, wet street and the curb sample carry over a tower switch - CONFIRMED (final: ADVISORY)
- Reproduction: in the harness, a rainy tower A (seed 4, 40 outside sims) swapped to a clear tower B (seed 1). B's sims have the same ids, all `inRoom`. For up to 500 ms after the swap, **7 street figures under 7 umbrellas are drawn from B's indoor sims**. At 900 ms there are 0. The f3 probe re-run gives rain 2,000 ms and a wet street 41,967 ms, against a fresh load that shows the street dry (wet 0). resetMotion (renderer.ts:2306-2315) does not resettle `weatherView` (:925), the weatherFx `wet` (weatherfx.ts:255, 454), or the curb's `sampledAt`.
- Fix spec: when render sees a replaced world, set `weatherView = settledView(weatherNow(new))`, reset `wet` to -1, and resample the curb. Test: the harness expects 0 figures and 0 umbrellas on the first frame after the swap.

### S3. At 2x and 4x the HUD says Rain while no rain is drawn - CONFIRMED (final: ADVISORY)
- Reproduction: f3 probe re-run. At 320 min/s (4x at night, 10 × 4 × 8) the HUD shows Rain for 1,133 ms and rain is drawn for 0 ms. At 160 min/s, 2,250 against 483. status.ts:388 reads the raw snapshot, while the renderer eases at 0.25 per second (weather.ts:16). No decision covers this.
- Fix spec: have the HUD show the eased view's leading kind, or ease faster when the block is short. Test: a status test at 320 min/s where the label and `rainFalling` agree.

### S4. A leaving person is drawn inside the tower and on the street at once - CONFIRMED (final: ADVISORY)
- Reproduction: sim 1004, `leaving`, on floor 10. In **45 of 60 frames** it is drawn both in the `people` layer and in the curb.
- Fix spec: curbFigures keeps `leaving` only on floor 1 within the lobby span (or only after finishLeave). Test: this probe expects 0.

## Duplicates
- One family, **"a tower switch keeps the previous tower's state"**. game.ts swapWorld (385-397) resets only motion, selection, ghost and camera. Neither the renderer (resetMotion, renderer.ts:2306) nor the sound controller has a new-world reset. Members: F1 S1 (room layer by id), F1 S3 (venue brand and mirror), F1 S4 (strip, door and weather-box signature), F3 S2 (weather ease, wet street, curb sample), lane G S1 (the tension or threat carried over, since primeTap skips `fire.resolved`) and lane G S2 (chapter, tempo and key read once). One fix pattern covers them all: a single "world replaced" hook that the renderer and the sound both honor.
- F3 S1 and F3 S4 are distinct defects in the same function (curbFigures).

## Notes
- N1 (new, ADVISORY; its severity rides on the F2 S1 phone step): the **built** express shaft texture also passes 8192 px. `art.shaft(kind, floors)` bakes the whole span (renderer.ts:1556, art.ts:1949), so a finished express from 1 to 100 needs a 14,400 px texture for as long as it stands (probe E, tallest 14,400). If the phone limit is 8192, fixing only the ghost leaves the real shaft blank. The F2 S1 fix must cover both. Reproduce: ghost.test.ts E.
- N2 (new, ADVISORY): picking a person from the room panel's occupant list (panels.ts:405) who is outside the one-in-four sample rings empty floor at `pos`. No sprite exists there. drawOverlay (renderer.ts:1866-1875) checks neither `inCrowd` nor `simIsVisible`. Reproduced: render.test.ts "verify N2". With sim 401 in the room, the ring is visible at x 1648 and 0 people sprites are drawn.
