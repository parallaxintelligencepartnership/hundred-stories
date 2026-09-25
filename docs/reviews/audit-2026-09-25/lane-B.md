# Lane B: People and transport at 7b4e60f

## Suspicions

### S1. Offices lease, pay rent and count toward population when their workers can never reach them (proposed: CRITICAL)
- Where: src/sim/people.ts:128 (also the same gate at :146, :165, :183, :204, :360); src/sim/routing.ts:557-568
- Input: lobby, offices on floors 2 and 3, one standard shaft 1 to 5, then `shaft.setCarServes` on its only car to `hotel`. Run one quarter.
- Wrong outcome: `isReachableFromLobby` asks the class blind graph, which counts the hotel car. So `fillVacantOffices` leases both offices and spawns 12 workers. Each worker's `startTrip` asks `findRoute` with `riderClass: 'office'`, gets null, and stays outside every day. At quarter start `onQuarterStart` credits full rent (the eval stays 1.0 because stress decays outside), and `populationOf` counts 6 per leased office. The player earns money and stars from offices nobody can get to. The rule should be "a reachable vacant office": reachable for the class that will use it.
- Reproduce: scratchpad/audit/probeB/p4.ts (`npx vite-node@6.0.0 p4.ts` from the repo). Output: `office vacant false tenants 6 max occupancy seen 0 eval 1.00`, `lastQuarter {"income":20000,...}`, all 12 workers `outside`. The same gate lets hotel rooms book guests who can't reach them, and lets shoppers spawn for a shop they can't route to. The guest and shopper cases are harmless because they earn nothing.

### S2. Turning off a stop strands the riders already aboard for good, and the shaft can then never be demolished (proposed: IMPORTANT)
- Where: src/sim/elevators.ts:216 (`carFloors` drops any call not in `shaft.stops`), :261 (`shouldStop`), :294 (alight only at `leg.toFloor`); src/sim/build.ts doSetStop (it has no passenger check, unlike setCarRange and removeCar)
- Input: a shopper boards on floor 1 for floor 4. Then `shaft.setStop {floor: 4, stops: false}`.
- Wrong outcome: the car never targets floor 4 again, so the rider is `riding` forever. A riding sim builds no stress and can't give up. `shaft.demolish` now always refuses with "Wait until the cars are empty." and never says why. The only way out is to turn the stop back on, and nothing points the player there.
- Reproduce: probeB/p1.ts. After 600 minutes: `riding inCar 62 ... passengers 1`, and demolish returns `{ ok:false, reason:'Wait until the cars are empty.' }`.

### S3. A sim on its way out waits forever once its floor loses its only route (proposed: IMPORTANT)
- Where: src/sim/people.ts:582 (give up is skipped when `exiting`), :617 (`rerouteWaitingSim` keeps waiting when findRoute is null)
- Input: a diner done eating on floor 3 is waiting to ride down (`exiting: true`). The player turns off stop 3, and that shaft is the only way down.
- Wrong outcome: `requestHallCall` ignores floor 3, every reroute returns null, and the diner can't give up. It stays `waiting` at stress 1 with no reason logged, forever. A tenant gets out at midnight because `leaveReason` resets. Visitors, guests and anyone with `exiting` set never do. This breaks the lane rule of "no infinite wait". `runLeaving` already has the right fallback (`finishLeave` when there is no route), but a waiting sim never reaches it.
- Reproduce: probeB/p5.ts. After 3000 minutes: `exists true state waiting stress 1 reason null waited 3000`.

### S4. A tenant removed while sitting in another room leaves a phantom person in that room (proposed: IMPORTANT)
- Where: src/sim/build.ts doDemolish (calls `removeSim` on tenants without `departRoom`); src/sim/events.ts:137 (`evictInto` sets `sim.inRoomId = null` for a home-room tenant who is inside a different room, and never decrements that room)
- Input (demolish): a worker is at lunch in a fast food and its office is empty, so demolish is allowed. Or a resident is at the restaurant while the condo's other residents are still out, which is common from 18:00 to 21:00. Input (evict): a bomb or fire destroys an office while one of its workers is in the fast food.
- Wrong outcome: the fast food's `occupancy` stays at 1 after the person is gone. It is saved, it lowers the seats `spawnCommerceVisitors` and `pickRoomOfKind` offer, and it keeps the windows lit. Each event adds another one, and nothing ever clears them.
- Reproduce: probeB/p2.ts. `B demolish office: { ok: true } ff occupancy after 1 sim exists false`. `E ff occupancy ... 1` and at the end `diner exists false ... ff occ 1`.

### S5. A tenant whose home burns or is bombed mid ride is dropped out of the car in name only (proposed: IMPORTANT)
- Where: src/sim/events.ts:134-138 (`evictInto`); the same pattern is in `failVisit` at :440-450 for a VIP who is riding
- Input: a worker rides toward floor 5. Its office there is destroyed (helicopter or security ends the fire, or a bomb goes off).
- Wrong outcome: `state` becomes `leaving`, but `inCarId` and `car.passengers` stay. `runLeaving` routes the sim from its stale boarding `pos`, so it teleports out of the moving car and walks on its old floor while the car still counts it. If that exit route needs a ride, `indexWaitingSims` skips it (`inCarId !== null`), so it can't board. It waits until some other rider brings the car's doors open on its exit floor.
- Reproduce: probeB/p2.ts part C shows the sim walking on floor 1 with `car=165 ... pass=1` for 9 minutes. probeB/p3.ts (boarded on floor 3, car at y 4) shows it counted aboard and walking or waiting for 140 minutes until traffic opened the car at floor 1.

### S6. The VIP and the thief walk in while a fire burns (proposed: IMPORTANT)
- Where: src/sim/events.ts:486 (`sendVipToSuite` has no fire check), :607 (`thiefWalksIn`); src/sim/people.ts:73-76 (FIRE_HELD_KINDS leaves them out on purpose)
- Input: a fire starts at the 06:00 roll with no security office, and a VIP was announced for today at 08:00 or later (or a theft is booked).
- Wrong outcome: the log says "People are waiting outside until the fire is out." Then "The VIP ... walked into the lobby", and the VIP rides to the suite. The 2026-09-24 decision says no arrivals enter while a fire burns. The code comment excluding these two is not a ruling in DECISIONS.md. If Matt meant only regular visitors, move this to Questions.
- Reproduce: code trace. tickVip notice phase goes to `sendVipToSuite`, which never calls `fireBurning`.

### S7. A sim climbs stairs that have been demolished (proposed: ADVISORY)
- Where: src/sim/people.ts:481-486
- Input: stairs are demolished (allowed when another route exists) while a sim already holds a `stairs` leg for them.
- Wrong outcome: `climbStairs` still moves the sim to `leg.toFloor`, keeping its x. It crosses floors with no connector there. The `ride` leg case checks that the shaft still exists; the stairs case doesn't.
- Reproduce: give a sim the route `[stairs roomId X toFloor 2]`, demolish X, then tick once. `pos.floor` becomes 2.

### S8. A car whose range changes while its doors are open boards at a floor outside the new range (proposed: ADVISORY)
- Where: src/sim/elevators.ts:197-209 (the doors-open `serveFloor` runs before the range check)
- Input: an empty car has its doors open at floor 1, then `setCarRange {lo:7,hi:10}` is applied, which is allowed with no passengers.
- Wrong outcome: on the next tick it boards floor 1 waiters bound for 8 (`carTakes` checks only the destination), then drives into range. Nobody is stranded, but this breaks the rule that a car never serves a floor outside its range.
- Reproduce: cars.test style fixture. Open doors at 1 with a waiter for 8, apply setCarRange, tick once, and see the waiter `riding`.

## Questions for the owner
- With no security office (or when the only one is the room burning, since `securityOnDuty` needs one not on fire) and under $250,000, a fire never ends. People.ts then keeps every arrival outside indefinitely. Is that intended? The events part belongs to Lane C, but the effect on intake lands here.
- Two cars of one shaft with different ranges never give a transfer route (the `via.id` rule). That is tested and intended. Just confirming it is the ruling, since a floor served by both halves reads as unreachable.

## What the tests do not prove
- tests/sim/people.test.ts: routing, elevators and economy are all mocked, so nothing checks occupancy staying consistent across demolish, evict or riding. No fire hold case lives here. No test checks that a leased room can be routed for its tenant's rider class (S1).
- tests/sim/elevators.test.ts, cars.test.ts: nothing changes stops while riders are aboard (S2), nothing changes a range while doors are open (S8), and nothing covers a passenger whose sim changed state under it (S5).
- tests/sim/routing.test.ts: `isReachableFromLobby` is only tested class blind. The stairs leg is never checked against a demolished room.
- tests/sim/events.test.ts (fire hold): covers workers, residents and shoppers only. No VIP or thief during a fire (S6), and no evict of a riding or away-from-home tenant (S4, S5).
- tests/scenarios/growth.test.ts: hash determinism and totals only. It never asserts sum(occupancy) equals the sims actually inside.

## Coverage
- Read in full: src/sim/people.ts, elevators.ts, routing.ts, events.ts, types.ts, rules.ts; .itworks/DECISIONS.md; docs/DESIGN.md sections 1 to 11; tests/sim/people.test.ts, elevators.test.ts, cars.test.ts. Also the relevant parts of build.ts (demolish, shaft commands), world.ts (add/remove, setOccupancy), economy.ts (office rent), stars.ts (population), save.ts (id sorting), and the events.test.ts fire section.
- Skipped: tests/sim/routing.test.ts, long-waits.test.ts and tests/scenarios/growth.test.ts were read by case list plus helpers and the B1 section, not line by line. They are large and ran green.
- Probes run: the lane vitest recipe gave 6 files, 144 tests, all passed. Scripts are in scratchpad/audit/probeB: p1 (S2 confirmed), p2 (S4 and S5 confirmed), p3 (S5: 140 minutes double counted), p4 (S1 confirmed), p5 (S3 confirmed). Checked and found clean: rng order (rooms and sims Maps are in id order both live and after load, hall calls are sorted, and Set order never feeds a tie), capacity at boarding, the leftover rule, and floor 0 or B1 stairs spans.
