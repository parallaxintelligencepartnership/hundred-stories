# Engine round spec: frame-driven ticks and true interpolation

Date: 2026-09-22, revised the same day after the Codex Sol review (docs/reviews/2026-09-22-codex-sol-engine-spec-review.md). For: senior-implementer (Opus 5.5, medium). Authorised by Matt: the fix, tests, and the motion measurement. Not authorised: commits, deploys, version bumps, any change under src/sim/, scripts/bench/ or the save format.

Background: docs/reviews/2026-09-22-performance-investigation.md finding 1. The sim ticks on a 50 ms setInterval (src/game/game.ts, `step` and the `setInterval(step, 50)` in `start`), the renderer runs on requestAnimationFrame (`frame`), and `frame` passes `Math.min(1, loop.accumulator + elapsed * rate)` as the interpolation alpha. That alpha reaches 1 before the next timer step lands, so sprites finish their move early, stand still, then jump; timer jitter turns two-tick batches into three and the move crosses `TELEPORT_PX` in src/render/renderer.ts `interpolated`, which snaps. Measured: moving people stand still in 21% of frames at 1x and 42% at 4x on a main thread over 90% idle.

## The change

### 1. Ticks run from the frame loop when the tab is visible
- Factor the body of `step()` into `advance(): number` (dt from `time.now()` and `last` with the existing one second cap, accumulate `dt * rate`, `drainTicks` with the existing limits, then `notify()` and `maybeAutosave` when ticks ran; returns ticks run). `frame()` calls `advance()` then renders. `step()` calls `advance()` only when hidden.
- Add `hidden: () => boolean` to `GameClock`, injectable like `now` and `scheduleIdle`. Default: `() => typeof document === 'undefined' || document.hidden`. A missing document counts as hidden so the existing `stepOnce` tests in tests/game/loop.test.ts keep driving the sim unchanged.
- Gate both drivers symmetrically: `frame()` returns without advancing when `hidden()` is true (rAF should not fire then, but a throttled browser can), and `step()` returns without advancing when it is false.
- `start()` adds a `visibilitychange` listener that sets `last = time.now()` when the document becomes visible; `stop()` removes it. Hidden progress stays best effort, as today: the one second dt cap in `advance` already drops hidden time beyond a second per timer callback, and this round does not change that. Say so in a comment.

### 2. Snapshot before the last tick, alpha is the fractional accumulator
- New pure module src/render/interpolate.ts holding what `interpolated` and the two maps (`simInterp` and the car map) do today, as a class `Motion` with: `commit(key, x, y)` records the position before the last tick; `target(key, x, y)` records the current position and returns whether the move is a teleport (either axis past `TELEPORT_PX`, threshold passed to the constructor); `at(key, alpha)` returns the drawn point; `forget(key)` and `reset()`. On a teleport `commit` and `target` collapse to the new point. No settle rule: if a tick did not move the entity, commit and target are equal and `at` is that point at any alpha. Move `TELEPORT_PX` and `park` (renderer.ts near line 714) semantics into it. The renderer keeps its sprite maps and calls `Motion` instead of `interpolated`.
- `drainTicks` gains an optional `beforeLastTick?: () => void` in its options and calls it once, immediately before running a tick that will leave `loop.accumulator < 1` or that is the last allowed by `maxTicks` or the time box is about to cut (check the time box condition after the tick as today; the last-by-accumulator case is the one that matters). The hook is called at most once per drain. In node tests with no hook nothing changes.
- The game passes a hook that asks the renderer to `commitMotion(world)`: for every drawn sim and every car, `motion.commit(key, x, y)` from the world's current positions. On a one tick batch it commits the pre-tick position; on a five tick night batch it commits the position before the fifth tick. Cost: one pass over drawn entities per frame in which ticks ran.
- `frame()` passes `loop.accumulator` as alpha, clamped to [0, 1). The `elapsed * rate` term goes. Rendered position is `commit + (target - commit) * alpha`, so the sprite reaches its target as the next tick fires, and a multi-tick batch draws as uniform motion of N ticks per frame with a fractional smooth on the last.
- `speed === 0` or `world.gameOver`: alpha 1, as today.

### 3. Teleport threshold stays per tick; motion resets on discontinuities
- `TELEPORT_PX` is unchanged and not scaled. With the snapshot before the last tick a jump past it is always a real discontinuity (entrance, alighting, a load).
- `importSave` and `newGame` in game.ts (the paths that replace `world`) call `renderer?.resetMotion()`, which is `motion.reset()`; the sprite maps rebuild on the next render as they do now. The renderer's own cleanup of departed sims (renderer.ts around line 977, `simInterp.delete`) becomes `motion.forget`.

### 4. Sky gradient leak (mechanical, same round)
- src/render/sky.ts around lines 170 to 181 creates a new FillGradient or texture on each colour change and never destroys the previous one. Keep a reference and destroy the old one after the new one is applied. No visible change.

## Tests (must pass, `npm test` and `npm run typecheck`)
- tests/game/loop.test.ts: the existing `drainTicks`, `stepOnce` and autosave cases stay green without edits. Add:
  - Frame-driven: fake clock stepping 16.667 ms per frame, speed 4, `hidden` false, 60 frames: exactly 40 ticks ran in total, no frame ran more than one tick, and the alpha handed to a stub renderer is always in [0, 1).
  - Hook timing: speed 4 at night (rate 320 per second), 12 frames: batches alternate five and six ticks and `beforeLastTick` fired exactly once per frame with ticks, and the world minute observed inside the hook is always the final minute minus one.
  - Hidden fallback: `hidden` true, `frame` never called, `stepOnce` every 50 ms for one second at 1x: 10 ticks ran. `hidden` false, `stepOnce` called: zero ticks ran and the accumulator did not move.
  - Visible again: after a hidden second driven by `stepOnce`, flip `hidden` to false and run one frame: at most one tick runs.
- New tests/render/interpolate.test.ts on `Motion` directly:
  - Night 4x scenario: an entity walking one tile per tick, batches alternating five and six ticks over 12 frames with alpha cycling through the fractional accumulator: drawn x is monotonic and each frame's displacement is within one tile of the batch size; then a batch that does not move it: drawn x stays exactly on the target at every alpha (no bounce).
  - Teleport: a 13 tile jump with commit and target snaps at alpha 0; a 5 tile jump lerps.
  - `reset` forgets everything; `forget` forgets one key.
- The open ADVISORY in .itworks/REVIEWS.md (renderer draw loops uncovered) is not closed by this; note it as unchanged.

## Verification
1. `npm test`, `npm run typecheck`, `npx vite-node@6.0.0 scripts/bench/hash.ts`: the six hashes match the 0.2.4 values in the investigation report (the sim is untouched, so any drift is a bug).
2. Rerun the motion measurement from the investigation on the production build at 1x, 4x and night 4x, 10 s each, with the same Matt-like tower (the specialist's scratch scripts tower.ts, track.py and the CDP driver are under the session scratchpad; recreate from the report's method if they are gone). Report still-frame and jump percentages before and after. Target: still frames under 3% at 1x and 4x, jumps over 3x median under 1% at 4x, and at night 4x per-frame displacement within one tile of uniform. Use the real GPU, not SwiftShader.
3. Hidden tab by hand: production preview at 1x, switch tabs for 30 s, switch back: the clock advanced roughly 300 game minutes minus whatever the one second cap dropped under throttling, no burst of movement, no console error.
4. Load by hand: play a minute, import the same save from the settings panel: no sprite slides across the tower after the load.

## Report back
Under 300 words: the before and after motion table, test counts, the six hashes, files touched with line ranges, and anything you had to decide that this spec did not cover (stop on that fork rather than guessing).
