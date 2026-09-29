# Verification of lane B at 0f05723

Host arm64 (uname -m). Checkout: scratchpad/audit-0f05723 (HEAD 0f05723). DECISIONS.md read in full (134 lines; the checkout copy and the main repo copy are identical). I re-ran every reviewer probe and wrote my own under scratchpad/verifyB/. My overlay was scratchpad/overlay-B (deleted). Nothing in either checkout was changed.

## Verdicts

### S1. A condo sells again once its owners move out for "no way in" - PARTIAL (final: not a defect on its own; Input B is folded into S2 at CRITICAL; Input A goes to the owner, ADVISORY at most until he rules)
- Reproduction: `probeB/condo-loop2.ts` printed `sold lines 6 cash 5065000`. With `CTRL=1` it printed `sold lines 1 cash 4315000`. `probeB/metro-condo.ts` printed `METRO ten days: condo sold 4 times, 'no way in' 3 times` against `NO METRO ... sold 1 times, 'no way in' 0 times`. The numbers hold.
- What the settled decisions say: 2026-09-28 (line 128) is "demolition refunds 25% (rooms, shafts with cars, cars)". 2026-09-28 (line 132) is "a sold condo cannot be demolished ("This condo belongs to its owners now"); a vacant one refunds 25% like any room | why: closes the build, sell, demolish, rebuild loop". Neither entry covers resale after the owners leave. No DECISIONS line rules on it either way.
- A second sale is a documented rule, not a defect. how-to-play/index.html:153 says "An office becomes empty, a condo goes back up for sale". README.md:71 says "go back on sale if a tenant leaves". docs/DESIGN.md:86 says "condo goes back on sale". The no-way-in path was written that way on purpose: people.ts:756 reads "the room is back on offer" (dda1385). The low-rating move-out at evaluation.ts:172 resells the same way.
- Input A (car set to hotel at 16:00, then back to any at 22:00): every step follows the rules as written. The owners really had no class route home, so the move-out is correct and so is the next sale. What is new is that a free, instant car setting triggers the move-out. That is an exploit of a rule, not a code defect, so the "stored money is CRITICAL" line does not apply. The owner has to decide whether this loop should be closed. Precedent: the sister loop (build, sell, demolish) was logged as ADVISORY (.itworks/REVIEWS.md:683) and closed by decision 132. Filed under Questions.
- Input B (unconnected metro): this one is wrong money. The residents can reach their condo from the lobby, and they lose it only because leaveTower drops them at the unreachable metro. It is the S2 defect. I reproduced it through real commands and count it under S2.

### S2. Tenants spawn at, and leave by, an unconnected metro, so leases churn - CONFIRMED (final: CRITICAL, raised from IMPORTANT)
- Reproduction with real build commands (the reviewer's probes used addRoom): `scratchpad/verifyB/metro-cmd.ts`. Setup: lobby 100-300 via `build`, a standard shaft at x 150 on floors 1-10, `stars=4`, a metro via `build` at B3 x 190 (accepted), and an office on floor 2 x 200 (accepted). Entrances: `[{1,100},{1,300},{-3,205}]`.
  - Office, day 3, 08:00-09:30: `rented 19 'no way in' 19 vacant true occ 0`. Control (`CTRL=1`, no metro): `rented 0 'no way in' 0 vacant false occ 3`.
  - Condo over ten days (`metro-cmd10.ts`, `KIND=condo`): `sold 4, 'no way in' 3` against control `sold 1, 'no way in' 0`. That is three extra $150,000 sales credited through recordCondoSale, which changes stored cash. The reviewer's `probeB/metro.ts` also re-ran as reported.
- Why CRITICAL: the rubric makes changed stored money CRITICAL "regardless of how rare". Here it happens with no player action: wrong condo sales go in, and the office is vacant through the lease window. The trigger is ordinary: a 4-star tower builds its metro under a wide lobby before any shaft reaches it.
- Fix spec:
  - Spawning at an entrance (entranceFor, people.ts:1113) and leaving by one (leaveTower, people.ts:447-458) must only use an entrance that has a route for the sim's class.
  - When leaveTower finds no route to the nearest entrance, it must try the others before it places the sim outside at one.
  - Alternatively, reachableFor must hold for every entrance a tenant can use. Either way, a room reachable from the lobby never ends its lease because of the metro.
  - Test (tests/sim, fails now, passes after): the metro-cmd geometry. The office rents once and logs no "no way in" line between 08:00 and 09:30. The condo sells exactly once in ten days.
  - Must not change: a metro that is connected stays an entrance, and a room with no route at all still moves out.

### S3. waitStart is never cleared at boarding - CONFIRMED (final: CRITICAL, as proposed)
- Reproduction: `probeB/transfer.ts` shows `waitStart 360` kept through riding and walking. At +10 it shows `waiting floor 5 ... Bcalls [] Bcar y 5 idle`, and the rider boards only at +13, which is the retry at waited=12, a multiple of 6. `probeB/vip-transfer3.ts` printed `TRANSFER vip rating stored: poor final longestWait 25 ... actually ... 6`.
- Mutation proof: in the overlay I added `sim.waitStart = null;` after `sim.state = 'riding';` in the boarding loop (elevators.ts:377). After that the shopper boards at +10 instead of +13, and the VIP prints `TRANSFER vip rating stored: fair final longestWait 6`. With the fix, tests/sim/elevators, cars, people and long-waits all pass (4 files, 99 tests).
- Why CRITICAL: `stats.vipRating` is stored and gates 4 stars (rules.ts:151, `vipRating: 'fair'`, fair means 8 minutes or less, rules.ts:237). A suite reached through a transfer is rated poor when it should be fair, so stars change.
- Not reproduced: the false long-wait count. The transfer probe printed `long waits counted this hour 0`, because the stale wait crossed 6 minutes while the sim was walking. The claim is plausible but carries no weight in the verdict.
- Fix spec:
  - Clear waitStart when a sim boards (elevators.ts serveFloor boarding loop). Also clear it in sendAway when it replaces a waiting route, so the exit leg's beginWait places a hall call.
  - Test: a two-shaft transfer (A 1-7, B 7-12, B's car idle at 7). The rider's hall call on B appears the minute it starts waiting at B. A VIP whose real waits are each 8 minutes or less stores `fair`.
  - Must not change: the queue order is still by waitStart among people actually waiting, and the rest of the VIP rating is unchanged.
  - Bench and scenario hashes will move. Re-record them as with 2026-09-28 line 130.

### S4. A sim on its way out waits forever once its shaft is demolished - CONFIRMED (final: IMPORTANT, as proposed)
- Reproduction: `probeB/demolish-waiting.ts` printed `demolish A: {"ok":true}`. At +1, +60, +600, +1440 and +4320 it printed `state waiting floor 4 stress 1.00 exiting true route0 {"kind":"ride","shaftId":162,...}`. The code path: retryHallCall returns at people.ts:677 (`if (!shaft) return;`) before the reroute at :679. moveSims only steps sims that are walking or leaving (people.ts:470), and doDemolishShaft (build.ts:611-630) checks only riders in the cars.
- My variant (`verifyB/demolish-worker.ts`): a worker who is not exiting recovers. It gives up and is back to normal by +1440, and no tenant leaves. So only sims already exiting are stuck.
- Severity: a person stuck forever, plus the traced theft case with no path to ending, is IMPORTANT. I did not reproduce the thief variant.
- Fix spec:
  - In retryHallCall, a missing shaft must go to the same path as a missing shaft in stepAlongRoute (reroute, or leaveTower/finishLeave for exiting sims) instead of returning. Or shaft demolition must reroute the sims waiting on it.
  - Test: the probe geometry. After `shaft.demolish` A, the diner is out of the world, or no longer waiting on A, within 18 minutes.
  - Must not change: the refusal while riders are aboard.

### S5. A car with its doors open boards at a stop just turned off - CONFIRMED (final: ADVISORY, as proposed)
- Reproduction: `verifyB/stop-off.ts` printed `setStop 3 off: {"ok":true} stops [1,2,4,5,6]`. After one tick: `sim riding inCar 43 car y 3 doorsOpen stops has 3 false`. The doors-open branch (elevators.ts:252-265) never reads shaft.stops.
- Nobody is stranded, and boarding a person already at the doors is arguably kind. It is only inconsistent with the range guard from the last audit's S8.
- Fix spec (optional): close the doors when `!shaft.stops.has(Math.round(car.y))`, the same as the range branch. Test: the probe above ends with the sim still waiting. A rider aboard can still alight elsewhere.

## Duplicates
- None. Lane A:20 mentions the metro only for the demo cap, which is a different defect.

## Questions for the owner
- S1 Input A: should a "no way in" move-out that the player causes by a car setting make the condo sellable again for the full price? The guide says a vacated condo goes back up for sale, and nothing says a car setting cannot cause that. The sister loop was closed by 2026-09-28 line 132.

## Notes
- New suspicion N1 (not reproduced, for the orchestrator): per the reviewer, hotel guests booked near an unconnected metro spawn there (spawnGuest uses entranceFor, people.ts:1093). If they never arrive, the room is held all night and earns no nightly income. It shares the S2 root and should be covered by the S2 fix and test.
