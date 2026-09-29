# Verification of lane C at 0f05723

Checkout: scratchpad/audit-0f05723 (git status clean before and after). Host `uname -m`: arm64. DECISIONS.md read in full (134 lines). My probes are in scratchpad/verifyC/. The overlay (scratchpad/overlay-C) was used and then deleted.

## Verdicts

### S1. Cockroaches never leave once housekeeping cleans the room - CONFIRMED (final: CRITICAL)
- Reviewer probe re-run (probeC/roach.ts): same output. 98 is `cI0` from day 2 to day 8, the infestation spreads to 99, 100 and 101, `cleaned lines 10`, `roach gone lines 0`. Caveat: that probe sets the first room to dirty and infested by hand.
- Independent natural path (verifyC/roach-natural.ts). Real build commands and the full tick loop, with no room fields set by hand. The setup is four singles on floor 2 with no housekeeping. Rooms 97 and 98 check out on day 1 and sit dirty. They become infested on their own at the day 5 roll. Housekeeping is then built at minute 7561. Output: `day 6 97:cI0 98:cI0` (cleaned, still infested). It spreads to 99 on day 7 and to 100 on day 9. From day 9 to day 15 all four are `cI0`. Totals: `cleaned lines 9 moved-in 2 spread 2 gone lines 0`. `checkouts by day [1,1,2,5,6,6,7,7,8]`: after day 8 there are no bookings at all, so hotel income from the row stops for good.
- Root cause, shown by mutation. In the overlay I deleted only people.ts:940 (`room.dirtySinceMinute = null` in finishCleaning). The same natural probe then prints `day 6 97:c-0 98:c-0`, `gone lines 2`, `spread lines 0`, and bookings continue every day through day 13.
- Two faults compound:
  - The clearing check at events.ts:838 needs `dirtySinceMinute != null` on a clean room. finishCleaning (people.ts:939-940) nulls it, and so does recycling.ts:367-368. Nothing else ever sets `dirty = false` on a hotel room while leaving the timer set.
  - A room infested while clean is never booked (people.ts:184). It is also never picked by housekeeping, because dirtyHotelRooms (people.ts:906-913) wants `room.dirty`. So the events.ts:837 promise ("keeps them until it needs cleaning again") can never come true.
- The existing unit test, events.test.ts:760 "housekeeping cleaning the room clears the cockroaches", passes (5 of 5 cockroach tests pass with `-t cockroach`). It proves only that tickCockroaches clears a room whose `dirty` was flipped by hand while `dirtySinceMinute` stayed set. That state is unreachable in play. It bypasses finishCleaning entirely. people.test.ts:366 ("clears it on cleaning") pins the nulling. With the mutation it fails with `expected 2036 to be null`, so the fix must not rely on keeping the timer.
- History. The clearing path broke in c87699a (2026-09-19, "cockroach timer persisted on the room"). Before that, the dirty-since WeakMap entry was deleted only inside tickCockroaches, so a housekeeping clean left it set and the next roll cleared the roaches. c87699a moved the timer onto the room and also added `room.dirtySinceMinute = null` to finishCleaning. That line is the regression. Last audit's fix, 1f0730c (2026-09-25, P3), moved only the spread cadence WeakMap into `world.roachLastSpread`. It did not touch the clearing path, so it is not the cause. Its diff changes only the `state.lastSpread` lines.
- Severity. The trigger is ordinary: hotels built before housekeeping (both need 2 stars), a keeper with no route, or a waste backlog, which excludes the room from housekeeping (people.ts:910). The effect is permanent loss of hotel income on every connected hotel room of the floor, plus the infested eval penalty. An infested suite can never host a VIP (freeSuite, events.ts:351), which blocks the 4-star `vipRating: 'fair'` requirement (rules.ts:151). The only way out is demolition at a 25% refund. This changes stored money and blocks stars, so it is CRITICAL.
- Fix spec:
  - In finishCleaning, a room that is infested gets `infested = false` and the log line "The ... is clean again and the cockroaches are gone." Keep the timer nulling, so people.test.ts:366 stays green.
  - Make infested hotel rooms with no guest and no waste backlog count as needing housekeeping. That means dirtyHotelRooms, and stayMinutesFor at people.ts:588, which must give minutesPerRoom for such a room. A clean room infested by spread then gets cleared.
  - The events.ts:835-844 branch and its comment then become a fallback or can go.
  - Tests that must fail today and pass after: (a) a scenario test of this natural path. No housekeeping until a room infests, then build it, and within 3 days every single has `infested === false` and at least one "cockroaches are gone" line. Today the result is 4 infested and 0 lines. (b) events.test.ts:760 rewritten to clean through a real housekeeper instead of `room.dirty = false`.
  - Must not change: the 3-day infest delay, the 2-day spread cadence, the save format (5), or towers that never infest. Bench hashes may move only if a bench tower infests (per the 2026-09-28 hash ruling).

### S2. A bomb whose room burned down goes off in the ground lobby - CONFIRMED (final: IMPORTANT)
- Reviewer probe re-run (probeC/bombfire.ts): both variants print `lobby tiles left 36 missing x [90, 91, 92, 93]`, `far office exists true`, and "The bomb went off on floor 1. 4 rooms were destroyed and the repairs cost $2,000,000." The helicopter variant is triggered by the player's own action (`heli {"ok":true}`).
- Independent reproduction (verifyC/bomb-secfire.ts) with real build commands and the full tick loop, no demolish. The tower's only security office (floor 2, x 170) is the fire room, and the bomb lands in the office touching it (x 187). With the only office burning, securityOnDuty is false (events.ts:88), so nobody searches. Output:
  - `390 The fire spread to the office on floor 2.`
  - `540 The fire burned itself out. 2 rooms burned down...`
  - `780 The bomb went off on floor 1. 4 rooms were destroyed...`
  - `lobby tiles missing [150,151,152,153]`, `far office exists true`, `cash delta -2040000`.

  This needs no demolished security office, so it is reachable at 3 stars with one office. Stars fall by population only (stars.ts:70-72), which confirms the reviewer's other route.
- Cause: events.ts:310-313 and 323. `distanceFrom(undefined, room)` returns `room.id`, so the lowest-id rooms (the first lobby tiles) are destroyed, and `floor` defaults to 1. Rare (a fire and a bomb on the same roll, next door to each other), but the player loses the lobby entrance, and the line names the wrong floor. It stays IMPORTANT, not CRITICAL, because the $2,000,000 charge itself is the designed outcome of an unanswered bomb.
- Fix spec:
  - At plant time, store the bomb's floor and x on the bomb event, as an optional field so the save format stays 5. Rank destruction by that position when the room is gone, and name that floor in the log.
  - Alternative: when endFire or destroyRoom removes the bomb room, end the bomb with its own line. The owner picks which.
  - Test: fire destroys the bomb room, and at 13:00 no lobby tile is removed and the line names floor 2. It fails today.
  - Must not change: detonation when the room stands, the damage cash, or the security search timing.

### S3. A VIP who never arrived is narrated as rating the tower - CONFIRMED (final: ADVISORY)
- Reproduction in the overlay: I added one assertion to vip-journey.test.ts "a suite demolished during the notice". It prints `S3 LINE: The VIP rated the tower poor.` and fails `not.toMatch(/rated the tower/)`. The path is failVisit (events.ts:485-499) into closeVisit (474-478), which writes vip.rated value 0, rendered by story.ts:459-460. The chronicle repeats it (chronicle.ts:181-183). This breaks the lane invariant "prose never invents" (LANES.md:51). The news log carries the true reason, and the poor stat is the rule, so it stays ADVISORY.
- Fix spec: the failVisit beat carries a marker (a distinct code such as vip.left, or a field) that towerLine renders as "The VIP left without staying.". The test above flips. Must not change: stats.vipRating 'poor' or lastVip.reason.

### S4. The chronicle's "tenants moved out" counts hotel guests who gave up - REFUTED
- Probe (verifyC/guest-giveup.ts): 19 floors of twins on one standard car for 6 days. Result: `guest give-up log lines 210`, `hotel room.vacated beats 55 with value>=1 0`, `story totals {"movedOut":0,...}`.
- Trace. giveUp runs only for a sim in state 'waiting' (people.ts:646-659), and a guest waits on only two trips:
  - Check-in: `inRoomId` is null, so departRoom's checkOutOfHotel (people.ts:617) never runs. The giving-up guest leaves with `exiting` set, and enterRoom (561) sends them out.
  - Checkout: leaveTower sets `exiting` and calls departRoom before any wait (440-441). checkOutOfHotel therefore runs with leaveReason null (reset at midnight, 297), and the `!sim.exiting` guard at 658 blocks a later give-up.
  - sendAway and evaluation's moveOut clear inRoomId or tenants first, so they never reach checkOutOfHotel either.

  The `leaveReason !== null ? 1 : 0` at people.ts:629 is dead in practice. Its removal could be logged as a cleanup, but it is not a defect.

## Owner questions checked against DECISIONS.md
- Clock back then forward gives a second try at a finished date. The trace holds: dailyOpening (daily.ts:183-189) returns 'ahead', then 'choose' or 'fresh', and the copy kept by keepDailyCopy (game.ts:1216) is never read again. The decision "one try per date" (2026-09-24) is settled, but it does not say whether it must hold against a player who changes the device clock. Leaderboards are held (2026-09-24), so no score leaves the device. **Real open question** (scope), not a defect.
- Guard catches by position, not a seeded draw. Not in DECISIONS. The code matches its own rule comment (rules.ts:263, `detectTiles: 12`), while LANES.md:52 says "by a seeded draw". The same line also says "Exactly one theft per tower", yet rollTheft repeats with a 3-day cooldown (events.ts:626-632). **Real open question**: which document is the rule. It is not a settled decision.
- Theft mess tidied about 1.6 days on average. Not in DECISIONS. rules.ts:264 says the mess lasts "for messDays" (1), and tidyAfterTheft (events.ts:816) needs a full 1440 minutes at a 06:00 roll. An escape between 10:00 and 20:00 is therefore tidied at the second 06:00, 34 to 44 hours later. This is a small **defect against its own rule comment** (ADVISORY level), unless the owner rules the "first roll after a full day" reading.

## Duplicates
- None named by the task.

## Notes
- New suspicion N1 (ADVISORY, logged only). LANES.md:52 "Exactly one theft per tower" disagrees with rollTheft, which rolls again after each 3-day cooldown (events.ts:626-632). Input: a 3-star tower run 10 days. Expected per LANES: at most one theft. Actual per code: repeated thefts. Settle which document is right; it belongs with the owner question above.
- S1 also has a recycling path. releaseDirty (recycling.ts:365-368) clears a guest-occupied hotel room's dirty flag and timer together, so a room that was infested while in backlog never clears either. The S1 fix in finishCleaning plus the housekeeping pick covers it once the guest leaves.
