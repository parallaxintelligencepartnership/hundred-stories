# Performance investigation, 2026-09-22

Investigation only. Nothing changed under src/, tests/ or scripts/. All scratch tools (tower builder, CDP driver, motion model, profiles) are in the session scratchpad, not the repo.

## Summary

Matt's freezes did not show up as main-thread stalls in any run. The desktop runs used a small tower much like his (8 floors, 80 tiles wide, about 180 sims, stairs, two shafts, hotel, condos, shops) on a real GPU. There were no long tasks, 60 fps, and the main thread was 88 to 97% idle at 1x and at 4x. The sim tick on that tower costs 0.01 to 0.3 ms.

What does reproduce is a motion problem: **people and cars stop and lurch on screen while the frame rate stays at 60**. We tracked the drawn sprite positions every frame. Moving sims show no movement in 21% of frames at 1x, 27% at 2x and 42% at 4x. At 4x, 12.7% of sim frames and 9.6% of car frames jump more than three times the median step (up to 136 px). The cause is in the loop design, not in CPU cost. The sim advances on a 50 ms `setInterval` that is not locked to the display. The renderer's interpolation alpha measures progress toward a tick that has not run yet, and it clamps at 1. So sprites catch up early, wait for the timer, then jump. This matches what Matt reports ("people and elevators freeze") better than any CPU explanation.

## Method and caveats

- Baseline: `npm test` passed 621 of 621 in 35 files. `npm run typecheck` is clean. Bench figures are below; the six hashes from hash.ts did not change.
- The realistic tower was built with the build commands in a scratch copy of the bench builder, warmed to day 3 at 08:30, serialized, and written into IndexedDB (`hundred-stories` / `saves` / `autosave`) over CDP in a fresh headless profile. Then /play/ was loaded and resumed the save.
- The GPU backend is important. We ran most tests with `--use-angle=metal` on this Mac's real GPU (ANGLE Metal, Apple A18 Pro). Metal works in headless=new. With SwiftShader, frames were GPU bound at 11 to 14 fps even while paused, and the main thread was 98% idle. **SwiftShader frame times measure software rasterisation, not the game.** Only the SwiftShader CPU-profile figures are usable.
- Runs: the dev server (5180) and a production build served from the scratchpad with `vite preview` (5182). 1440x900 at DPR 2. A phone proxy at 390x844, DPR 3, with 4x CPU throttling. 30 s per scenario.
- The in-page `longtask` PerformanceObserver reported zero long tasks in every run. The rAF frame deltas agree: no frame went over 100 ms on Metal. We did not independently confirm that the observer fires in headless.

## Measurements

### Bench baseline (node, vite-node 6.0.0)

| tower | sims | rooms | tick median ms | tick p95 ms | serialize ms | hash ms | JSON bytes |
|---|---|---|---|---|---|---|---|
| small | 1,080 | 360 | 0.059 | 0.185 | 1.76 | 4.35 | 725,630 |
| medium | 2,604 | 714 | 0.096 | 0.795 | 4.32 | 11.40 | 1,744,037 |
| large | 4,920 | 1,195 | 0.225 | 3.415 | 7.52 | 22.42 | 3,272,550 |

bench4 (medium, 4x, 20 s): step median 0.55 ms, p95 8.44 ms, max 13.3 ms. 0 of 400 steps over 50 ms.
Hashes: small 4dee77a3 / 7151c613, medium d3ba899e / e2cafb93, large 823b38bb / d4023cca.

### Tick cost across a whole day (node)

| tower | day p50 | p95 | p99 | max | notes |
|---|---|---|---|---|---|
| Matt-like, 2 shafts, 180 sims | 0.010 | 0.28 | 0.44 | 21.6 | lone spikes (05:00, 03:24) are GC or JIT; over 8 days p999 was 11.7 ms and max 42 ms |
| Matt-like, 1 shaft | 0.011 | 0.14 | 0.21 | 2.5 | |
| medium, 2,604 sims | 0.09 | 2.93 | 4.37 | 6.6 | worst hour is 18:00 (p95 5.9 ms) |
| large, 4,920 sims | 0.20 | **34.6** | **48.3** | **59.1** | 17:00 to 21:00: p95 25 to 52 ms per tick; 305 ticks over 8 ms, 8 over 50 ms |

bench3 measures 200 ticks from 09:00, after the morning rush, so it never sees the evening rush. At 18:00 on the large tower there are 1,153 waiting sims. `tickPeople` takes 46 ms per tick; elevators 0.3 ms; events 0.

### Browser: Matt-like tower, production build, Metal, 1440x900 at DPR 2, 30 s each

| scenario | fps | frame p50 / p95 / p99 / max ms | frames over 50 ms | long tasks | script ms | layout ms | GC share | main thread idle |
|---|---|---|---|---|---|---|---|---|
| 1x | 60.1 | 16.7 / 16.7 / 16.8 / 33 | 0 | 0 | 1,750 | 87 | 0.1% | 94.2% |
| 4x | 60.1 | 16.7 / 16.7 / 16.8 / 16.8 | 0 | 0 | 2,403 | 190 | 0.3% | 92.7% |
| paused (renderer only) | 60.0 | 16.7 / 16.7 / 16.8 / 16.8 | 0 | 0 | 1,356 | 0 | 0.1% | 96.2% |
| off screen (sim + UI), 4x | 60.0 | 16.7 / 16.7 / 16.8 / 16.8 | 0 | 0 | 2,319 | 213 | 0.3% | 91.0% |
| 4x with office tool and mouse moving | 60.0 | 16.7 / 16.7 / 16.8 / 16.8 | 0 | 0 | 2,625 | 255 | 0.1% | 88.3% |
| 4x with event log panel open | 60.0 | 16.7 / 16.7 / 16.8 / 50 | 0 | 0 | 2,169 | 294 | 0.2% | 90.2% |

Phone proxy (390x844, DPR 3, 4x CPU throttle): 60 fps at 1x, 4x, paused and off screen. No long tasks. Frame max 100 ms once at 1x.

Dev server, same tower, Metal, top self time at 4x: `runSearch` (routing.ts) 1.0%, `reconcileRooms` (renderer.ts) 0.5%, GC 0.4%, `searchFrom` 0.2%, then Pixi internals (`collectRenderables`, `_setWidth`, `addRenderable`), `setText` (ui.ts) 0.2%, `packQuadAttributes`, `setSize`, `reconcileSims`. Everything else is under 0.1%. Paused: `reconcileRooms` 0.3%, Pixi `setSize` / `_setWidth` / `_setHeight` 0.4%, `reconcileSims` 0.1%.

The production profiles show minified names (`fd`, `we`, `dd` in the share chunk). The dev profiles above map them.

SwiftShader, DPR 1, dev: 13 to 14 fps at 1x, 4x and paused, and 25 fps off screen. Main thread 97.6 to 99.1% idle. **All frame figures in this row are GPU-bound SwiftShader cost, not the game.**

### Browser: large bench tower (4,920 sims), Metal, DPR 2

| run | fps | frame max | long tasks | main thread busy | top self time |
|---|---|---|---|---|---|
| prod 4x | 60 | 50 | 0 | 29% | two minified sim functions 17% (routing, per dev run) |
| prod paused | 60 | 33 | 0 | 15% | renderer reconcile, Pixi setSize |
| dev 4x | 59.7 | 67 | 0 | 29% | `runSearch` 11.2%, `findRoute` 6.8%, `reconcileRooms` 1.6%, `reconcileSims` 0.7%, `set tint` 0.5% |
| dev paused | 60.1 | 33 | 0 | 14% | `reconcileRooms` 2.8%, Pixi `setSize` 1.2%, `simIsVisible` 1.1%, `reconcileSims` 1.0%, `floorTopY` 0.9% |

Open discrepancy: the production 4x run reached 06:41 on the next day, so it went through the evening rush. It showed no long tasks and no frame over 50 ms, yet node measures 25 to 59 ms per evening tick on the same save. The dev 4x run ran slow (about 33 ticks/s against 40), which is the time box working. We ran out of budget before explaining why the node and Chrome figures differ. Treat the evening-rush tick cost as real for the 100-floor ceiling, not for Matt's tower.

### Motion: drawn sprite positions per frame (prod, Metal, 10 s per speed)

| speed | moving sims: frames with no movement | sims: frames with a jump over 3x median | sim max jump px | moving cars: frames with no movement | cars: frames with a jump over 3x median | car p95 / max px |
|---|---|---|---|---|---|---|
| 1x | 21% | 1.7% | 72 | 29% | 0% | 6.4 / 8 |
| 2x | 27% | 0.8% | 104 | 35% | 0% | 13.3 / 19 |
| 4x | **42%** | **12.7%** | 136 | 28% | **9.6%** | 49.5 / 108 |

We replayed the captured step and rAF timestamps through a model of `frame()` and `interpolated()`. Frames where alpha is clamped at 1 (the sprite waiting on the timer): 37% at 1x, 72% at 2x, 91% at 4x. Snaps past `TELEPORT_PX`: sims 3.7/s and cars 2.4/s at 4x. At night 4x, walkers teleport every step (20/s). A synthetic 120 Hz display is worse: 56% still frames at 4x. Real step intervals were p5 49.2 / p50 50.0 / p95 50.9 / max 52.2 ms, so about 1 ms of jitter is enough to cause all of this.

## Ranked findings

### 1. Loop and interpolation split makes people and cars stop and lurch (the "freeze")
- **Where:** src/game/game.ts:249-256 (`frame`: `Math.min(1, loop.accumulator + elapsed * rate)`), src/game/game.ts:760 (`setInterval(step, 50)`), src/render/renderer.ts:679-711 (`interpolated`: `px = cx` on a target change, snap past `TELEPORT_PX` at :699), src/render/renderer.ts:146.
- **What happens:** ticks run in 50 ms batches (2 per step at 4x, 16 at night 4x). The renderer lerps from the previous drawn target to the new one. Its alpha is the fraction of the *next* tick interval that has passed, clamped at 1. At 4x alpha reaches 1 after 25 ms, so the sprite covers two minutes of movement in 25 ms and then stands still for 25 ms. Timer jitter turns 2-tick steps into 1 or 3, and a 3-tick move (120 px for a walker, 108 px for a car) is past `TELEPORT_PX` and snaps. At 1x a step that lands just after a frame still leaves one frame in three or four standing still.
- **Evidence:** the motion table above, on a real GPU at a steady 60 fps.
- **Fix:** drive `drainTicks` from `frame()` while the tab is visible and keep the 50 ms interval only as the hidden-tab fallback. Keep a snapshot of every drawn entity's position before each tick batch and lerp snapshot to current with `alpha = (now - batchStart) / batchDuration`, where `batchDuration = ticksRun / rate`. That spreads however many ticks ran across the real time they stand for. Scale the teleport threshold by ticks per batch, so only real discontinuities snap (entering, alighting). Night 8x will always be fast; decide separately whether it should be drawn as a fade rather than as motion.
- **Expected gain:** still frames drop from 21-42% to near 0%, and lurches at 1x to 4x disappear. CPU cost is unchanged.
- **Risk:** medium. The loop tests (`stepOnce`, `drainTicks`, autosave idle slot) need care, and so does the hidden-tab behaviour.
- **Bench hashes:** no change. Tick order and count per game minute stay the same; only when a tick runs moves.

### 2. The time box does not bound a single tick; the evening rush is the real sim ceiling
- **Where:** src/game/game.ts:96-115 (`drainTicks` checks the clock after `runTick`), src/sim/people.ts:462-530 (`updateStress` → `retryHallCall` → `rerouteWaitingSim` → `findRoute`), src/sim/routing.ts:261 (the goal scan walks every settled state per trip), src/sim/routing.ts:311-316 (linear-scan priority queue with `splice`).
- **What happens:** one tick costing more than `MAX_STEP_MS` runs to completion. On the large tower the evening rush costs 25 to 59 ms per tick in node, and `tickPeople` takes 46 ms with 1,153 sims waiting. The dev browser profile puts routing (`runSearch` + `findRoute`) at 18% of wall time at 4x. bench3 samples 09:00 and never sees this.
- **Why it costs:** every waiting sim re-asks routing on a retry schedule. Each ask runs a search for its own origin tile (origins differ by x), then a full scan of the settled map to pick the goal.
- **Fix:** (a) add an evening sample (17:00 to 19:00) to bench3 so the ceiling is measured. (b) Key the per-minute search cache by floor and connector instead of by exact tile, adding the walk cost afterwards (the invariant comment at routing.ts:166 allows this if the tie-breaks are kept). (c) Index settled nodes by floor so the goal scan only looks at the target floor. (d) Use a binary heap instead of scan plus `splice`.
- **Expected gain:** evening rush on the large tower likely drops below 8 ms per tick (estimate, not measured).
- **Risk:** (b) risks tie-break drift. (c) and (d) are mechanical.
- **Bench hashes:** (c) and (d) must stay hash-identical. (b) could change hashes if the tie-breaks move, so check it against hash.ts.
- **Not verified:** which of retry, reroute or new trips dominates the 46 ms. The node CPU profile attempt captured only the npx wrapper.

### 3. The renderer rewrites every room, slab and shaft sprite every frame
- **Where:** src/render/renderer.ts:760-824 (`reconcileRooms`: `setSize`, `position.set` and `tint` on every room and slab each frame, :786, :810, :811), called from :1427. Also :916 (a full pass over all sims just to count visible sims, then a second pass).
- **What happens:** O(rooms + sims) work per frame even when nothing changed. A long lobby is one room per tile.
- **Evidence:** on the large tower while paused, `reconcileRooms` + Pixi `setSize` / `_setWidth` / `_setHeight` + `simIsVisible` / `drawn` / `inCrowd` + `floorTopY` come to about 7% of wall time, roughly 1.2 ms per frame. On Matt's tower it is 0.3 to 0.5%.
- **Fix:** reconcile the static tower only when a change counter moves (build, demolish, fire, the lit bit at night). Otherwise touch only cars and sims. Later, cache the static tower as a RenderTexture per floor band.
- **Expected gain:** about 1 ms per frame at 1,200 rooms, and about 10 ms at 100 floors.
- **Risk:** low. The lit and onFire toggles must mark the room dirty.
- **Bench hashes:** no change (render only).

### 4. UI work per step: double update, forced layout, panel rebuilds
- **Where:** src/main.ts:64 and src/ui/ui.ts:320 both subscribe `update()`, so the whole HUD refresh runs twice per notify. src/ui/ui.ts:417 and :436: with a tool in hand, `positionPlacement` reads `getBoundingClientRect` right after the text writes, a forced layout 20 times a second plus every rAF. src/ui/panels.ts:662-676: the open log panel rebuilds 200 list items whenever a log line lands. src/ui/panels.ts:258: the room panel creates flag spans on every refresh just to compare them.
- **Evidence:** with the tool in hand, `getBoundingClientRect` is 0.8% of wall time and layout is 255 ms per 30 s. The log panel raises DOM nodes to 2,489 and layout to 294 ms per 30 s. Cheap on this Mac, and not the freeze.
- **Fix:** delete one of the two subscriptions. Batch DOM reads before writes, or position the chip from the ghost rect without measuring every step. Append only new log items. Build flag spans only when the flag string changes.
- **Expected gain:** small on desktop; worth doing before phones.
- **Risk:** low.
- **Bench hashes:** no change.

### 5. The sky allocates a new FillGradient per colour change and never destroys it
- **Where:** src/render/sky.ts:170-181.
- **What happens:** during dawn and dusk the colours change every game minute. Each change creates a FillGradient, which makes a canvas and a Texture when it is built. `gradient.clear()` does not destroy the old one. At 4x that is up to 40 gradients a second over the transition.
- **Evidence:** no visible cost in 30 s runs (heap 10 to 25 MB, GC at most 0.5%). Found by static read, not by profile.
- **Fix:** keep one 256x1 gradient texture and redraw its canvas, or `destroy()` the previous FillGradient.
- **Expected gain:** less GC and texture churn over long sessions.
- **Risk:** low.
- **Bench hashes:** no change.

### Lower
- src/sim/people.ts:206, :317, :463, :561, :608: five `[...world.sims.values()]` copies per tick. O(sims) allocations; GC stays under 1% even at 4,920 sims.
- src/render/renderer.ts:979 and nearby: sim sprites are destroyed when a sim boards a car or leaves the view, then recreated with `new Sprite`. Pooling would remove the churn. It did not show in the profiles.
- src/render/art.ts:1361-1376: textures are baked lazily on first use. The first dusk bakes every lit room variant within a few frames, and ghost textures bake per size during drags. The cache is bounded by kinds and sizes. No spike showed in 30 s runs; baking the known set at boot would remove the risk.
- The rAF in game.ts and Pixi's own ticker are two separate rAF chains. The positions Pixi draws are the ones set in the previous frame's `game.frame`, so every frame is drawn with one frame of latency. Harmless, but it falls away with finding 1.

## Architecture

### (a) Move the sim to a Web Worker?
Not for Matt's tower: the sim there costs under 0.3 ms per tick. For the 100-floor goal it is the right end state, because a single tick cannot be sliced (finding 2) and a Worker moves that cost off the frame. Suggested message boundary:
- Main to worker: `{ type: 'command', cmd }`, `{ type: 'speed', speed }`, `{ type: 'save' }`, `{ type: 'load', text }`.
- Worker to main, once per tick batch: a transferable snapshot. A `Float32Array` of drawn sims (id, x, floor, kind, band, state bits), cars (id, y, doorsOpen), and dirty room ids with their lit and onFire bits. Plus deltas for cash, clock, population, stars, new log lines and command results. The sampled one-in-four crowd would be chosen in the worker, so the payload stays near 1,000 records even at 20k sims.
- Commands must be applied at a tick boundary in the worker to keep determinism and the hash tests intact. The game.ts `GameApi` would read a mirrored world summary, and panels would read snapshot fields, not live `world`.
- Cost: every UI read of `game.world` (panels, pickers, placement checks via `canBuild`) needs either a mirror or an async round trip. `canBuild` for the hover ghost would need a mirrored copy of the static tower on the main thread.

### (b) What the renderer needs
1. Motion fix first (finding 1). It is the only visible problem today.
2. A static tower layer. Rooms, slabs, floor strips and shafts only change on build, demolish, fire and the night lit bit. Keep them in containers reconciled on a change counter. At 100 floors, render each band of about 10 floors into a RenderTexture and redraw a band only when one of its rooms changes.
3. Camera culling. Sims are culled with a one-viewport margin already; rooms are not. Skip reconciling and drawing bands outside the view, or set `cullable` with a cull area on each band container.
4. A texture atlas baked at boot. Every room kind, width, variant and lit state is known from rules.ts. Bake them into one or two atlas pages, so batches stop breaking on texture count and there is no lazy bake at the first dusk.
5. Sprite pooling for sims and cars, or the existing ParticleContainer path for any count (today it switches on at 500 visible).

### (c) Realistic ceiling and the shortest path to it
- Today: on this Mac the renderer and UI stay at 60 fps at 4,920 sims (up to 29% main thread busy at 4x). The node figures put the sim near its limit at about 5,000 sims in the evening rush (up to 59 ms per tick, which the time box turns into slow motion), although the browser run did not show that cost (see the open discrepancy). A 100-floor tower with 15,000 to 25,000 sims and 5,000 or more rooms (lobby tiles included) would, extrapolating linearly, spend about 5 to 10 ms per frame on room reconcile alone. The sim would also stay in slow motion through both rushes. Phones would be two to four times worse.
- Shortest path, in order:
  1. Fix the loop and interpolation (finding 1).
  2. Add the evening-rush sample to bench3, then the routing work (finding 2 c and d, then b). Also the by-kind room index already noted in HANDOFF.md.
  3. Static tower layer and culling (finding 3 and b.2 / b.3).
  4. Boot-time atlas.
  5. Worker, only if steps 1 to 4 still leave rush-hour ticks over about 8 ms at the target size.

Steps 1, 3 and 4 do not touch sim behaviour. Step 2 must keep the six hashes.

## What was tried and did not reproduce a freeze
- Matt-like tower on dev and production builds, Metal at DPR 2, 1x / 4x / paused / off screen / tool in hand / log panel open: no long tasks and no frame over 50 ms.
- Phone proxy with 4x CPU throttling: no long tasks.
- SwiftShader: slow throughout (GPU bound), not in bursts.
- 8 in-game days of ticks in node on the Matt-like tower: max 42 ms, one-off, consistent with GC.
- Not tried: a headed Chrome window on a 120 Hz display (the model says the stutter is worse there), Matt's actual save, a Chrome session hours long, a real phone.
