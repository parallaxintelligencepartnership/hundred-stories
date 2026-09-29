# Lane F2: Art, interiors, and the illustrated look at 0f05723

## Suspicions

### S1. After any art failure, stairs and escalators draw as nothing, not as the flat fallback (proposed: IMPORTANT)
- Where: src/render/renderer.ts:1635-1636 (`roomTexture` returns `art.interior(...)` for overlay kinds whenever `art.interior` exists), together with guardArt at renderer.ts:651-664 (`extra` returns `Texture.EMPTY` once `broken` or `extrasBroken` is set) and renderer.ts:675 (`guarded.interior` is always installed). The flat drawing for connectors exists in fallbackArt `room()` (renderer.ts:550-561) but is never reached. The Art contract in art.ts:122-128 makes the interior "the whole room" for connectors, and art.ts:536 gives them no shell. Same pattern in src/render/thumbnail.ts:74 (palette tile).
- Input: any throw from an art call. A throw in a primary call (room, slab, shaft, car, sim, ghost) sets `broken`. A throw in any extra (venue, interior, decor, shut, sign, glow, prop, mark, umbrella, vehicle) sets `extrasBroken`. After either, the next day/night change (or a newly built flight) re-textures the flight.
- Wrong outcome: every staircase and escalator becomes `Texture.EMPTY` and vanishes from the tower. The page stays up, but the lane's first invariant ("degrades to flat rectangles, never blank") fails for the one room family that has no shell. Expected: when the extras are off, overlay kinds use `art.room(...)` so the backup draws its diagonal. I found no input that makes the current draw code throw (see Probes: 4,772 bakes, 0 throws), so the severity depends on the invariant, not on a known trigger. The verifier may reasonably lower it to ADVISORY.
- Reproduce: scratch/audit-2026-09-28/f2/degrade.test.ts (the reconcile.test.ts stub harness, with the repo imports made absolute). Run it from that dir with `./node_modules/.bin/vitest run --root . degrade.test.ts --silent=false --reporter=verbose`. Output: `extras before: interior|stairs|8|2|0` then `extras after: Texture.EMPTY` (warn "art.interior failed, the illustrated extras are off"), and `primary after: Texture.EMPTY` (warn "art.room failed, falling back to flat rectangles").

### S2. The 2026-09-25 S3 fix does not reach the screen: a blank bake is never asked for again (proposed: ADVISORY)
- Where: art.ts:1983-1991 now returns `Texture.EMPTY` without caching it, so that "the next ask tries again". But syncVenue (renderer.ts:1650-1653) creates a room's layers once and rebuilds them only when the width, floors or variant change. Fixtures (:1671), decor (:1680), sign and glow (:1694, :1700) and pools (:1710) are never asked for again.
- Input: `getContext('2d')` returns null while a room's layers are first built, as on iOS Safari at its canvas memory cap, which is the premise of the original finding. Memory is freed later.
- Wrong outcome: that room's fixtures, sign, decor and light pools stay invisible for the whole session, even after contexts work again. Every lobby tile goes through the same path. The art-level test (art-classes.test.ts "a canvas with no 2D context") passes, but nothing redraws.
- Reproduce: the same file, test "keeps a shop blank after the context comes back". Art returns EMPTY until `contextBack`, then real textures. Three later renders at 13:00, 01:00 and noon, each with a structure change. Output: `asks before 41 asks after 41 shop interior sprites 0 sign sprites 0 EMPTY sprites 50`.

### S3. A structural shell is baked for stairs and escalators that is never shown (proposed: ADVISORY)
- Where: renderer.ts:327-339 (bakeRoomStates calls `art.room` for every room shape) against renderer.ts:1635-1636 (overlay kinds never use `art.room`).
- Input: a tower with stairs or an escalator.
- Wrong outcome: `room:stairs:8:2:2:day` and `room:escalator:8:2:2:day` are baked at boot. All four states collapse to one key (art.ts:2026), and the texture is only an outline, because drawShell returns at art.ts:536. It is 256×288×4, about 295 KB each at DPR 2, and no sprite ever shows it. It is small and bounded, but it is a texture baked for nothing.
- Reproduce: code trace. Or run `art.stats().byKey` after `bakeRoomStates(createArt(...), world)` with one flight: the key is present, and no sprite in the reconcile harness carries a `room|stairs` texture while `art.interior` exists.

## Questions for the owner
- Dirty, backlogged and infested rooms still draw like clean ones by day (last audit's S4, which went to the owner). No ruling in DECISIONS.md yet. Is the panel enough?
- The bake resolution is still fixed when the renderer is created (art.ts:1898). Asked last time, still unanswered.

## What the tests do not prove
- tests/render/interiors.test.ts: it draws through a no-op Proxy context, so nothing checks that fixtures stay inside their band. The bake crops silently (paint originY), so a fixture drawn above the band disappears with no signal. The closed-hours test `continue`s when `spec.closed` is missing, so a kind with `open` but no `closed` (a closed state with no interior) would pass. Nothing at renderer level checks that the closed, burning or vacant-at-night states show a layer.
- tests/render/art-classes.test.ts: the null-context test covers art.ts only, not the renderer asking again (S2). The guardArt degrade path, including overlay kinds, is untested (S1). GHOST_KEEP is proven against art alone. That it is safe relies on the renderer holding exactly one ghost sprite (renderer.ts:2300), and no test says so.
- tests/render/sim-art.test.ts: figure geometry only. It never goes through art.ts `paint` or the sweep.
- tests/render/variety.test.ts: nothing covers demolishing an older neighbor, which repaints a newer room (by design, but not pinned). carFinishes is tried only with identical floor ranges.
- Needs a real browser (coverage gaps): actual canvas pixels and band cropping, iOS `getContext` null at its memory cap, real GPU texture bytes, and WebGL context loss (src has no handler). Commands: `node scripts/make-design-sheet.mjs --textures` for the live texture budget. Headless Chrome with `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist` on `/play/?new`, grepping the console for `render: art.` warnings. Safari Web Inspector on an iPhone at /play/ for the null-context path.

## Coverage
- Read in full: src/render/art.ts (2279), src/render/interiors.ts (1780), src/render/illustrated.ts (793); tests/render/interiors.test.ts, art-classes.test.ts, sim-art.test.ts, variety.test.ts; .itworks/DECISIONS.md; the LANES.md F2 section and the lane-independent rules; the MAP.md Gotchas; docs/reviews/audit-2026-09-25/lane-F2.md and verify-F.md.
- Read in part (callers): renderer.ts 319-341, 495-720, 1095-1110, 1250-1300, 1420-1500, 1600-1800, 1955-2030, 2280-2340, 2685-2710, 2890-2915; thumbnail.ts 50-100; ambient.ts 55-75; light.ts 23-80; world.ts 90-115; venue.ts venueOpen and mix; tests/render/reconcile.test.ts harness.
- Skipped: none in scope.
- Last audit's items: S1 (ghost and shaft textures past 8192) is fixed. Ghosts are capped at maxBakeFloors with GHOST_KEEP 2 and dropGhosts. Shafts are split into 32-floor pieces, which the renderer stacks correctly. S3 is fixed in art.ts but not end to end (S2 above). S5 (the header comment) is fixed. S2 (the ghost position) is outside this lane now (renderer.ts spanTop).
- Probes run:
  - `npx vitest run tests/render/interiors.test.ts tests/render/art-classes.test.ts tests/render/sim-art.test.ts tests/render/variety.test.ts`: 4 files, 74 tests pass.
  - `npx vite-node@6.0.0 ../audit-2026-09-28/f2/probe.ts`: at DPR 2, every kind × variants 0, 1 and shell × 4 window states, every look's interior and decor, every shut, cars (every door position and finish, including -1 and 5), signs at widths 1 to 40 with long and empty names, props, marks, vehicles, glow, the crowd atlas, 11 sim kinds × frames -1..8 × odd looks, and every kind's interior and shut at 1 to 40 tiles × 1 to 4 floors. 4,772 textures, 1.29 M context calls: 0 throws, 0 non-finite arguments, 0 negative arc, ellipse or gradient radii.
  - Scratch `degrade.test.ts` (S1, S2): the results are quoted above.
  - grep: no Math.random or Date in the three files. `performance.now` is used only for the sweep clock. The variant, flip and finish hashes are unsigned `mix`. interiorVariants and carFinishes do not depend on order: the tests cover it, and I checked the sort keys.
  - Checked and fine: every RoomKind has an INTERIORS entry, a drawNativeInterior case, a WINDOWS entry and a closed overlay wherever `open` exists. The fire tint reaches venue layers (gradeVenue). Staff textures are in the sweep's live set. Ambient marquee, sign and steam geometry match the drawings.
