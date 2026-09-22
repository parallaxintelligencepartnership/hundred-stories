# Engine round spec, part 2: rush hour, static tower reconcile, UI per step

Date: 2026-09-22. Companion to docs/reviews/2026-09-22-engine-round-spec.md (the loop fix, spec 1). Source: docs/reviews/2026-09-22-performance-investigation.md findings 2, 3 and 4. Each section below is one delegation; A and C run in parallel with spec 1, B runs after spec 1 because both touch src/render/renderer.ts. Agents do not commit, bump versions or deploy; the orchestrator does.

## A. Evening rush (src/sim/routing.ts, src/sim/people.ts, scripts/bench)

Hard rule: the six hashes printed by `npx vite-node@6.0.0 scripts/bench/hash.ts` must be unchanged at the end: small 4dee77a3 / 7151c613, medium d3ba899e / e2cafb93, large 823b38bb / d4023cca. Run it before starting to confirm the baseline on your tree, and after every step. A step that moves a hash is reverted, not tuned, unless it is step 4 and the drift is explained below.

1. Bench: add an evening sample to scripts/bench/bench3.ts. After the 09:00 sample, run the same world on to 17:30 on the same day and take a second 200 tick sample; print a second row per tower labelled `<label>-evening`. Keep the existing rows byte-identical so old numbers compare. Update scripts/bench/README.md with one line. Record before numbers for all six rows.
2. Index settled nodes by floor in the route search (routing.ts, the goal scan near line 261 that walks every settled state per trip): keep a per-floor list or map of settled states so choosing the goal reads only the target floor's states. The chosen goal and every tie-break must be identical to today; if the scan order affected ties, preserve that order inside the per-floor list.
3. Binary heap for the open set (routing.ts near lines 311 to 316, the linear scan plus splice): replace with a binary min-heap. Ties: the current code picks a specific element among equal keys (first found, or last, check). A plain heap does not preserve insertion order among equal keys, so carry a monotonically increasing sequence number as the secondary key that reproduces the current tie order exactly. Hashes prove it.
4. Search cache keyed by floor and connector rather than exact tile (routing.ts, the per minute cache near line 166 and `cacheOf`): only if steps 2 and 3 leave the large tower's evening tick median over 8 ms. If you do it, the walk cost from the sim's tile to the cached origin is added afterwards, and the invariant comment above `cacheOf` is updated. If a hash moves, stop and report which hash and why rather than guessing whether the drift is acceptable; do not leave the tree in that state (revert step 4).
5. Do not touch the five `[...world.sims.values()]` copies (the investigation's lower list); out of scope.

Tests: `npm test` and `npm run typecheck` green. Add tests in tests/sim/routing.test.ts: (a) a heap ordering test that pushes keys with ties and checks pop order matches the sequence rule; (b) a test that the per-floor index returns the same goal as a brute-force scan for a small tower with several candidates on the target floor.

Report: the bench table before and after (all six rows), the six hashes, files and line ranges, and any fork you stopped on.

## B. Static tower reconcile on a change counter (src/render/renderer.ts, src/sim)

Runs after spec 1 lands, on the tree that contains it.

1. `reconcileRooms` (renderer.ts, near lines 760 to 824 before spec 1 moved things) sets size, position and tint on every room and slab sprite every frame. Change it to run the full pass only when a structure version differs from the one last reconciled. Otherwise only the per-frame entities (cars, sims, the placement ghost) are touched.
2. Structure version: add `structureVersion: number` to the world (src/sim/types.ts) if no equivalent exists, initialised at 0 in createWorld, not serialized (the save format must not change; check save.ts serialize and deserialize ignore it and that `hashWorld` does not include it; if hashWorld hashes the whole object generically, exclude the field explicitly). Increment it in every sim mutation that changes what the static tower looks like: build, demolish, shaft build and remove, car add and remove, room lit or occupied state change, onFire set and cleared, tenant move in and move out if the room art depends on it, any room state the renderer reads for tint or texture. Grep the renderer for every world field it reads inside `reconcileRooms` and make sure each writer of those fields bumps the version. Missing one shows as a stale room, so list the writers you found in the report.
3. The renderer also bumps or resets its own copy on `resetMotion` and on a new world (importSave, newGame), so a load always reconciles fully.
4. The lit variant at dusk: the sky hour drives lit textures. If `reconcileRooms` chooses textures by hour, keep a `lastLitState` in the renderer and force a full pass when it flips, rather than bumping the world version from the renderer.
5. renderer.ts near line 916: the full pass over all sims just to count visible sims, then a second pass. Fold into one pass.

Verify: the six hashes unchanged (a world field that is not hashed cannot move them; if a hash moves, the field leaked into the hash, fix that). `npm test`, `npm run typecheck`. Add a test in tests/render/ in the stub-renderer pattern of tests/render/connectors.test.ts: after one render, mutate a room's tint-driving state without bumping the version, render again, the sprite is unchanged; bump the version, render, the sprite updates. This also lets you close the open ADVISORY in .itworks/REVIEWS.md if the same harness can assert the crowd sample (one visible sim in four drawn; red when the `inCrowd` guard is removed from the sprite loop). Do that if it fits in the same harness, and say whether you did.

Report: files and line ranges, the writer list from step 2, tests added, hashes.

## C. UI work per step (src/main.ts, src/ui/ui.ts, src/ui/panels.ts)

1. src/main.ts line 64 and src/ui/ui.ts line 320 both subscribe `update()` so the HUD refresh runs twice per notify. Remove the one in src/main.ts if ui.ts's subscription covers it; if main.ts's subscription does something ui.ts's does not, merge it into the ui.ts one. Check tests/game/boot.test.ts and tests/ui for anything that relies on the removed one.
2. With a tool in hand, `positionPlacement` (ui.ts near lines 417 and 436) reads `getBoundingClientRect` right after text writes, a forced layout 20 times a second and every rAF. Fix: measure once per pointer move or camera change (cache the rect and invalidate on resize, scroll and camera events), not on every update; if the chip position depends only on the ghost rect that the renderer already knows, take it from there.
3. The log panel (panels.ts near lines 662 to 676) rebuilds 200 list items whenever a log line lands. Append only the new lines and drop the oldest past the 200 cap; keep the DOM under 200 items plus chrome.
4. The room panel (panels.ts near line 258) creates flag spans on every refresh just to compare them. Compare the flag strings first and build the spans only when the string changes.

Tests: `npm test`, `npm run typecheck`. Add or extend tests under tests/ui for 3 (the list appends and caps, node count after 300 lines is at most 200 plus the header) and for 1 (one notify, one update).

Report: files and line ranges, tests added, any fork.
