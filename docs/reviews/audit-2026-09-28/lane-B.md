# Lane B: People and transport at 0f05723

Host: arm64. Probes are in scratchpad/audit-2026-09-28/probeB/. Run them from the checkout with `npx vite-node@6.0.0 ../audit-2026-09-28/probeB/<file>`. I changed nothing in the repo.

Last audit's fixes still hold at 0f05723: S1 (class-aware `reachableFor`), S2 (`stopOffRefusal`), S3 (`rerouteWaitingSim` calls finishLeave), S4 (`freeSeatAndCar`, `sendAway` and the hourly `recountOccupancy`), S5 (`letOffAtNextStop`), S6 (fire hold in tickVip and tickTheft), S7 (stairs existence check), S8 (range check with the doors open) and N1 (`housekeepersByRoom`). S4 below is a second route into the S3 infinite wait, one the S3 fix does not reach.

## Suspicions

### S1. A condo sells again and again for free once its owners move out for "no way in" (proposed: CRITICAL)
- Where: src/sim/people.ts:352-358 (`startTrip` calls `endLeaseWithNoWayIn`), :757-777 (condo set back to `vacant`), :159-175 (`sellVacantCondos` credits `recordCondoSale` again). economy.ts:265.
- Input A (deliberate, costs nothing): lobby 100-200, a standard shaft at x 150 on floors 1-5, a condo on floor 2. Once it sells, set the only car to `hotel` at 16:00 on a weekday, then back to `any` at 22:00. Repeat.
- Input B (no player action): a metro station on B3 that nothing connects to, with its center nearer in x to the condo than either lobby end (S2). The residents leave by the metro in the morning (`leaveTower` teleports them there when there is no route). In the evening they cannot get back, so the owners "move out".
- Wrong outcome: each move-out leaves the condo vacant with its rating unchanged at 1.00, and the next weekday morning it sells again for $150,000 × rent. A condo built once for $80,000 pays out every two weekdays. Decision 2026-09-28 (a sold condo cannot be demolished) closed the same kind of loop through demolition. This loop goes through a car setting instead.
- Reproduce: `probeB/condo-loop2.ts`. With the toggle: `sold lines 6 cash 5065000`. Control (`CTRL=1`, no toggle): `sold lines 1 cash 4315000`. That is +$750,000 in 16 days. `probeB/metro-condo.ts`: `METRO ten days: condo sold 4 times, 'no way in' 3 times, cash 5270000` against `NO METRO ... sold 1 times, cash 5120000`. The difference is 3 extra sales, about $450,000, less the metro upkeep.

### S2. An office near an unconnected metro never keeps a tenant: it is let and then vacated all morning (proposed: IMPORTANT)
- Where: src/sim/people.ts:1058 and :1113-1116 (`spawnWorker` and `entranceFor` pick the nearest entrance, and that can be the metro). :447-458 (`leaveTower` puts a tenant at the metro when there is no route). :257-272 (`reachableFor` only asks from the floor 1 door). routing.ts:580-581.
- Input: lobby 100-140, a shaft at x 150 on floors 1-10, an office on floor 5 at x 300, and a metro on B3 at x 290 with no shaft to it. Run 08:00-09:30 on a weekday.
- Wrong outcome: the lease check passes from the lobby. The workers spawn at the metro, and the first one to arrive finds no route, which ends the lease. The next minute the office is let again. The news shows 22 "rented" lines and 22 "had no way in, so its tenants moved out" lines in 90 minutes, and the office ends the morning vacant with no rent. Hotel guests booked near the metro spawn there too, never arrive, and hold the room all night. The rule should be "every entrance a tenant can spawn at or leave by can reach the room", or spawns should use an entrance that has a class route.
- Reproduce: `probeB/metro.ts` prints `rented 22 times, 'no way in' 22 times, office vacant true, occ 0`. With `CTRL=1` (no metro) it prints `rented 1 times ... vacant false, occ 5`.

### S3. `waitStart` is never cleared at boarding, so transfers get no hall call and a VIP through a sky lobby is rated poor (proposed: CRITICAL)
- Where: src/sim/elevators.ts:375-379 (boarding leaves `waitStart`), :355-358 (alighting leaves it too). src/sim/people.ts:534-540 (`beginWait` only calls a car when `waitStart === null`). The consumer is events.ts:505 (`waitingSince = sim.waitStart ?? now`).
- Input: shaft A on floors 1-7, shaft B on floors 7-12, a hotel suite on floor 12, and `startVip`. The cars are idle and nobody else is riding.
- Wrong outcome: the VIP arrives at shaft B still holding the first wait's `waitStart`. No hall call goes in until `retryHallCall` fires on a multiple of 6 minutes. When it does, `trackWait` reads the stale start, so the first ride counts as waiting. The longest stretch the VIP actually spent waiting was 6 minutes, which is the fair band. The recorded wait was 25 minutes, so the rating is `poor`. `stats.vipRating` is overwritten by the latest visit, and 4 stars needs `fair`, so a tower whose suite needs a transfer keeps failing that star requirement. The same stale start also counts false long waits (people.ts:650), adds stress, and puts transfer riders ahead of people who were at the doors first (elevators.ts:169). `sendAway` on a sim that is already waiting also keeps the stale start, so its exit route calls no car for up to 6 minutes.
- Reproduce: `probeB/vip-transfer3.ts` prints `TRANSFER vip rating stored: poor final longestWait 25 longest minutes actually spent waiting in one stretch 6`. The direct shaft control (`DIRECT=1`) prints `longestWait 11 ... 11`. `probeB/transfer.ts` shows a shopper `waiting floor 5` at +10 with `Bcalls []` and the car idle at floor 5, boarding only at +13 after the 6-minute retry.

### S4. A sim on its way out waits forever once its shaft is demolished under it (proposed: IMPORTANT)
- Where: src/sim/people.ts:677-678. `retryHallCall` returns when the shaft is gone, before the reroute at :679. `moveSims` never steps a sim that is `waiting`, so the missing-shaft check at :488-493 never runs.
- Input: two shafts from floor 1 to 4 and a fast food on 4. A diner (`exiting`) is waiting at shaft A on floor 4 with shaft A's cars empty. `shaft.demolish` A is allowed, because B still keeps floor 4 reachable.
- Wrong outcome: the diner stays `waiting` at stress 1.00, `exiting true`, with a ride leg on a shaft that no longer exists, for good. This is the same infinite wait as last audit's S3, but the S3 fix sits behind the missing-shaft early return. A thief caught this way on the target floor would leave its theft event with no way to end (events.ts:807).
- Reproduce: `probeB/demolish-waiting.ts` prints `demolish A: {"ok":true}`, then at +1, +60, +600, +1440 and +4320: `state waiting floor 4 stress 1.00 exiting true route0 {"kind":"ride","shaftId":162,...}`.

### S5. A car with its doors open at a stop that was just turned off keeps boarding there (proposed: ADVISORY)
- Where: src/sim/elevators.ts:252-265. The doors-open branch checks the car's range but not `shaft.stops`. `boardable` (:403-411) checks only the destination.
- Input: a car stands with its doors open at floor 3 with a waiter bound for 5, then `shaft.setStop {floor:3, stops:false}`. That is allowed, since no rider aboard is bound for 3.
- Wrong outcome: on the next tick `serveFloor` boards the waiter at a floor the elevator no longer serves. Nobody is stranded. This is the stop version of last audit's S8.
- Reproduce: code trace. The doors-open branch runs `serveFloor` whenever `span.lo <= car.y <= span.hi`, and `shaft.stops` is never consulted.

## Questions for the owner
- Should "no way in" move-outs reset a condo's sale (for example, count as a buy-back), or should they not make the condo sellable again? S1 assumes a sale should come only from a real new owner.
- The class-aware lease check and the tenant move-out read each other through the car setting. Was a free and instant car setting meant to be able to evict tenants on demand?

## What the tests do not prove
- tests/sim/people.test.ts: routing and elevators are mocked, so `waitStart` across a board, alight and second ride (S3), metro spawns (S2), and `endLeaseWithNoWayIn` followed by a resale (S1) are all untested.
- tests/sim/elevators.test.ts and cars.test.ts: the fixtures set up waiters by hand. Nothing checks that `waitStart` is cleared at boarding, and nothing turns a stop off while the doors are open (S5).
- tests/sim/routing.test.ts: entrances are listed, but nothing checks that a room reachable from the lobby is also reachable from the metro entrance people spawn at.
- tests/sim/long-waits.test.ts: covers only the ring counter, not false long waits from a transfer.
- tests/scenarios/growth.test.ts: one flat shaft span with no transfer and no metro. It never demolishes a shaft while people wait, and never checks that every sim reaches a terminal state.

## Coverage
- Read in full: src/sim/people.ts, elevators.ts, routing.ts; tests/sim/people.test.ts, elevators.test.ts, cars.test.ts, routing.test.ts, long-waits.test.ts; tests/scenarios/growth.test.ts, helpers.ts; .itworks/DECISIONS.md; MAP.md Gotchas; the lane B sections of LANES.md; docs/reviews/audit-2026-09-25/lane-B.md and verify-B.md.
- Read in part: build.ts (demolish, freeSeatAndCar, shaft commands), events.ts (evictInto, failVisit, VIP, theft), evaluation.ts (moveOut, tickEvaluation), stars.ts, economy.ts recordCondoSale, rules.ts (SCHEDULES, SHAFTS, STARS, EVENTS.vip), save.ts hashWorld.
- Skipped: none in scope. Note: `git log` shows no in-scope file changed after dda1385 (the 2026-09-25 remediation). The money package 24b0ed4 changed economy.ts, events.ts and build.ts but not people.ts or elevators.ts, so the resting-rating rent rule lives outside this lane.
- Probes run: the lane vitest recipe gave 6 files, 150 tests, all passed. condo-loop2.ts: S1 confirmed (6 sales against 1). metro-condo.ts: S1 confirmed with no player action. metro.ts: S2 confirmed (22 lease cycles). transfer.ts and vip-transfer3.ts: S3 confirmed (25 recorded against 6 real, poor). demolish-waiting.ts: S4 confirmed. Checked and clean: occupancy recount, fire hold on intake, rng order (hall calls sorted, waiters sorted by waitStart then id), capacity at boarding, and letOffAtNextStop's stop choice.
