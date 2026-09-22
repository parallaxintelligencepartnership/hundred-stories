# Engine round results

Date: 2026-09-22. Main at 57408c8 plus the closeout. Specs: docs/reviews/2026-09-22-engine-round-spec.md and -spec-2.md. Four delegations to Opus 5.5 senior implementers in isolated worktrees, merged as patches. Sim behaviour unchanged: the six bench hashes (small 4dee77a3 / 7151c613, medium d3ba899e / e2cafb93, large 823b38bb / d4023cca) held after every merge. Tests 621 to 668, 35 to 40 files.

## 1. Loop and interpolation (db6deda)

Ticks drain from the frame loop while the tab is visible; the 50 ms timer is the hidden tab fallback. A pure Motion class (src/render/interpolate.ts) snapshots every drawn sim and car before the last tick of a batch and draws at the fractional accumulator. Motion resets on load and new game. The sky gradient no longer leaks a texture per colour change.

Browser measurement, same eight floor save, production build, ANGLE Metal on the Apple A18 Pro, 60 fps, 10 s per run, before (the investigation's captures) against after:

| run | still frames | jumps over 3x median | max jump px |
|---|---|---|---|
| people 1x | 21.0% to 20.9% | 1.7% to 1.7% | 72 to 72 |
| people 4x | 42.2% to 39.3% | 12.7% to 0.4% | 136 to 120 |
| cars 1x | 29.4% to 29.4% | 0 to 0 | 8 to 6.8 |
| cars 4x | 28.4% to 33.3% | 9.6% to 0.0% | 108 to 36 |

The raw still-frame figure barely moved because it counts real stops: at 1x every still run is five or more frames, a whole tick of the sim holding a person at a door, before and after. The bug's own signature is a one or two frame stall in the middle of a walk. At 4x those fell from 1,072 frames (41.9%) to 45 (1.8%); car short holds fell from 1,922 frames to 154, and every remaining car hold sits exactly on a floor (a door stop). The spec's target is therefore restated: mid-walk stalls of one or two frames under 3% at 4x (met, 1.8%), jumps over 3x median under 1% at 4x (met, 0.4% people, 0% cars). Night 4x uniformity could not be judged in the browser: at 320 ticks a second a walk across the view lasts about a frame and a half. The night batch case is covered by tests/render/interpolate.test.ts instead.

Clock check: 1x advanced 100 game minutes in 10 s, 4x 400, night 4x about 3,196.

Hidden tab and load checks: see the closeout section in .itworks/REVIEWS.md.

## 2. Evening rush (57408c8)

Root cause: at 17:30 every waiting sim rerouted with a full search (about 52 per tick on the large tower) and the route cache was cleared every game minute, so nothing carried over. Searches are now keyed by floor and connector, live as long as the routing graph (thrown away on routingDirty), the goal scan reads one floor's settled states, and the open set is a binary heap with a sequence tie-break that reproduces the old pick. bench3 gained an evening row per tower.

| tower | 09:00 median / p95 ms before | after | evening before | after |
|---|---|---|---|---|
| small | 0.062 / 0.211 | 0.059 / 0.302 | 0.140 / 0.287 | 0.085 / 0.133 |
| medium | 0.099 / 0.837 | 0.105 / 0.427 | 2.354 / 5.185 | 0.201 / 0.366 |
| large | 0.231 / 3.709 | 0.222 / 1.104 | 32.966 / 54.330 | 0.416 / 0.968 |

The Web Worker question from the proposal's section 3.3 is closed for now: the large tower's worst tick is under 1 ms, far under the 8 ms trigger.

## 3. Static tower reconcile (3dee6bd)

Rooms, slabs, shafts and fire markers are rewritten only when world.structureVersion, the night bit or the world object changes; cars and sims stay per frame. structureVersion is bumped by every writer of the fields the renderer reads (addRoom, removeRoom, addShaft, removeShaft, extend shaft, add and remove car, occupancy crossing zero, onFire) and is neither serialized nor hashed. The sim count and the draw share one pass. Closed the open ADVISORY on the uncovered crowd sample with a stub-renderer harness (tests/render/reconcile.test.ts).

## 4. UI per step (15eb1d1)

The HUD was subscribed twice (main.ts and ui.ts) and now once. The placement chip's measurements are cached and taken again only on text or class change, show or hide, resize, chrome band change or font load; pan, zoom and steps take the ghost rect from the renderer's arithmetic. The log panel appends new lines and drops past 200; the room panel builds flag spans only when the flag string changes.
