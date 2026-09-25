# Verification of lane I at 7b4e60f

Method: I made a fresh overlay (rsync per VERIFY.md, node_modules symlinked) and applied each lane mutation with my own copy of the runner (`scratchpad/verifyI/vmut.py`, overlay-verI). I ran one vitest process at a time. My probe tests are kept in `scratchpad/verifyI/probes/`. Each probe was run on the unmutated overlay first, after a `diff -rq` showed its src/ matched the repo, and then on the mutation. The overlay is deleted, and the repo's git status is unchanged (only the pre-existing `M .itworks/LANES.md`). uname -m: arm64. DECISIONS.md was read in full. No suspicion re-flags a settled decision; S5 is the guard for decision line 79.

Severity: every item below is a gap in the tests, not a live defect, so each one is ADVISORY under the rubric. The exception is S11, which is live but cosmetic, so it is also ADVISORY. The lane proposed IMPORTANT for S1 to S7. I lowered all of them because none of them changes behavior on the live code.

## Verdicts

### S1. An elevator can be charged twice and no test notices - CONFIRMED (final: ADVISORY)
- Reproduction: I applied m/1b (a second `spend` in doBuildShaft). These stayed GREEN: build, cars, overlay, demo-cap, first-tower and all of tests/game (20 files, 288 tests), plus tests/ui, growth, baselines and economy (37 files, 371 tests). My probe `fixspec.test.ts` "S1" passes on live code and goes RED under 1b.
- Fix spec: add to build.test.ts a test with a lobby from x 100 to 140 and cash of $10,000,000. Run `shaft.build` standard at x 120, floors 1 to 3, and expect the cash to fall by exactly `SHAFTS.standard.shaftCost`. Nothing in build.ts changes.

### S2. Refused commands can still take cash and no test notices - CONFIRMED (final: ADVISORY)
- Live check, as the task asked: `canBuildShaft` does not charge. Probe `s2.test.ts` on the unmutated code: `canBuildShaft('standard', 121, 1, 3)` over an existing shaft returns "An elevator is in the way.", cash stays 9,555,000 and the hash stays 599cd2ec. A ninth car returns "This elevator already has 8 cars." with cash and hash unchanged. With cash at $1,000, the ransom and helicopter refusals leave cash at 1000 and the hash unchanged. The code at build.ts:395-427 only reads the world. So there is no live CRITICAL; only the guard is missing.
- Guard gap: 2b and 2c stayed GREEN across the 20 build/game files and tests/ui. 2d and 2f stayed GREEN across the events, first-tower, security, story-beats, game/events and ui/alerts tests (90 tests). Each of the four probe cases goes RED under its own mutation.
- Fix spec: add four tests, one for each refusal, that snapshot `world.cash` and `hashWorld(world)`, run the refused call, and expect `ok: false` with both values unchanged. Inputs: (a) `canBuildShaft` over an existing shaft, in build.test.ts next to :656. (b) The ninth `shaft.addCar`, in cars.test.ts. (c) `bomb.pay` with cash of $1,000 after `startBomb`, in events.test.ts. (d) `fire.callHelicopter` with cash of $1,000 after `startFire`, in events.test.ts.

### S3. A star can fall two ranks at once and no test notices - CONFIRMED (final: ADVISORY)
- Reproduction: m/4c stayed GREEN on stars, story-beats and first-tower (48 tests). It also stayed GREEN on tests/sim plus five scenarios plus tests/ui (59 files, 825 tests). Probe "S3": 167 leased offices (population 1,002) at 4 stars gives 3 on live code. Under 4c it gives 2, so the probe goes RED.
- Fix spec: add to stars.test.ts a test with `world.stars = 4` and 167 non-vacant offices, then call `recomputeStars`. Expect population 1002 and stars 3.

### S4. The 4-star and Tower requirements are not guarded one by one - CONFIRMED (final: ADVISORY)
- Reproduction: 11b (medical), 11c (recycling), 11d (suite count) and 11e (cathedral) each stayed GREEN on stars and story-beats, and on the wide set of 825 tests. PROJECT.md:49 asks for "extra conditions (VIP, suites, metro, cathedral, wedding) each covered". The probes: 834 offices (5,004 people) at 3 stars with a fair VIP rating plus security, recycling, medical and a suite rises to 4. Remove any one requirement and it stays at 3; each removal goes RED under its matching mutation. 2,500 offices at 5 stars with a metro and `weddingsHeld = 1` but no cathedral stays at 5 on live code (goes RED under 11e). With a cathedral it rises to 6.
- Fix spec: add a table-driven test to stars.test.ts with the five cases above. Each case leaves out exactly one requirement and expects the rating to hold, and a control with everything present expects the rise.

### S5. Condo owners can move in during a fire and no test notices - CONFIRMED as a guard gap; the live rule holds (final: ADVISORY)
- Live check, as the task asked: this is not a live defect. people.ts:114 is `if (!burning) sellVacantCondos(world, clock);`. The only other path, spawnResident (people.ts:932), is called only from sellVacantCondos. Probe `s5.test.ts` on the unmutated code uses a lobby, a shaft to floor 3, a fast food burning on floor 3, and a vacant condo on floor 2 with eval 1. It starts at 06:00 on weekday 0 and runs to 10:00. The output was `FIRE {"fireEvents":1,"vacant":true,"occupancy":0,"residents":[],"saleLog":[]}`. The control, with the same tower and no fire, sold the condo: `{"vacant":false,"occupancy":3,"residents":["inRoom","inRoom","inRoom"],"saleLog":["A condo on floor 2 was sold to a new owner."]}`. So decision line 79 holds for condos today.
- Guard gap: m/6c stayed GREEN on events.test.ts (31 tests). It also stayed GREEN on first-tower, security, vip-journey, build, replay, story-beats and people (173 tests). My fire probe goes RED under 6c.
- Fix spec: add to events.test.ts, under "fire: nobody walks into a burning building", the s5 fire case. Use a second condo that is vacant and not burning (floor 2, x 300, eval 1). Burn a different room, run through the sale window from 07:30 to 09:00, and expect the condo to stay vacant with occupancy 0, no resident with its homeRoomId, and no "was sold" log line. Keep the no-fire control so the setup is proven able to sell.

### S6. The world hash cannot see the order of sims or rooms, or the event list - PARTIAL (final: ADVISORY)
- What holds:
  - `hashWorld` sorts rooms, shafts and sims by id (save.ts:671-687), so the order they are stored in is invisible to it.
  - m/7f (sims reversed on save) and m/8e (fire events filtered out of the hash) stayed GREEN on save, replay, replay-start, game, buildlog and five scenarios (142 tests).
  - m/7a (collector dropped) stayed GREEN on save and replay, and went RED only in recycling.test.ts ("saved and loaded mid round").
  - m/7e (rooms reversed) went RED only in vip-journey.
  - Rooms divergence reproduced with my own tower, since the lane's probe script was not kept: seed 12345; 42 offices on floors 2 to 8; 3 fast foods on floor 9; 3 condos on floor 10; one standard shaft from floor 1 to 10.
    - Saved at day 1 12:30: all four copies hash 9cff5ab7 at load.
    - After 2 days, the original and the plain reload are 96d4c511, but the reversed rooms give 2f669e48 (cash 18,141,196 against 18,141,280, a $84 gap).
    - After 7 days: 9da3a377 against 41a3d8e1, with 506 sims against 504.
    - Saved at 08:15 or 17:10 instead, the rooms copy diverges the same way.
- What does not hold: the sims-order divergence (the lane's f3dc3390, a $60 gap) did not reproduce. At three save points, running 2 and 7 days, the reversed-sims copy always matched the original. The lane's exact figures (ff870e4a, 1c594189) could not be rerun because the lane's script is missing.
- Live paths, as the task asked: none can reorder these arrays. `serialize` writes Map insertion order (save.ts:152-155). `deserialize` rebuilds each Map in file order for all readable versions 1 to 5, with no migration step that sorts (save.ts:462-506). Every load goes through it: game.ts:422, :883, :903, including import and slots. Replay (replay.ts:44-76) re-runs the same commands in the same order. Events are hashed in order (save.ts:688), so an event reorder does change the hash. Only a hand-edited or foreign file can reorder them, so this stays a guard gap.
- Fix spec: (1) add to save.test.ts a round trip that reverses `rooms` in the saved JSON, then loads and runs both copies 2 days, using the tower above. Expect equal hashes. This fails today, so pair it with a code change: either `deserialize` sorts rooms and sims by id, or `hashWorld` hashes Map order. (2) Add field tests to save.test.ts: a guard's `guard` and a collector's `collector` survive `serialize` then `deserialize` (this catches 7a and 7b), and removing a fire event from `world.events` changes `hashWorld` (this catches 8e). Nothing else in the hash projection should change, because the pinned bench hashes must hold.

### S7. The security scenario's "nothing was lost" uses the sim's own income ledger - CONFIRMED, narrow (final: ADVISORY)
- Reproduction: m/12a (a caught theft takes $lossCash, booked as negative shop income) stayed GREEN on security, events and story-beats (52 tests). My control `verifyI/12b` (the same loss taken as plain `world.cash -= THEFT.lossCash`, which is how theftEscaped at events.ts:705 takes it) goes RED at security.test.ts. So the hole is only a loss that is booked through the ledger.
- Fix spec: in the "guard catches the thief" test, snapshot `stats.incomeByKind` before `runTheft` and expect no entry to go down. Alternatively, expect `world.cash` to equal the value before the theft plus the ledger delta, with that delta checked to be at least 0. Input: the existing tower with the shop on floor 5.

### S8. Demo cap: a two-floor room's top floor is not tested - CONFIRMED (final: ADVISORY)
- Reproduction: m/9e stayed GREEN on demo-cap, build, tests/game and tests/ui (572 tests). The probe used the demo edition with a lobby from x 140 to 199 and offices at x 150, 159 and 168 on floors 2 to 19. A cinema at floor 20, x 150 is refused with code `demoCap` on live code. Under 9e it returns `{"ok":true}`, which puts a room on floor 21.
- Fix spec: add that case to demo-cap.test.ts using `refused(...)`.

### S9. Two Verification-table failure behaviors have no test - CONFIRMED (final: ADVISORY)
- Reproduction:
  - m/11a (passenger check deleted) stayed GREEN on cars, build, routing, people, elevators, first-tower, game and ui (720 tests). Probe "S9a": push a rider id into `car.passengers`, then `shaft.setCarRange` to 1-3. Live code returns `{ok:false, reason:'People are inside.'}` and `range` stays null. It goes RED under 11a.
  - m/11f (visitor give-up log deleted) stayed GREEN on tests/sim, first-tower, story-worker and ui (785 tests). I copied people.test.ts and added a log expectation after both `'Gave up waiting for an elevator on floor 3.'` asserts (:632, :723). The copy is GREEN on live code and RED under 11f (2 tests).
- Fix spec: add the S9a test to cars.test.ts. In people.test.ts:632 and :723, add `expect(world.log.filter(e => e.text === 'Gave up waiting for an elevator on floor 3.')).toHaveLength(1)`.

### S10. story-worker builds its expected text with the function it checks - CONFIRMED (final: ADVISORY)
- Reproduction: m/13a stayed GREEN on story-worker (6 tests) and went RED on story-beats (2 tests). This is lost redundancy, not a hole.
- Fix spec (optional): at story-worker.test.ts:112, also expect the chapter to match a literal form such as `/\b(one|two|...|\d+) minutes?\b/`, so the test no longer relies on `minutesText` alone.

### S11. The rentDay event fires 5 game hours before rent is paid - CONFIRMED (final: ADVISORY)
- Reproduction: probe `s11.test.ts` uses a lobby and one leased office, starts at minute 3*1440-1, and drains the tap every tick. Output: `rentDayEmittedAtMinute:4320`, while `lastQuarterChangedAtMinute:4621` and `firstCashMoveAtMinute:4621`, a gap of 301 minutes. audio.ts:208 plays 'register' on `rentDay`. The type comment at game/events.ts:14 says "when office rent is paid". tests/game/events.test.ts:41 and :131 pin the midnight behavior.
- Fix spec: emit `rentDay` when `stats.lastQuarter` changes, or when crossing `dayOfQuarter 0` at `quarterStartMinuteOfDay`. Change events.test.ts:131 to start at 3*1440+299 and expect one `rentDay` after that step, and none after a step from 3*1440-1. Alternatively, if midnight is intended, fix the comment only.

## Duplicates
- S11 is the same defect as lane D S10 ("The rentDay event fires at midnight, but rent is settled at 05:00").

## Notes
- Lane A's stuck-fire suspicion (a demolished burning room leaves `fireBurning()` true forever) interacts with S5: while that fire is stuck, condos never sell. That belongs to lane A and is not a new item here.
- Lane I's report says its `mut.py` runner shows RED for a missing-test-file run. When the shell passes the test list as one argument, vitest exits 1 with "No test files found", which looks like RED. I hit this in zsh and reran with array expansion. Any RED in lane I that shows no failing test name should be treated as unproven. Its listed REDs that I reran (7a in recycling, 7e in vip, 13a in story-beats) do fail on named tests.
