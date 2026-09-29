# Verification of lane I at 0f05723

Method. I used my own overlay (scratchpad/overlay-I, now deleted) and my own runner (scratchpad/verifyI/mut.py). Each run applied one exact text replacement, taken from the reviewer's probeI/m pairs, and restored the file from the checkout afterwards. Every mutation ran against one union guard set of 21 files (verifyI/G.txt): sim economy, build, events, save, save-roach, replay, replay-start, cars, baselines, stars, story-beats, people and elevators; scenarios first-tower, demolish-threats, evictions, security, recycling, growth and vip-journey; and game/events. That covers every guarding file the reviewer named for each item. The baseline on pristine code: 21 files, 475 tests, all green. Controls went RED as expected: 3a (9 tests), 2a (build.test "refunds ... leave the income table unchanged") and r11cathedral (stars.test "I S4: a wedding held but no cathedral"). My independent probes are in scratchpad/verifyI/probes.test.ts; all 12 pass on live code. Transcripts: verifyI/runs.txt and verifyI/probe-runs.txt. uname -m: arm64. The checkout's git status stayed clean.

Numbering. The lane report numbers these S1 to S8. The task's S5 folds the lane's S5 and S6 together, and the task's S6 and S7 are the lane's S7 and S8. I use the lane's numbering below.

## Verdicts

### S1. The 5-star metro requirement has no test that fails without it - CONFIRMED (final: ADVISORY)
- Reproduction: I deleted `if (requires.metro && !has('metro')) return false;` at stars.ts:50 (r11metro). All 21 guard files stayed GREEN (475 tests). My probe V1 puts a world at 4 stars with 10,002 population from offices and no metro, and expects the tower to hold at 4; after a metro is added it expects 5. V1 passes on live code and goes RED under r11metro. PROJECT.md lists metro among the conditions that must "each [be] covered".
- Fix spec: add a leave-one-out case "5-star population, no metro, holds at 4" to the table in tests/sim/stars.test.ts. It must fail with line 50 deleted and pass with it restored. The existing positive case and the other leave-one-out rows stay as they are.

### S2. No test notices upkeep being skipped for a room that is burning at the settle - CONFIRMED (final: ADVISORY)
- Reproduction: mutation 3c (`&& !room.onFire && !room.infested` added at economy.ts:96) stayed GREEN across all 21 files. Probe V2 settles a security office with `onFire: true` and expects upkeep of 20,000 and cash of 980,000. It passes on live code and is RED under 3c. The live code matches DECISIONS 2026-09-28 ("upkeep is charged in full for whatever exists at the settle"), so this is a guard gap, not a re-flag of the ruling.
- Fix spec: add a test in tests/sim/economy.test.ts where one room is burning and one is infested at onQuarterStart, and assert that both are billed in full. It must go RED under 3c. The settle code does not change.

### S3. No test notices the settle and the star recount swapping order - CONFIRMED (final: ADVISORY)
- Reproduction: mutation 1c (recomputeStars moved above onQuarterStart in tick.ts) stayed GREEN across all 21 files. Probe V3 uses stars 3, 10 lobby tiles, no population, and one tick at minute 3*1440+300. On live code lastQuarter.upkeep is 3,000 (300 per tile at 3 stars) and stars then fall below 3. Under 1c the probe is RED because upkeep is 0. DESIGN.md §5 fixes the order as step 5 (settle) and then step 6 (stars).
- Fix spec: add V3 as a tick-order test, in tests/sim/economy.test.ts or a tick test. It must fail under 1c. tick.ts does not change.

### S4. The refund guard checks only the income table - CONFIRMED (final: ADVISORY)
- Reproduction: 2d (the refund booked as a negative fire loss) and 2e (booked as negative upkeep) both stayed GREEN across all 21 files. Probe V4 demolishes an office, checks that cash rises by 10,000, and checks that the income, upkeep and losses tables are byte-identical before and after. Under both 2d and 2e it is RED.
- Fix spec: extend build.test.ts:686-701 so the snapshot covers upkeepByKind and lossesByKind as well as incomeByKind. It must go RED under 2d and 2e. The refund path stays as it is.

### S5. The rent setting on hotel nights and condo sales is unguarded - CONFIRMED (final: ADVISORY)
- Reproduction: 6d (the rent factor dropped from recordHotelNight) and 6f (dropped from recordCondoSale) both stayed GREEN. Probe V5 expects a twin at rent 150 to earn 4,500 a night and a condo at rent 50 to sell for 75,000. It is RED under each mutation. people.test mocks both functions, and the economy tests use rent 100 only. Live code matches DECISIONS 2026-09-20.
- Fix spec: add V5's two assertions to tests/sim/economy.test.ts, each with rent other than 100. The test must fail under 6d and under 6f.

### S6. The bank line's exact boundary is untested (plus the task's question about the promise) - CONFIRMED as a test gap; no wrong promise (final: ADVISORY)
- The promise: V6b captured the live text: "The bank gives you one quarter. Get to -$500,000 or better by the next settle, 5 AM in 3 days, or the bank takes the tower." The live comparison at economy.ts:209 is `world.cash < ECONOMY.bankruptAtCash` with bankruptAtCash = -500,000 (rules.ts:221). Exactly -500,000 is therefore "or better" and is not a bad quarter. The text and the code agree, so there is no IMPORTANT here. Probe V6a starts with a streak of 1 and cash of exactly -500,000; after the settle the streak is 0 and gameOver is null. The "foreclosure at exactly -$500,000" in the task describes mutation 7a only, not the shipped code.
- Test gap: 7a (`<=`) stayed GREEN across all 21 files and is RED on V6a. 6e (`cash < -1` on the debt line) stayed GREEN and is RED on V6c: at cash -1, live code logs "You are in debt".
- Fix spec: add boundary cases to economy.test.ts at -500,000 (no strike, no game over on a second settle) and at -1 (debt line shown). They must go RED under 7a and 6e respectively. The comparison and the text stay as they are.

### S7. The hash's field coverage for Sim and Stats is unguarded - CONFIRMED (final: ADVISORY)
- Reproduction: h1 (stress fixed at 0), h3 (guard dropped), r7a (collector dropped), h4 (lossesByKind emptied) and h6 (badQuarterStreak zeroed) each stayed GREEN across all 21 files, including the pinned hashes in the security and recycling scenarios. Probe V7 changes each field in turn and requires the hash to move each time. It passes on live code and is RED under each of the five mutations. The only per-field Sim guard is save.test.ts:472 (`exiting`).
- Fix spec: extend save.test.ts's "moves when a Sim field ... moves" into one case per hashed Sim key, including a guard and a collector sim, plus one for the lossesByKind and badQuarterStreak stats. It must go RED under h1, h3, r7a, h4 and h6. The projection does not change.

### S8. A save whose sims array is reordered hashes equal at load, then drifts - CONFIRMED (final: ADVISORY; hand-edit only, not CRITICAL)
- Reproduction: I reproduced it in V8c with the reviewer's tower (seed 12345, saved at 1440+520). After reversing `sims` in the JSON the load hash is equal (true). After 2 days the original is 3156eac8 with cash 46,371,580, and the reversed load is df36b884 with cash 46,371,592. That matches the reviewer's figures exactly.
- Can a real save produce that order? No. serialize writes `Array.from(world.sims.values())` (save.ts:182), which is Map insertion order. It is not sorted, but insertion order is always id order in play. The only writers are addSim (world.ts:142, a plain `set`) and deserialize. Every addSim caller allocates the id with allocId immediately before the add, with no other allocation in between: people.ts:1021, security.ts:74, recycling.ts:122, events.ts:362 (VIP; vipArrivalHour is pure) and events.ts:667 (thief). No code removes a sim and re-adds it. deserialize rebuilds the Map in file order, which is the saver's Map order. Empirical checks:
  - V8a ran 3 days on the tower, 45 checkpoints, 513 sims live, nextId 2957. The live map, the serialized file and the reloaded file were in ascending id order at every checkpoint, and save, load and save again was byte-identical apart from `story` (see Notes).
  - V8b loaded a world 4 times in a chain, one save and load per day. At the end its hash and cash equal the world that ran without interruption.
  So two real saves of the same world cannot differ in sim order. Only a hand-edited or foreign file reaches this path, and DECISIONS 2026-09-28 says nothing in the game verifies a save by hash. ADVISORY stands.
- Fix spec: in deserialize, sort sims by id (and shafts, for symmetry) as rooms are sorted at save.ts:697-701. Add a "sims reversed" twin of save.test.ts:648 that is RED today and GREEN after. Serialized bytes and every pinned hash must not change, because real files are already in id order.

### Missing elevators proof (PROJECT.md: "a shaft with 8 cars serves a queue; average wait under threshold") - CONFIRMED (final: ADVISORY)
- Reproduction: I grepped all of tests/. No test drives a shaft with more than 4 cars through dispatch or asserts an average wait. Car counts reach the maximum only in the refusal tests (build.test.ts:507 and cars.test.ts:401), and those never tick. The express half of the row exists (elevators.test.ts:398-426).
- Fix spec: add an elevators test with 8 cars on one standard shaft, a queue of N sims across floors, M ticks, and a mean wait under a named threshold, stated as a constant in the test. It must go RED if dispatch sends only one car, for example if the car loop in tickElevators is capped to cars[0].

## Duplicates
- None named by the task.

## Notes
- New suspicion N1 (ADVISORY, code smell): `stats.avgWaitMinutes` is created at 0 (world.ts:44), validated on load (save.ts:565), saved and hashed, but nothing in src/ ever writes it. The only hits are world.ts:44, types.ts:370 and save.ts:565, and no UI reads it. Input: any tower, any length of play. Outcome: the field is always 0. Reproduce: `grep -rn avgWaitMinutes src`. Fix: remove it, or compute it. Either choice changes the hash projection, so it needs a deliberate re-record.
- Observation, not a finding: save, load and save again is not byte-identical, because sanitizeStory rebuilds the story beats with keys in a different order. Seen at minute 555: `{"simId","value","roomId"}` becomes `{"simId","roomId","value"}`. Story is outside the hash and never read by the tick, so this has no effect on play. It matters only if a byte-equality round-trip test is ever written.
- The reviewer's "Questions for the owner" (re-recorded pinned hashes, the harness.test 1+1 test) are owner questions, not findings. I did not re-litigate them.
