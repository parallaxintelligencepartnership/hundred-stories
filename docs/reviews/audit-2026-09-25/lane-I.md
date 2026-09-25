# Lane I: Tests as guards at 7b4e60f

Method: I copied the repo to a scratch overlay (with node_modules symlinked) and broke one rule at a time with an exact-match text replacement. After each break I ran only the named test files and then restored the file. The mutations are kept as `<id>.old`/`<id>.new` pairs in `scratchpad/m/`, with the runner `scratchpad/mut.py` (usage: `python3 mut.py <label> <src file> m/<id>.old m/<id>.new <tests...>`, run from the scratchpad with the overlay recreated). RED means a guard caught the break.

## Suspicions

### S1. An elevator can be charged twice and no test notices (proposed: IMPORTANT)
- Where: src/sim/build.ts:488 (doBuildShaft); the guards that should catch it are tests/sim/build.test.ts, tests/sim/overlay.test.ts, tests/scenarios/first-tower.test.ts and tests/game/*.
- Input: mutation 1b adds a second `spend(world, rule.shaftCost, rule.label);` after line 489.
- Wrong outcome: every elevator costs $400,000 instead of $200,000, and all suites stay green (build, overlay, cars, demo-cap, first-tower, pointer, game). No test checks the cash after a `shaft.build`. The room path (1a) is caught, but only by the $10,000 lobby test at build.test.ts:95.
- Reproduce: m/1b against the files above. All green.

### S2. Refused commands can still take cash and no test notices (proposed: IMPORTANT)
- Where: src/sim/build.ts:421 (inside the preview `canBuildShaft`), build.ts:616 (addCar at the car limit), src/sim/events.ts:923 (ransom you cannot afford), events.ts:935 (helicopter you cannot afford).
- Input: 2c: `world.cash -= rule.shaftCost` on "An elevator is in the way." 2b: `spend` before refusing at maxCars. 2d and 2f: deduct, then refuse "Not enough cash".
- Wrong outcome: all four stay green. PROJECT.md's Simulation core row says a refused action leaves state unchanged, but that is only checked for the room-build path (build.test.ts:649, where 2a goes RED). build.test.ts:656 "never mutate" calls `canBuildShaft` only on a valid spot. build.test.ts:480 and events.test.ts never check cash after a refusal.
- Reproduce: m/2b, m/2c against build/cars/overlay tests; m/2d and m/2f against events.test.ts and first-tower.test.ts. All green. (2e, the helicopter with no fire, is RED in first-tower.test.ts:365.)

### S3. A star can fall two ranks at once and no test notices (proposed: IMPORTANT)
- Where: src/sim/stars.ts:56-58; guard tests/sim/stars.test.ts:208-231.
- Input: mutation 4c drops one extra star after the fall loop. Concrete case: stars 4, population 1,002 (167 leased offices). The correct result is 3 stars; the mutant gives 2.
- Wrong outcome: green. Every fall test starts at 2 stars, so the clamp at 1 hides any overshoot.
- Reproduce: m/4c against stars.test.ts and story-beats.test.ts. Green.

### S4. The 4-star and Tower requirements are not guarded one by one (proposed: IMPORTANT)
- Where: src/sim/stars.ts:34-41 and :37; guard stars.test.ts:125-197.
- Input: delete the medical check (11b), the recycling check (11c), the hotel-suite count (11d), or the cathedral check (11e).
- Wrong outcome: all four stay green. The "does not rise to 4" test removes the suite, recycling and medical together, so any one check can go missing. No test has a wedding held but no cathedral (for example, the cathedral demolished after its wedding).
- Reproduce: m/11b to m/11e against stars.test.ts. Green.

### S5. Condo owners can move in during a fire and no test notices (proposed: IMPORTANT)
- Where: src/sim/people.ts:113 (`if (!burning) sellVacantCondos`); guard tests/sim/events.test.ts:143-207.
- Input: mutation 6c calls `sellVacantCondos` even while a fire burns. spawnResident (people.ts:951-955) creates the owners already `inRoom` with occupancy set, which breaks DECISIONS.md:79 ("no arrivals enter the tower while a fire is burning").
- Wrong outcome: green. The fire test's only condo is the room on fire, which is skipped by `room.onFire`, so no second vacant condo is ever for sale during a fire. (6a, outside tenants walking in, is RED. 6b is held by the second check in runSchedules, so it is not a real break.)
- Reproduce: m/6c against events.test.ts. Green.

### S6. The world hash cannot see the order of sims or rooms, or the event list, so save and replay checks pass while reloaded worlds diverge (proposed: IMPORTANT)
- Where: src/sim/save.ts:671-688 (`byId` sorting; `events` never tested field by field); guard tests/sim/save.test.ts:385-473.
- Input: (a) 7f, `sims: Array.from(...).reverse()` in buildSaveData. (b) A probe that builds a 42-office tower with seed 12345, runs it to day 1 12:30, reverses `sims` (or `rooms`) in the saved JSON, loads it, and runs both copies 2 days. (c) 8e, the hash filters out the `fire` event. (d) 7a/7b, serialize drops `collector`/`guard`.
- Wrong outcome: (b) at load all three hashes are ff870e4a. Two days later the original and the plain reload are 1c594189, but the reordered sims give f3dc3390 (cash differs by $60) and the reordered rooms give 352aaf3e (cash differs by $600, 2 more sims). So hash equality at load does not mean the same world, and verifySave (replay.ts:133) inherits this. (a) and (c) are green in every save, replay and scenario file; the rooms reorder is caught only by vip-journey.test.ts:234. (d) is green in save.test.ts and caught only by the scenario save tests (recycling.test.ts:373, security.test.ts:263). save.test.ts's field-coverage tests cover Room, Car and `Sim.exiting` only, not guard, collector, events, stats or gameOver. The live serializer keeps insertion order today, so this is a guard gap, not a live divergence.
- Reproduce: m/7f and m/8e against save, replay and the five scenarios. For (b), serialize, then `data.sims.reverse()`, deserialize, then `tickMany(2880)` on both and compare `hashWorld`.

### S7. The security scenario's "nothing was lost" is measured with the sim's own income bookkeeping (proposed: IMPORTANT)
- Where: tests/scenarios/security.test.ts:92-93 (`cashLessIncome`) and :180; the code under test is src/sim/events.ts:684.
- Input: mutation 12a makes a caught theft still take `THEFT.lossCash`, booked as negative shop income.
- Wrong outcome: green. The expected number subtracts `stats.incomeByKind`, the same ledger the loss was booked in, so the loss cancels out.
- Reproduce: m/12a against security.test.ts. Green.

### S8. Demo cap: a two-floor room's top floor is not tested (proposed: ADVISORY)
- Where: src/sim/build.ts:358; guard tests/sim/demo-cap.test.ts:80-106.
- Input: mutation 9e checks only the base floor. With it, a cinema or party hall on floor 20 would reach floor 21.
- Wrong outcome: green. Every cap test uses one-floor rooms. (9a to 9d are all RED.) This is about the test, not the cap itself.
- Reproduce: m/9e against demo-cap.test.ts.

### S9. Two Verification-table failure behaviors have no test (proposed: ADVISORY)
- Where: src/sim/build.ts:734 ("a car with people inside refuses a range change") and src/sim/people.ts:669 (the log line when a visitor gives up).
- Input: 11a deletes the passengers check; 11f deletes the visitor `log(...)`.
- Wrong outcome: both green (cars, build, routing, people, first-tower). people.test.ts:619 and :710 check only `leaveReason`, and only the tenant case (:662) checks the log.
- Reproduce: m/11a and m/11f.

### S10. story-worker builds its expected text with the function it is checking (proposed: ADVISORY)
- Where: tests/scenarios/story-worker.test.ts:112-113 uses `minutesText` from src/sim/story.ts:274.
- Input: mutation 13a makes minutesText always render "zero minutes".
- Wrong outcome: story-worker stays green. story-beats.test.ts:161 catches it (RED), so this is redundancy lost, not a hole.

### S11. The `rentDay` event fires 5 game hours before rent is paid (proposed: ADVISORY)
- Where: src/game/events.ts:96-97 (quarter index changes at 00:00) versus src/sim/tick.ts:18 (onQuarterStart at 05:00). tests/game/events.test.ts:41 and :131 pin the 00:00 behavior, but the type comment (events.ts:14) says "when office rent is paid".
- Wrong outcome: the rent-day cue plays about 300 game minutes before cash moves.
- Reproduce: set minute to 3*1440-1 in createGame, step once. `rentDay` is emitted while `stats.lastQuarter` is unchanged until minute 3*1440+300.

## Questions for the owner
- Rent timing (mutation 3a, quarter a day late) and rent reaching cash (3b) are caught only by first-tower.test.ts:148 and baselines.test.ts. economy.test.ts calls onQuarterStart directly and checks `stats`, never `cash`. Is one scenario enough for the money path?
- The pinned hashes (recycling.test.ts:409, security.test.ts:361) are what catch any change to the shape of the hash projection (8b, 8d). Is that intended as the guard?

## What the tests do not prove
Verification expectations table, with the test that covers each failure column:
- Simulation core: partly covered by build.test.ts:649. The "state unchanged" part fails for the paths in S2.
- Elevators: the success proof (8 cars, average wait under a threshold) has **no test**; elevators.test uses at most 2 cars. The failure column is covered by people.test.ts:619 (reason) and :641 (log line, tenants only; see S9).
- Dedicated cars: range out of the shaft, upside down, or one floor is covered by cars.test.ts:316-349. A car with people inside: **no test** (S9).
- Economy and stars: the bankrupt state is set in economy.test.ts:226, and the plain game-over card is covered in tests/ui/alerts.test.ts:365 (outside my scope, grep only). Star conditions: see S4.
- Save and load: covered by game.test.ts:59 and :71 (refusal, world untouched).
- PWA offline: covered by boot.test.ts:118 ("needs to load once"). The installed offline play needs a real browser (`npm run build && npx vite preview`, then cut the network).
- Rendering: covered by boot.test.ts:53.
- Placement (touch): pointer.test.ts:419 (outline kept on a refusal). The chip and the disabled Build button are in tests/ui/placement.test.ts (outside my scope).
- Share: tests/ui/share-panel.test.ts:60 (outside my scope; the wording is now "could not capture the tower").
- Theme: tests/site/theme.test.ts (outside my scope, not read).
- tests/rng.test.ts and tests/harness.test.ts: rng checks only the sequence and bounds. The harness test is a tautology (1+1).
- people.test.ts:844: the determinism snapshot leaves out `wallet`. `wallet` is write-only in the sim (people.ts:979), so that is harmless today.

Mutations that went RED (guards working): 1a, 2a, 2e, 3a, 3b (scenario only), 4a, 4b, 5a to 5d, 6a, 7a/7b (scenarios only), 7e (vip only), 8a, 8b/8d (pinned hashes), 8c, 9a to 9d, 10a, 13a (story-beats), and 14b (a Math.random leak into worker leave times, caught by first-tower.test.ts:170 and replay.test.ts).

## Coverage
- Read in full: all 20 tests/sim/*.test.ts, tests/scenarios/{helpers.ts, first-tower, growth, recycling, security, story-worker, vip-journey}.test.ts, all 15 tests/game/*.test.ts, tests/harness.test.ts, tests/rng.test.ts. Sources read in full for the mutations: build.ts, economy.ts, stars.ts, tick.ts, save.ts, replay.ts. Also read: .itworks/DECISIONS.md, PROJECT.md, the Lane I section of LANES.md, DESIGN.md §8-11.
- Skipped: the people.ts, events.ts, rules.ts, story.ts and game/events.ts bodies were read in part, only around each mutation site. growth.test.ts was not run (a 120 to 180 s runtime; none of the mutations needed it).
- Probes run: one baseline run of 6 files (161 passed); about 45 single-mutation vitest runs, one process at a time, results as listed above; one vite-node ordering probe (hashes quoted in S6). The overlay was deleted afterwards, the real src/sim was byte-identical to the pristine copy, and git status was unchanged. uname -m: arm64.
