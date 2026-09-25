# Lane F2: Art, interiors, and the illustrated look at 7b4e60f

## Suspicions

### S1. Dragging an elevator bakes a new full-height ghost texture for every span it passes through, and none is ever freed (proposed: IMPORTANT)
- Where: src/render/art.ts:1970-1975 (`ghost` caches by `ghost:${tiles}:${floors}:${ok}` in the never-evicted `cache`), fed per floor by src/game/game.ts:596-628 through src/render/renderer.ts:1833. Same pattern for `shaft` at art.ts:1946-1950 (a new texture per span after every extend; the old one stays cached).
- Input: pick the express elevator and drag from B10 up to floor 100 (or drag-extend an existing shaft across that range). Each floor the pointer crosses changes `heightFloors`, and each (height, ok) pair is a new RenderTexture. A standard elevator drag is not limited to its 30 floor span either: past 30 floors the ghost turns red and keeps baking.
- Wrong outcome: GPU memory grows with every distinct span and is never given back. The probe measured 222 ghost textures and 1,374.9 MB at DPR 2 (343.7 MB at DPR 1) for express spans 1 to 111, both ok and refused. Ok-only is about 690 MB. A standard drag from 1 to 30 floors alone is 34.3 MB at DPR 2. The tallest ghost is 15,984 device px at DPR 2, which is over the 8192 max texture size many mobile GPUs report. On a phone this points to WebGL context loss or missing ghosts. The renderer has no `webglcontextlost` handling (grep in renderer.ts finds none), so context loss would blank the tower. I could not check that on a GPU. If it is confirmed on a device, this is CRITICAL. Expected: at most a handful of live ghost textures, or a ghost drawn at one floor high and stretched (it is a flat fill, outline and tile guides), or the old ghost textures evicted.
- Reproduce: `cd` to the repo and run `npx vite-node@6.0.0 <scratchpad>/f2/probe.ts` (the file is `/private/tmp/claude-501/-Users-matthew-parallax-private-Projects-hundred-stories/59100aac-82b1-4a98-947c-f0845463d155/scratchpad/f2/probe.ts`). It calls `art.ghost(6, n, ok)` for n 1..111 on a fake renderer and prints `art.stats()`. To confirm in the browser: drag an express shaft from B10 to 100 in the DevTools Memory or GPU panel and watch the numbers grow.

### S2. The elevator ghost is drawn one floor off when its span crosses the ground floor (proposed: ADVISORY, cross-lane: renderer.ts / game.ts)
- Where: src/render/renderer.ts:1836 and 2354 place the ghost at `floorTopY(ghost.floor + ghost.heightFloors - 1)`, which mixes floor and band arithmetic. src/game/game.ts:604 and 571 pass a band count, and game.ts:624 passes `floorMax - floorMin + 1`, which counts the missing floor 0.
- Input: extend a shaft to span B3..2, or park a touch placement over it. Separately, drag a new shaft from B1 to 1.
- Wrong outcome: for the extend or pending span B3..2, the ghost covers y -72..288, which is floors 1..B4, when it should cover y -144..216, which is 2..B3. The whole box sits one floor low. For the new drag B1..1, the ghost covers y -72..144, three floors down to B2, when the real span is two floors. The stop bands from overlays.ts:410-419 use `floorAtBand` correctly, so the box and its bands disagree. The build verdict and the shaft that gets built are correct. Only the preview is wrong.
- Reproduce: the `node -e` computation in Coverage below, or in the game: take the elevator tool and drag from B1 to 1. The green box reaches into B2.

### S3. A missing 2D context becomes a blank texture, cached forever, with no warning (proposed: ADVISORY)
- Where: src/render/art.ts:1895-1906
- Input: `getContext('2d')` returns null. iOS Safari does this once total canvas memory passes its cap, and every illustrated texture keeps its canvas alive through CanvasSource.
- Wrong outcome: `paint` skips drawing, wraps the empty canvas, caches it and counts its bytes. That interior, sign, person or crowd atlas stays invisible for the whole session, even after memory frees up. Nothing throws, so guardArt never falls back and nothing is logged. Expected: throw or warn so `extra` or `call` falls back, and do not cache the empty result.
- Reproduce: take the harness in tests/render/art-classes.test.ts:39-42, return `getContext: () => null`, and call `art.sim('worker','calm',0,0)` twice. You get the same texture both times, no warning, and `stats().illustrated.textures === 1`.

### S4. Waste-backlog dirt, daytime dirty hotel rooms and cockroaches do not show in the world (proposed: ADVISORY)
- Where: src/render/light.ts:52 (only a hotel at night reads `dirty`). art.ts and interiors.ts have no dirty or infested branch.
- Input: a tower with a recycling center, and an office that holds 6 or more waste for 2 rolls. `room.dirty` is held set (rules.ts WASTE comment). Or a hotel room that is dirty at 12:00, or one that is infested.
- Wrong outcome: the room draws exactly like a clean one. Only the room panel says "Needs cleaning" or "Cockroaches" (panels.ts:380-381). The lane invariant lists "dirty" as a state every kind must draw. VISUAL.md only promises the hotel night lamp, so this may be intended (see Questions).
- Reproduce: `windowStateOf({kind:'office',dirty:true,occupancy:0,...}, true, new Set())` gives 'vacant', and by day it gives 'day' for every kind.

### S5. The file header says five door positions are baked; the code bakes three (proposed: ADVISORY)
- Where: art.ts:19 against art.ts:1956. The comment is stale and misleads anyone budgeting textures.

## Questions for the owner
- The bake resolution is fixed for the life of the renderer (grid.ts:43-45). A window moved from a 1x to a 2x screen stays soft until reload. Nothing leaks. Is that the intended trade-off?
- Should a backlogged or infested room get an in-world sign (a bin, a roach), or is the panel enough? This is S4.
- Rooms on fire tint only the shell sprite (renderer.ts:1196). The illustrated fixtures and decor over it are not tinted. Is that intended?

## What the tests do not prove
- tests/render/interiors.test.ts: drawing goes through a no-op context, so nothing checks that fixtures stay inside their band or produce finite coordinates. Only rule sizes are tried. It never pairs `room()` with every WindowState, and it has nothing on dirty, fire or vacant.
- tests/render/art-classes.test.ts: nothing on cache growth for ghost or shaft spans, nothing on the `getContext` null path, no DPR change, and no max texture size check for tall shafts or ghosts. Sweep is tested on art alone, not on which live set the renderer passes.
- tests/render/sim-art.test.ts: figure geometry only. It never goes through art.ts `paint`.
- tests/render/variety.test.ts: nothing on a newer room repainting when an older neighbor is demolished. carFinishes is only tried with identical floor ranges.

## Coverage
- Read in full: src/render/art.ts (2161), src/render/interiors.ts (1768), src/render/illustrated.ts (789); reference: src/sim/types.ts, src/sim/rules.ts, src/render/venue.ts, src/render/light.ts, src/render/grid.ts, .itworks/DECISIONS.md, docs/VISUAL.md, docs/DESIGN.md section 9, the Lane F2 section of LANES.md, and the four probe test files.
- Read in part (to trace callers): renderer.ts 270-300, 583-637, 750-780, 870-900, 1130-1420, 1515-1570, 1820-1845, 2195-2296; game.ts 555-635; camera.ts floor helpers; overlays.ts 400-420; thumbnail.ts head; ui.ts 835-880.
- Skipped: none in scope.
- Probes run:
  - `npx vitest run tests/render/interiors.test.ts tests/render/art-classes.test.ts tests/render/sim-art.test.ts tests/render/variety.test.ts`: 4 files, 65 tests pass.
  - `npx vite-node@6.0.0 scratchpad/f2/probe.ts`: 340 bakes (every kind with 4 window states x variants 0, 1 and shell, every look base, every shut) at DPR 2, 0 throws, 0 non-finite canvas arguments. Ghost growth as in S1.
  - `node -e` ghost placement check: span -3..2 is drawn at -72..288 and should be at -144..216. Spans that stay above or below the ground are correct.
  - grep: no Math.random or Date in art.ts, interiors.ts or illustrated.ts. `performance.now` is used only for the sweep clock. Variants, flips and finishes use the seed and id through `mix` (unsigned, so `%` is never negative). Map iteration order does not change results: tested for variants, and carFinishes sorts by x then id.
  - The flat-rectangle fallback holds: guardArt wraps every call, the extras fall back to Texture.EMPTY, and the crowd atlas has its own try.
