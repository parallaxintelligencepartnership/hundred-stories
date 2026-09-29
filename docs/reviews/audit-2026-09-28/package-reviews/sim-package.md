# Review: simulation fix package, commit 2be9d78

Scope: tier checkpoint on 2be9d78 (design verify plus the real-data and testing lenses in one pass). I judged the commit, not the working tree: `git archive 2be9d78` was unpacked to scratchpad/c2be, and its parent to scratchpad/cpar. Mutations ran in a separate scratch copy, scratchpad/mut. Host is arm64 (uname -m).

Read in full at the commit: src/sim/people.ts, elevators.ts, events.ts, and the commit's diff for build.ts, rules.ts, types.ts and story.ts. I read these touched regions and their callers: build.ts doSetStop and the support refusal, rules.ts LIMITS, types.ts ActiveEvent, story.ts cleanBeat and towerLine, save.ts isEvent and the event load, recycling.ts releaseDirty and the lost-route helpers, security.ts guardLostRoute, routing.ts entrances and findRoute, chronicle.ts, curb.ts and audio/cues.ts. I also read all six new or changed test files and verify-B, verify-C and verify-AH lane A.

Not covered:
- build.ts, rules.ts, types.ts and story.ts were not read line by line outside the diff and the regions above.
- No UI, render or browser checks.
- Tests outside tests/sim and tests/scenarios were not run. The only exceptions are replay and chronicle-totals, which are inside tests/sim; they failed to load in the mutation copy because a fixture was missing, so I copied store/ into that copy and re-ran them.
- No screenshots.

## Runs
- `npx vitest run tests/sim tests/scenarios` at 2be9d78 (run once): 38 files and 615 tests passed.
- `npx tsc --noEmit` at 2be9d78: exit 0.
- Bench hashes with `npx vite-node@6.0.0 scripts/bench/hash.ts` gave identical output at 2be9d78 and at its parent: small 8dfbc256/7320ec66, medium b34f7209/6cd078f8, large 796a7c8f/d6ef61c6. The bench towers have no transfer floors, so clearing the wait at boarding changes nothing there.
- The security.test.ts hash moved only because of the boarding line. With `sim.waitStart = null` removed from elevators.ts serveFloor, the test received eeb027e5, the old recorded value. No other pinned hash changed in the diff, and every pinned-hash test in tests/sim and tests/scenarios passed.
- Determinism: nothing new reads Date, Math.random or the DOM (grep of the touched files). entrancesByCost sorts by cost and then by index in entrances(), which is a total order and the same tie rule as the old strict `<` loop. entranceFor, routeToAnEntrance and needsCleaning draw nothing from the rng.

## Mutation results (each reverts one part of the fix in the scratch copy)
| Fix | Mutation | Result |
|---|---|---|
| B S3 boarding | drop waitStart clear in serveFloor | killed (boarding x2, security hash) |
| B S2 spawn | entranceFor trusts every door | killed (metro-entrance office) |
| B S2 leave | routeToAnEntrance tries only the nearest | killed (metro office, condo) |
| B S4 | retryHallCall returns on missing shaft | killed (demolish-waiting) |
| B S5 | drop the stops check on open doors | killed (boarding stop-off) |
| C S1 | finishCleaning leaves infested | killed (events x2, cockroach-clean) |
| C S1 | needsCleaning = dirty only | killed (events spread test) |
| C S1 | stayMinutesFor dirty only | killed (events spread test) |
| C S2 | detonate ignores stored position | killed (bomb-fire) |
| theft mess | no hourly tidy | killed (events theft test) |
| C S3 | sanitize drops leftEarly | killed (vip-journey) |
| A S1 | underground wording reverted | killed (build.test) |
| B S3 sendAway | drop waitStart clear in sendAway | SURVIVED (all 615, plus replay and chronicle-totals) |
| B S4 routeLost | drop waitStart clear in routeLost | SURVIVED (same) |
| C S1 fallback | tickCockroaches fallback never clears | SURVIVED (branch unreachable, see notes) |

## Attack results (no defect found)
1. **Entrances.** A sim whose class reaches no door still leaves:
   - A transient goes to runLeaving, gets null from routeToAnEntrance, and finishLeave removes it.
   - A tenant is put outside at the nearest door. retireOutsideSims ends an exiting one; for a non-exiting one, tomorrow's startTrip ends the lease only when there is truly no route.
   - A connected metro still spawns and releases people. The test asserts workers are seen on B3, and entranceFor checks the metro with the class of the sim being spawned.

   Guards, housekeepers and collectors spawn in their own rooms, not at an entrance. When they leave (sendAway, then runLeaving) they route with staff options. The VIP and the thief still use the first ground door (sendVipToSuite and groundDoor, unchanged). Ground doors are taken on trust, which holds: floor-1 walking is unconditional in findRoute (routing.ts:344), and reachableFor asks from a ground door.
2. **waitStart readers.** Nothing reads it outside `state === 'waiting'`:
   - overlays.ts:183 hallQueues, renderer.ts:373 poseOf and story.ts:622 goal line all guard on waiting.
   - people.ts updateStress, giveUp and followOpenWaits also run only for waiting sims.
   - events.ts:511 trackWait starts `waitingSince` from waitStart only while waiting. After boarding, a transfer wait now starts its own clock, so the VIP rating is correct: the boarding test stores fair, and the mutation stores 25 minutes, which is poor.
3. **routeLost from retryHallCall** runs only for sims in `waiting` state (people.ts:658-674). A rider in a car is `riding`, and stairs are climbed within the tick, so no one mid-transfer loses a route that still stands. Guards and collectors waiting on a demolished shaft now replan through guardLostRoute and collectorLostRoute; before this fix they stood waiting forever. A thief waiting on the way out now reaches runLeaving and then theftEscaped.
4. **Stop turned off with doors open.** A rider aboard for that floor cannot exist: doSetStop refuses with stopOffRefusal (build.ts:761). Riders bound elsewhere stay aboard and the car continues in the same tick.
5. **Cockroaches.** A natural-path probe (cockroach-clean geometry, 10 days after housekeeping is built) gave these results:
   - exactly one "cockroaches are gone" line per infested room (97 at 7822, 98 at 7824);
   - no second line at 06:00, because finishCleaning nulls the timer, so the fallback's `wasDirty` is false;
   - 22 checkouts afterwards, so bookings resume.

   A room infested while occupied is picked up after checkout sets dirty. A VIP-held suite is picked up after releaseSuite. The spread code is unchanged. The rewritten events.test.ts test cleans through a real keeper and fails when finishCleaning's clear is reverted, so it proves the original invariant through the real path.
6. **Bomb.** The event keeps floor and x through serialize and deserialize (probe). Save format stays 5, because save.ts is untouched. An older bomb without the fields loads and detonates:
   - with its room standing, exactly as before;
   - with its room gone, by the old id-ranked fallback, naming floor 1. The probe gave `missing [150..153]` and "went off on floor 1".
7. **VIP leftEarly.** failVisit is only reached before check-in (tickVip notice and route phases), so "left without staying" is never wrong. curb.ts:110 and audio cues.ts:24 still key on the code and value, and those are unchanged.
8. **Theft mess.** The hourly tidy skips waste-backlog rooms off the 06:00 roll, and the 06:00 order (tidy before rollWaste) is unchanged. Hotel rooms are skipped.
9. **rules.ts.** It now imports only types from types.ts, and types.ts re-exports the three constants, so there is no runtime cycle. Every importer resolves: camera, sky, weatherfx, renderer, events, save and build import from types; explain, demo and game read LIMITS. The rent refusal is worded from RENT, and the literal test still passes.

## Findings

### F1. The waitStart clears in sendAway and routeLost are untested - ADVISORY (testing)
- Where: people.ts:818 (sendAway `sim.waitStart = null`) and people.ts:540 (routeLost `sim.waitStart = null`).
- Input: remove either line in a scratch copy.
- Outcome: all 615 tests in tests/sim and tests/scenarios still pass, and so do replay and chronicle-totals. verify-B S3 names the sendAway clear in its fix spec ("so the exit leg's beginWait places a hall call"), yet no test pins it. A regression would bring back the stale-clock exit wait: no hall call, and an early reroute, for a sim sent away or re-routed while it was waiting. My demolish-geometry probe could not show the delay, because other diners' calls on shaft B masked it (the hall call and boarding came at +19 and +22 minutes, with and without the mutation). So the effect is unproven, and only the missing pin is certain.
- Reproduction: scratchpad/mutate.sh with the two perl substitutions listed in the table, run against `tests/sim tests/scenarios`.
- Suggested: a unit test in which a sim waiting at a floor with an idle car elsewhere gets sendAway (or has its shaft demolished) and the hall call for its exit leg appears the minute it starts waiting again.

### F2. A save's bomb floor and x are read by the tick but not validated - ADVISORY
- Where: save.ts:537-538 (isEvent for 'bomb' checks roomId, ransom, detonateAt and found only), read at events.ts:314-317.
- Input: a format-5 save whose bomb event carries `"floor":"up","x":null` and a roomId that no longer exists.
- Outcome: the save loads (`load true`), and at 13:00 the log reads "The bomb went off on floor up. 4 rooms were destroyed...". Ranking is by a null x. isEvent's own contract is "every event by kind, with the fields the tick reads". Only hand-edited or damaged saves can do this, so it is ADVISORY.
- Reproduction: a probe script (written to scratchpad/c2be, run with `npx vite-node@6.0.0`, then removed) that serializes a world with a bomb event, replaces `"found":false,"floor":2,"x":150` with `"found":false,"floor":"up","x":null`, deserializes, and runs to 13:01. It prints `load true undefined` and then the line above.
- Suggested: accept `floor`/`x` only as absent or as integers (`e.floor === undefined || isInteger(e.floor)`, and the same for x).

## Questions for the owner
- The design choice named in the brief: a bomb whose room burned still goes off where it was planted and costs $2,000,000. Facts for the ruling:
  - It can remove the lobby's door-end tiles. In the probe (bomb office at floor 2 x 150 over lobby 150-243), fire plus bomb removed tiles 150-153 and the entrance moved to x 154. The same tower with the room standing removes 150-151 today, so this is the existing ranking and not new with the fix.
  - Ranking puts every room on the bomb's floor ahead of any floor-1 tile (floor difference × 375). So a lobby tile goes only when fewer than four rooms remain on that floor, and then all of them go too. It therefore never removes the only support of a room still standing on the bomb's floor. Rooms two floors up that rested on burned rooms were already unsupported by the fire itself, which is existing behaviour.
- routeLost sends a non-exiting sim whose waited-for shaft is demolished home for the day (leaveTower), the same as the existing walker path. It does not re-route to a second shaft that would serve. The verify-B spec allowed "the same path as stepAlongRoute", so this is not a finding. A VIP in that spot fails with "no way up", rated poor; before the fix it failed after the give-up wait, also poor.

## Notes
- The tickCockroaches fallback (events.ts:847-857) cannot be reached in play: every path that sets a hotel room clean also nulls its timer (finishCleaning, recycling releaseDirty). The M13 mutation survives. verify-C allowed it to stay as a fallback, so this is not a finding.
- The M7 needsCleaning mutation survives cockroach-clean.test.ts, whose natural path always has the infested rooms dirty. The spread case is covered only by the events.test.ts unit test, which does kill it.
