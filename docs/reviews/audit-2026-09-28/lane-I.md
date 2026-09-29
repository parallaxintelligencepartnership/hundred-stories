# Lane I: Tests as guards at 0f05723

Method: I copied src/, tests/, store/, public/ and scripts/ to `scratchpad/audit-2026-09-28/probeI/ov`, with node_modules symlinked. The pristine source is in `probeI/pristine-src`. `probeI/mut.py` makes one exact text replacement, runs the named test files, then restores the file. The old/new pairs are in `probeI/m/`. My scratch probe tests are in `probeI/ov/tests/probeI/`, in the overlay only. Test lists were passed as zsh arrays, so there is no false RED from "No test files found". Every RED below names the failing test. uname -m: arm64.

All the regressions from last audit are RED. The money package guards are RED for everything the task named, except the items below. Every suspicion here is a hole in the guards, not a live defect. The live code passes each probe.

## Suspicions

### S1. The 5-star metro requirement has no test that fails without it (proposed: ADVISORY)
- Where: src/sim/stars.ts:50. The guard is tests/sim/stars.test.ts:213 (positive case only). The table at :254-295 has no metro case.
- Input: mutation r11metro deletes the metro check.
- Wrong outcome: stars.test and story-beats stay GREEN (42 tests). PROJECT.md asks for "metro ... each covered". Last audit's S4 fix added a leave-one-out case for suite, recycling, medical, VIP and cathedral, but not for metro.
- Reproduce: `probeI/ov/tests/probeI/guards.test.ts` P5 sets stars to 4, adds 5-star population and no metro, and expects 4. It passes on live code and goes RED under r11metro.

### S2. No test notices upkeep being skipped for a room that is burning at the settle (proposed: ADVISORY)
- Where: src/sim/economy.ts:94-97. The ruling in DECISIONS.md (2026-09-28) is "upkeep is charged in full for whatever exists at the settle".
- Input: mutation 3c adds `&& !room.onFire && !room.infested` to the upkeep push. Security, housekeeping, parking ramp, recycling and metro can all burn (events.ts:102).
- Wrong outcome: GREEN across economy, build, events, security, first-tower, demolish-threats, evictions, save, story-beats, recycling and game/events (310 tests).
- Reproduce: probe P2 puts a security office with `onFire: true` through `onQuarterStart` and expects `lastQuarter.upkeep` of 20,000. It is RED under 3c. (Mutations 3a and 3b, which skip rooms built this quarter, are RED in 9 tests.)

### S3. No test notices the settle and the star recount swapping order (proposed: ADVISORY)
- Where: src/sim/tick.ts:18-19. The order is documented in DESIGN.md §5 (step 5, then step 6).
- Input: mutation 1c moves `recomputeStars` above `onQuarterStart`. Lobby upkeep is scaled by stars (economy.ts:63). An office vacated by the 04:30 evaluation can drop the star rating at 05:00.
- Wrong outcome: GREEN in all 11 money files. Probe P1 uses stars 3, 10 lobby tiles and no population, and ticks minute 3*1440+300. Live code bills 3,000. Under 1c it bills 0.
- Reproduce: guards.test.ts P1. (1a, which snapshots before applying, is RED in 17 tests. 1d, which settles before the 04:30 evaluation, is RED in first-tower:148 and baselines:14.)

### S4. The refund guard checks only the income table (proposed: ADVISORY)
- Where: tests/sim/build.test.ts:686-701 guards src/sim/build.ts:556, :626 and :739.
- Input: mutation 2d books the room refund as a negative fire loss. Mutation 2e books it as negative upkeep.
- Wrong outcome: both GREEN across economy, build, evictions, demolish-threats, first-tower and events (205 tests). The refund still inflates "profit" in the quarter line and `lastQuarter.net`, which is "a refund counted as income" by another road. 2a, 2b and 2c (booked through incomeByKind) are RED.
- Reproduce: probe P4 snapshots all three tables around a demolish. It goes RED under 2d and 2e.

### S5. The rent setting on hotel nights and condo sales is unguarded (proposed: ADVISORY)
- Where: src/sim/economy.ts:261 and :267. The ruling is DECISIONS.md 2026-09-20, which says rent scales "hotel nightly income and condo sale price".
- Input: mutation 6d drops `room.rent / RENT.default` from recordHotelNight. Mutation 6f does the same in recordCondoSale.
- Wrong outcome: GREEN. The economy tests use rent 100 only, and people.test mocks both functions.
- Reproduce: probe P3 (a twin at 150% expects $4,500; a condo at 50% expects $75,000) goes RED under each mutation.

### S6. The bank line's exact boundary is untested (proposed: ADVISORY)
- Where: src/sim/economy.ts:209 (and :200 for the debt line).
- Input: mutation 7a changes `<` to `<=`. The player text promises "Get to -$500,000 or better".
- Wrong outcome: GREEN (172 tests). A tower sitting at exactly -$500,000 would count a bad quarter and could be foreclosed. The tests use -500,001 only. Likewise, 6e (`cash < -1`) is GREEN.
- Reproduce: m/7a against economy, first-tower, events and save.

### S7. The hash's field coverage for Sim and Stats is unguarded, so the determinism oracle can go blind (proposed: ADVISORY)
- Where: src/sim/save.ts:873 (stress), :883 (guard), :885 (collector), :933 (stats). The guard at tests/sim/save.test.ts:472 checks only `Sim.exiting`.
- Input: h1 sets `stress: 0` in simForHash. h3 sets `guard: undefined`. r7a sets `collector: undefined`. h4 empties `lossesByKind` in the projection. h6 zeroes `badQuarterStreak`.
- Wrong outcome: all GREEN in save, replay, save-roach, economy, events, cars, security and recycling. That includes the pinned hashes eeb027e5 and 9650a815. The save.ts comment says "a field the serializer drops moves the hash instead of hiding in it", but only Room and Car are checked field by field.
- Reproduce: probe P6 is RED under h1, h4 and h6.

### S8. A save whose sims array is reordered hashes equal at load, then drifts (proposed: ADVISORY)
- Where: src/sim/save.ts:733-738 rebuilds sims in file order. Only rooms are sorted (save.ts:697-701), and only rooms are tested (save.test.ts:648).
- Input: seed 12345, 121 lobby tiles, two shafts, 84 offices, fast food and condos. Save at day 1 08:40, reverse `sims` in the JSON, load, and run 2 days next to the original.
- Wrong outcome: the load hash matches. After 2 days the hashes are 3156eac8 (original and plain reload) against df36b884 (reversed), and cash is 46,371,580 against 46,371,592. Reversing shafts does not diverge. Only a hand-edited or foreign file can do this (serialize writes id order), so it stays ADVISORY. It is the half of last audit's S6 that was not closed, and it now reproduces.
- Reproduce: `probeI/ov/tests/probeI/order.test.ts` ("reversed sims" is RED on live code).

## Questions for the owner
- security.test.ts:348 ("hashes exactly as it did before guards and thieves") and recycling.test.ts:395 were re-recorded from the current code on 2026-09-28. They now prove only "unchanged since today", not the equivalence their titles claim. Is a re-recorded pinned hash the intended guard? It is also the only guard for h2 (shaft homeFloor dropped from the hash, RED only there) and h5.
- tests/harness.test.ts is still `1+1 === 2` under the title "proves it can fail". Keep or delete?

## What the tests do not prove
- Elevators (PROJECT.md): the success proof, "8 cars ... average wait under threshold", still has no test. The most cars in any assertion is 4 (first-tower:311, comparative).
- economy.test.ts:434: the forecast is compared with the settle, and both come from `settleLines`. Only the literal tables at :441-442 and :451 are independent.
- first-tower.test.ts:148: expected rent is computed from `office.eval` as the sim left it. A wrong eval would pass (economy.test.ts:478 pins it independently).
- build.test.ts mocks `spend`, so the real reason text is guarded only by economy.test.ts:62 and the plurals test.
- people.test.ts mocks economy, so condo and hotel money never meet real rents in a tick (S5).
- tests/rng.test.ts pins no sequence. A change to the constants is caught only by the pinned hashes.
- Failure rows outside my scope, checked by grep only: game-over card (tests/ui/alerts.test.ts), share picture notice (share-panel.test.ts:69), "Details start next quarter." (panels.test.ts), hero video fade (tests/site/hero-trailer.test.ts:131), theme storage throws (theme.test.ts:111), worker range and feedback (tests/worker). Each has a test.

## Coverage
- Read in full: all 22 tests/sim/*.test.ts; tests/scenarios/helpers.ts and all 10 scenario tests; all 20 tests/game/*.test.ts; tests/harness.test.ts; tests/rng.test.ts; src/sim/economy.ts; src/sim/tick.ts; src/sim/stars.ts. Also read: .itworks/PROJECT.md, DECISIONS.md, the MAP.md Gotchas, the Lane I section and lane-independent rules of LANES.md, audit-2026-09-25 lane-I.md and verify-I.md, economy-review-2026-09-28.md, DESIGN.md §5.
- Read in part, around each mutation site: src/sim/build.ts (330-790), events.ts (90-330, 730-760, 960-997), save.ts (140-230, 690-760, 820-937), people.ts (the sale and give-up sites), game/events.ts (54-100).
- Skipped: none in scope.
- Probes run:
  - Baseline, all lane files on the pristine overlay: 53 of 54 files pass, 791 tests. steam.test.ts fails only because the overlay has no src-tauri/.
  - About 60 single mutations:
    - RED: 1a, 1d, 2a-2c, 3a, 3b, 3d, 4a, 5a-5j, 6a-6c, 7b, r1b, r2b-r2d, r4c, r6c, r7b, r7c, r7e, r8e, r9e, r11a, r11f, r11 medical, recycling, cathedral, security, suite, wedding and vip, rS11, and h2 and h5 (pinned hashes only).
    - GREEN: 1c, 2d, 2e, 3c, 6d, 6e, 6f, 7a, r11metro, r7a, r7f, h1, h3, h4 and h6.
  - Probes P1 to P6 pass on live code and each goes RED under its mutation. order.test.ts: shafts reversed matches; sims reversed diverges (S8).
