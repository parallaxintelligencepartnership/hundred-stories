# Lane A: Simulation core and the build log at 7b4e60f

## Suspicions

### S1. Demolishing a burning room leaves a fire that never ends and blocks arrivals (proposed: CRITICAL)
- Where: src/sim/build.ts:447-475 (doDemolish has no check for a room in a live event); consequence in src/sim/events.ts:181-231 and src/sim/people.ts:79,112-118,236
- Input: stars 2, no security office. A fire starts in a vacant office (or one whose people have walked out, which people.ts makes happen). The player demolishes the burning room: occupancy is 0, so it is accepted.
- Wrong outcome: the fire event stays in `world.events` with a roomId that no longer exists. spreadFire finds no burning rooms, so nothing spreads. tickFire only ends the fire when security is on duty. `fireBurning()` stays true, so condos never sell, shop/restaurant/cinema visitors never spawn, and workers and guests are held outside. It lasts until the player pays the $250,000 helicopter or builds a security office. Expected: demolition is refused while the room burns, or the fire ends when its last room is gone.
- Reproduce: scratchpad probes-A/p5.ts (`npx vite-node@6.0.0 <path>`): the fire is pushed exactly as startFire does, the room is demolished and accepted, and 3 days later `events ["fire"]` is still there.

### S2. Demolishing the bomb room makes the bomb destroy the four oldest rooms in the tower (proposed: IMPORTANT)
- Where: src/sim/build.ts:447 (no event guard); src/sim/events.ts:256-270 (`distanceFrom(undefined, room)` returns `room.id`)
- Input: stars 3, a bomb planted in a vacant office on floor 5. The player demolishes that office before 13:00.
- Wrong outcome: at 13:00 the bomb still goes off. It destroys rooms with ids 1 to 4 (the first lobby tiles on floor 1), logs "The bomb went off on floor 1", and charges $2,000,000. Expected: the demolition is refused, or the threat clears with the room.
- Reproduce: p5.ts bomb block prints `bomb destroyed ids [1,2,3,4]` and the floor 1 log line.

### S3. Multi-floor basements are refused when their top floor sits under a built floor (proposed: IMPORTANT)
- Where: src/sim/build.ts:196-201 (`hasSupport` checks `floor + 1` of the base floor, not the floor above the room's top)
- Input: a lobby, parking ramps on B1 at x 100 and 116, stars 5. Then `canBuild(recycling, -3, 100)`, which covers B3 and B2 under the ramps. Also `canBuild(metro, -4, 100)`.
- Wrong outcome: both are refused with "Build a floor below this one first." hasSupport(-3) asks whether B2 is built, and B2 is the recycling center's own top floor. restsOnStructure (the stricter test) would pass. The workaround is to first build something elsewhere on B2, and the message does not point the player to it.
- Reproduce: probes-A/p1.ts, lines 1 to 4 of the output.

### S4. Basement refusals tell the player to build "below" (proposed: IMPORTANT)
- Where: src/sim/build.ts:379
- Input: `canBuild(parkingSpace, -2, 100)` with B1 empty, or any B1 room with no lobby.
- Wrong outcome: "Build a floor below this one first." For a basement, the missing support is the floor above (or the ground lobby). tests/sim/build.test.ts:283-286 and :898 lock in the wrong text.
- Reproduce: p1.ts, the "parkingSpace @-2 with empty B1" line.

### S5. A shaft can float anywhere and hold up rooms, which gets around the support rule (proposed: IMPORTANT)
- Where: src/sim/build.ts:395-426 (canBuildShaft has no support test); :253-257 (a shaft passing the floor below counts as support)
- Input: a new empty lot. `shaft.build standard x200 floors 40..69`, then `build office 41 x198`, then `office 42 x190`.
- Wrong outcome: all three are accepted, so rooms stand on floor 41 with nothing under the shaft. The same works underground: a shaft from B10 to B2 with no lobby, then a parking space on B3. The 2026-09-24 rule ("chained overhangs wouldn't work in real life") is defeated by one unsupported column. DESIGN section 2 says a shaft may rise "from the lobby into empty air".
- Reproduce: probes-A/p4.ts, the first 6 lines.

### S6. A car range can include floor 0 and end up serving one floor (proposed: ADVISORY)
- Where: src/sim/build.ts:722-731
- Input: a shaft from B1 to floor 5, then `shaft.setCarRange {lo:0, hi:1}`. The UI steppers skip 0, so this only arrives through a crafted build log or save.
- Wrong outcome: accepted. The car covers only floor 1, which breaks "a car must serve at least two floors". floorExists is never applied to range bounds.
- Reproduce: p1.ts, the last line: `{ ok: true } covers floors: [ 1 ]`.

### S7. Player-facing plurals: "Lobbys", "Housekeepings", "Fast foods" (proposed: ADVISORY)
- Where: src/sim/build.ts:62-64 (`plural` appends "s"), used at :77, :362, :376
- Input: build a lobby with $4,000 cash, or a lobby at B1, or housekeeping when cash is short.
- Wrong outcome: "Not enough cash. Lobbys cost $5,000.", "Lobbys must go above ground.", "Not enough cash. Housekeepings cost $50,000." None of these is plain US English.
- Reproduce: p4.ts, the last 3 lines.

### S8. The quarter summary prints negative money as "$-50,000" (proposed: ADVISORY)
- Where: src/sim/economy.ts:62-65
- Input: a quarter where upkeep is more than income, or cash below zero.
- Wrong outcome: "profit $-50,000. Cash: $-300,000." shown to the player. build.ts `money()` formats the sign correctly, so the two paths disagree.
- Reproduce: read the code. `net.toLocaleString` runs inside `$${...}`.

### S9. Numbers outside rules.ts, and a rules flag that does nothing (proposed: ADVISORY)
- Where: src/sim/economy.ts:28 inlines `0.5 + eval / 2`, while `ECONOMY.officeRentEvalScale` is never read. src/sim/world.ts:67 `LONG_WAIT_MINUTES = 5` duplicates `STORY.longWaitMinutes`. world.ts:24 hard-codes the 06:00 start. evaluation.ts:128,145 use 100 instead of `RENT.default`.
- Wrong outcome: setting `officeRentEvalScale: false` changes nothing, and the two long-wait constants can drift apart. This breaks the "every number from rules.ts" invariant.
- Reproduce: `grep -rn officeRentEvalScale src` returns only rules.ts.

## Questions for the owner
- Stars and hotels: population counts hotel rooms only while guests are inside (stars.ts:18-23). On the demo fixture, population swings each day, from 165 at noon to 178 at night. A hotel-heavy tower near a threshold will log "Fell to" at midday and "Reached" at night every day, and star-gated building switches off and on with it. Is that intended?
- Should a burning room be allowed as a firebreak demolition, with the fire ending when its last room is gone? Or refused outright? (See S1.)
- Edition: when the web build flips to demo edition, existing web saves carry `edition: 'web'` logs. verifySave then reports "unavailable", and live building refuses anything outside the box on those towers. Is that the plan?
- A tenant who is riding a car when their room is demolished leaves a dead id in `car.passengers` and a stale `car.calls` stop until the next door open (elevators.ts:291 drops it). It is harmless today. Should doDemolish unseat them?

## What the tests do not prove
- build.test.ts: `spend` is mocked, so the real economy path is never exercised through a build. A refusal is checked only for cash, log and room count, never for an unchanged world hash. No test covers multi-floor basement support (S3), shaft-borne floating rooms (S5), demolishing a room tied to a fire, bomb, VIP suite or theft target (S1, S2), car ranges touching floor 0 (S6), or the plural strings (S7).
- economy.test.ts: onQuarterStart is called directly, never through tick at dayOfQuarter 0, 05:00. No test covers negative figures in the summary.
- stars.test.ts: only a one-level fall is tested. No multi-level fall in one call, no hotel occupancy swing, no rise back after a fall.
- replay.test.ts: 3 days at 1 star with no events, so bomb.pay and fire.callHelicopter are never replayed against a live event. No log is replayed through the real demo cap. No checkpoint lands after gameOver.
- demo-cap.test.ts: nothing for stairs or escalators from B1 (span -1 to 1) in the demo, and nothing for a shaft extended from outside the box.
- baselines.test.ts: covers only the two display baselines. Fine for its scope.

## Coverage
- Read in full: src/sim/types.ts, rules.ts, rng.ts, world.ts, tick.ts, build.ts, economy.ts, evaluation.ts, stars.ts, buildlog.ts, replay.ts, scripts/replay.ts; tests/sim/build, economy, stars, replay, replay-start, demo-cap, baselines. Also read for context: save.ts hash and serialize sections, elevators.ts dispatch and serveFloor, events.ts fire, bomb and command sections, people.ts intake, game.ts world-creation sites, panels.ts car range UI.
- Skipped: none in scope.
- Probes run:
  - The lane's vitest recipe (7 files): 149 of 149 passed.
  - The lane's grep for Date, Math.random, performance, window and document in src/sim: comments only, plus a local variable named `window` in chronicle.ts. Clean.
  - p1.ts: S3, S4 and S6 reproduced.
  - p2.ts: the demo fixture, 5 days continuous vs save and load every 97 minutes. Hashes equal (c30ac173), so the determinism holds on this tower.
  - p3.ts: the hotel population swing (Question 1).
  - p4.ts: S5 and S7 reproduced.
  - p5.ts: S1 and S2 reproduced.
  - Searched for world mutations outside commands and ticks in src/game, src/ui and main.ts: only the dev-only `?hour` and the smoke world. The replay boundary holds.
