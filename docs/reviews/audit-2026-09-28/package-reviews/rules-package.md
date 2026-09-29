# Review: commit ccc0f7e (evening rush spread, stats.avgWaitMinutes)

Scope: tier checkpoint on ccc0f7e, one pass covering design verify, itworks, real data and testing. The commit was judged from a `git archive` overlay in the scratchpad, not from the working tree that another agent is editing. Files read in full: src/sim/people.ts at ccc0f7e. Files read for the diff and the relevant sections: rules.ts SCHEDULES, world.ts, elevators.ts (serveFloor, letOffAtNextStop), economy.ts onQuarterStart, save.ts (versions, stats validation, hashWorld), types.ts Stats, tick.ts, evaluation.ts tickEvaluation, render/venue.ts venueOpen, the new evening-rush test, the changed scenario tests and save.test.ts, and scripts/bench (README, hash.ts). Not covered: src/ui and src/game (they don't read the field), the audio and render timing beyond venueOpen, and scripts/bench/hash.ts, which wasn't run (the commit changes no bench artifact, see A3). Machine: arm64. Baseline: `npx vitest run tests/sim tests/scenarios` in the overlay gave 41 files and 638 tests passing.

Counts: CRITICAL 0, IMPORTANT 1, ADVISORY 5.

## Findings

### I1. IMPORTANT: avgWaitMinutes can never record a wait of 18 minutes or more. Every longer wait is cut to its last segment.
- Where: src/sim/people.ts:699-703 and 727 (retryHallCall calls rerouteWaitingSim once `waited >= 18`, and that sets `sim.waitStart = null`). The next tick's beginWait (people.ts:553-554) starts a fresh clock. src/sim/elevators.ts:381 then records `minute - waitStart` from that fresh clock.
- Input: any rider who waits 18 minutes or more. Every sixth minute from 18 on, the rider is rerouted regardless of whether the call is pending, usually onto the same shaft.
- Outcome: expected per DESIGN.md and types.ts is "mean hall wait of riders who boarded a car this quarter". Actual: the longest wait ever recorded is 17 minutes. A 40 minute wait counts as 4. The more congested the tower (Matt's 1,000-person case, the reason for this package), the further the stat reads low.
- Reproduction: scratch copy ovE, with counters in rerouteWaitingSim and at the boarding line. The tower is the bench medium tower (14 office floors, 280 wide, 2 shafts x 2 cars, seed 4242), run to day 1 20:00. Result: stat avg 8.04 over 4,994 boardings, 33,656 reroutes, 605,808 waiting minutes dropped, longest boarded wait 17 (probes/waitsE.ts).
- Fix direction (owner's call): keep the first wait minute across a reroute, for example with a separate unhashed or saved field, or by not clearing it when the reroute keeps the same hall. Doing it now avoids a second re-recording of the pinned hashes later. If the owner accepts "wait since the last reroute" as the meaning, this becomes an ADVISORY and the DESIGN.md sentence should say so.

### A1. ADVISORY: the departure half of the rush test passes on the old single-window code
- Where: tests/scenarios/evening-rush.test.ts:59-78 (the minute-by-minute part: `left.length > 0.9n`, min ≥ 16:30, max ≤ 19:31, largest 10-minute bucket ≤ n/3).
- Input: the parent's rules.ts and people.ts (a 17:00 to 18:30 uniform draw), with the test's constant pins removed and expect turned into expect.soft.
- Outcome: the test still fails on the old code, so (4) holds. It fails only through the schedule-level checks: per-office spread of 40 to 85 minutes against the limit of 30, and a tower spread of 90 against the required 120. The observed-departure assertions all pass on the old code. Uniform over 90 minutes is about 11% per bucket against a 33% limit, and even a 30-minute spike would pass. With the new windows but independent draws per worker (variant D), only the per-office check fails.
- Reproduction: overlays ovA and ovD, test copy rush-soft.test.ts, `npx vitest run tests/scenarios/evening-rush.test.ts`.

### A2. ADVISORY: "a give-up is not averaged" and "stairs don't count" are guarded only by a pinned hash
- Where: tests/sim/save.test.ts, the N1 tests. The "nobody rides" tower is a lobby with no rooms and no people, so it can't test stairs.
- Input: mutation ovF, which adds `recordBoardedWait(world, 0)` in giveUp (people.ts:762) and in climbStairs (people.ts:571).
- Outcome: of the sim and scenario tests, only security.test.ts's pinned hash fails (9392abed against 5bb82411). No named test states either rule. The code itself is correct: stairs never set waitStart, and a give-up clears it without recording.
- Reproduction: ovF, `npx vitest run tests/sim tests/scenarios`. Two further file failures there come from the overlay leaving out store/fixtures and aren't related.

### A3. ADVISORY: the commit message and one hash comment overstate what moved
- Where: commit message ("Bench and scenario hashes re-recorded") and tests/scenarios/recycling.test.ts:411-413.
- Outcome: the commit contains no bench hash artifact. The only recorded bench hashes are in docs/reviews/2026-09-23-baseline.md, which is historical and untouched. For recycling, reverting only the boarding record (ovB) leaves the hash at a7613ca2, because nobody boards in that tower. What moved it besides the schedule is the new `waitsCounted: 0` key in createWorld: reverting schedule, boarding and that key (ovC) returns exactly 9650a815.
- Reproduction: overlays ovA, ovB and ovC, `npx vitest run tests/scenarios/security.test.ts tests/scenarios/recycling.test.ts`.

### A4. ADVISORY: offices look open until 7:30 PM for every company
- Where: src/render/venue.ts:118 (`m < SCHEDULES.worker.leaveEnd`, tower-wide).
- Input: a company whose quitting time was drawn at 4:45 PM.
- Outcome: its office shows open blinds for about 2 h 45 min after it has emptied. Before this commit the gap was at most 1 h 30 min (last exit 18:30 was also the close). This is visual only.
- Reproduction: from reading the code. The per-company exit times come from the determinism probe (range 1001 to 1159).

### A5. ADVISORY: the new numbers aren't pinned except the leave window
- Where: tests/sim/people.test.ts reads `SCHEDULES.worker.arriveStart` and the resident constants rather than literals. evening-rush pins only 16:30 and 19:30.
- Outcome: if arriveStart (7:30) or the resident returnEnd (21:30) drifted from Matt's numbers, no test would fail.

## Verified (attacks that found nothing)
1. Determinism: two runs give the same hash (24cd421b). Save and load at 08:05 (mid-lease), 17:40 (mid-rush) and day 1 18:10 each reach the identical hash at day 2 20:00. Reversing the rooms Map order before the lease gives identical per-office exits and rng state; on the parent the same reversal changes the exits, so the id sort does real work (probes/det.ov.ts, det.ovP.ts).
2. Old saves: a save written by the parent code at day 1 12:00 (v5, no waitsCounted) loads under ccc0f7e. All 120 workers keep their old exits (1021 to 1110, inside the new window), the hash is stable across a reload, and waitsCounted loads as 0. An office vacated after the load re-leases on the next weekday with exits 1120 to 1149, all within ±15 of one draw. The v1 to v5 loops in save.test.ts pass.
3. Window edges: rng.int is inclusive, quit is in [1005, 1155] and leave is in [990, 1170], so the leave is exactly 4:30 to 7:30. The weekend chance, lunch and the draw count per worker are unchanged; one extra draw per office is added. Resident returns up to 21:30 stay ahead of nightStart at 23:00.
4. The rush test fails on the old code (see A1 for which half).
5. avgWaitMinutes: it is recorded only at elevator boarding (elevators.ts:381). Stairs and give-ups aren't counted. n is at least 1 before dividing, so there is no NaN. The reset sits in onQuarterStart beside the other per-quarter tables, and the field survives a save (N1 test and probes). Staff, guards and collectors who board are counted, which is consistent with "riders who boarded".
6. Hashes: reverting the schedule alone moves both pins. Reverting the boarding record alone moves only security. Reverting both plus the new key returns 42ecfb60 and 9650a815 exactly.
7. The DESIGN.md table matches rules.ts on every figure.
8. vip-journey: removing the VIP guard in evaluation.ts:194 fails the moved test at ccc0f7e and at its parent alike ("The VIP left: no suite was ready"), so it still proves what it proved. lowEvalSince starts at build time, so the "full day" in its comment holds.

## Notes (not findings)
- Nothing in src/ui, src/game or src/render reads avgWaitMinutes. Candidate places to show it: the goals card next to longWaitsInHour, the quarter-over log line in economy.onQuarterStart, and the chronicle. onQuarterStart zeroes the mean without copying it into lastQuarter, so a "last quarter's average wait" display would need that copy first.
- save.ts accepts a negative avgWaitMinutes, or a nonzero one with waitsCounted 0. This is harmless because the next boarding overwrites it.
- Real-data context, bench medium tower, day 1 evening: peak concurrent waiters fell from 1,039 to 791, and give-up lines from 227 to 211.

## Questions for the owner
- I1 meaning: should the average be of whole hall waits, or of waits since the last reroute?

Probes and overlays: scratchpad/probes/*, scratchpad/ov* (none of them in the repository).
