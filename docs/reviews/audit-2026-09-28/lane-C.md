# Lane C: Events, story, security, recycling, weather, daily at 0f05723

## Suspicions

### S1. Cockroaches never leave: housekeeping's clean wipes the signal the roll needs, and a room that caught them while clean can never get dirty again (proposed: CRITICAL)
- Where: src/sim/events.ts:835-844 (clears `infested` only when `!dirty && dirtySinceMinute != null`); src/sim/people.ts:937-940 (`finishCleaning` sets `dirty = false` AND `dirtySinceMinute = null`); src/sim/people.ts:184 (an infested room is never booked, so it never gets dirty again); also src/sim/recycling.ts:367-368 (releaseDirty nulls it too).
- Input: any hotel with a housekeeping office where one room sat dirty for 3 days. The first room is infested. Housekeeping cleans it the same day. Neighbors catch roaches by spread every 2 days.
- Wrong outcome: housekeeping has already nulled `dirtySinceMinute`, so at the next 06:00 roll `wasDirty` is false and the infestation stays. A clean room that caught them by spread is never booked (people.ts:184), so it never becomes dirty and never clears. The whole row ends up infested for good: eval takes `infestedPenalty` 1, no guest books, the hotel income stops, and an infested suite can never host a VIP (`freeSuite` excludes it), which blocks the 4-star VIP requirement. The only way out is demolition. The events.ts:836-837 comment ("Housekeeping cleaning a dirty room takes the cockroaches with it") is false in play. This has been latent since c87699a (2026-09-19).
- Reproduce: `cd <checkout> && npx vite-node@6.0.0 ../audit-2026-09-28/probeC/roach.ts`. This is the first-tower hotel (lobby 150-243, a shaft at x 160, housekeeping on floor 2, four singles). At day 1 05:59 the first single is made dirty and infested. Output: `first room cleaned by housekeeping at minutes [2063]`, then per day `98:cI0` from day 2 to day 8, spread to 99, 100 and 101 by day 7 (`cI0` each), `roach gone lines 0`. The unit test events.test.ts:760 passes only because it sets `room.dirty = false` by hand and leaves `dirtySinceMinute` set. The real cleaning path clears both.

### S2. A bomb whose room burned down goes off in the ground lobby (proposed: IMPORTANT)
- Where: src/sim/events.ts:309-325 (`distanceFrom(undefined, room)` returns `room.id`, so the lowest ids go first, and the log says floor 1); the fire path destroys the room at events.ts:245-248. The 2026-09-25 fix (build.ts:522-528) only refuses a demolish.
- Input: 3 stars, no security on duty. That happens when the office was demolished after the star, because stars fall by population only (stars.ts:70-72), or when the only security office is the room that is burning. At the 06:00 roll a fire lights an office and a bomb lands in the office next door (the bomb only skips rooms already burning). At 06:30 the fire spreads to the bomb room. It burns out at 09:00, or the player calls the helicopter. Either way `endFire` destroys the bomb room. At 13:00 the bomb detonates with `bombRoom` undefined.
- Wrong outcome: the four lowest-id rooms are destroyed, which are the first ground lobby tiles, and the log says "The bomb went off on floor 1." The loss is $2,000,000 plus the lobby entrance. The bomb should have gone with its room, or blown up where it was.
- Reproduce: `npx vite-node@6.0.0 ../audit-2026-09-28/probeC/bombfire.ts` (the events are injected directly, because the hooks are off outside vitest). Both variants print `lobby tiles left 36 missing x [90, 91, 92, 93]`, `far office exists true`, and the line "The bomb went off on floor 1. 4 rooms were destroyed...". The helicopter variant shows the player's own action triggers it.

### S3. A VIP who never arrived is narrated as having rated the tower (proposed: ADVISORY)
- Where: src/sim/events.ts:485-499 into `closeVisit` (events.ts:474-478), which writes `vip.rated` value 0; story.ts:459-460.
- Input: the suite is demolished during the notice, or no route reaches it (vip-journey.test.ts:207-231 asserts this beat).
- Wrong outcome: Stories, the recap and the chronicle show "The VIP rated the tower poor." for a visit that never happened. This goes against "prose never invents". The stat counting it as poor is a rule; the sentence is not.
- Reproduce: run vip-journey.test.ts "a suite demolished during the notice", then `describeBeat(world.story.recent.find(b => b.code === 'vip.rated'), world)`.

### S4. The chronicle's "tenants moved out" counts hotel guests who gave up on an elevator, and thins them (proposed: ADVISORY)
- Where: src/sim/people.ts:626-630 (a checkout carries `value: leaveReason !== null ? 1 : 0` and goes through the thinned `recordSimBeat`); story.ts:64-70 and 111-113; chronicle.ts:177.
- Input: a guest gives up waiting (people.ts:745/752 sets `leaveReason`), then checks out.
- Wrong outcome: the StoryTotals contract says a hotel checkout is never a move-out. Here it counts as a tenant moving out, and it is spaced at 10 minutes per code, so the total is neither the tenants nor the guests. The line reads "I moved out of the single room..." for a hotel guest.
- Reproduce: trace people.ts:745 then departRoom (people.ts:617-619) then checkOutOfHotel with value 1 then countBeat, which adds to `movedOut`.

## Questions for the owner
- A device clock moved back then forward still gives a second try at a finished date. Finish the 25th, set the clock to the 24th: 'ahead'. "Start today's" keeps a copy of the 25th and begins the 24th. Back on the 25th the slot holds the 24th: 'choose', then "Start today's" gives a fresh 25th (game.ts:1189-1224; the kept copy is never consulted). Is a clock-changer out of scope for one try per date?
- Guard catches are still by position within 12 tiles, never a seeded draw (asked on 2026-09-25, unchanged). Is position the rule?
- The theft mess is tidied at the first 06:00 at least 1440 minutes on, about 1.6 days on average (asked before, unchanged).

## What the tests do not prove
- tests/sim/events.test.ts: the cockroach clear test sets `dirty = false` by hand. No test runs housekeeping's real clean, or a clean room infested by spread, through to clearance. No test has a fire destroy a bomb room.
- tests/game/daily.test.ts: `dailyOpening` has no 'ahead' case (it lives in shell-audit.test.ts). There is no test of the clock back then forward.
- tests/sim/story-beats.test.ts: ALL_CODES still leaves out theft.*, guard.dispatched and waste.*. No chronicle totals test with guest give-up checkouts.
- tests/game/weather.test.ts: pure checks only. Weather stays out of the hash by construction (grep finds no weather import in src/sim).
- tests/scenarios/recycling.test.ts: no hotel room in backlog that is also infested. No theft mess overlapping a backlog.

## Coverage
- Read in full: src/sim/events.ts, story.ts, chronicle.ts, identity.ts, security.ts, recycling.ts; src/game/weather.ts, daily.ts. Tests read in full: tests/sim/events.test.ts, story.test.ts, story-beats.test.ts, identity.test.ts, tests/scenarios/security.test.ts, recycling.test.ts, vip-journey.test.ts, story-worker.test.ts, tests/game/weather.test.ts, daily.test.ts. Context read in part: rules.ts (EVENTS, THEFT, WASTE, SECURITY, STARS), stars.ts recompute, people.ts (fire hold, hotel booking and checkout, housekeeping, thief and VIP send, leaving), build.ts demolish refusals, economy.ts debitLoss, world.ts removeSim, game.ts daily, import and load paths, panels.ts saving menu, main.ts boot. Also DECISIONS.md, MAP gotchas, LANES lane C, and the 2026-09-25 lane and verify C reports plus the 2026-09-28 economy review.
- Checked and holding: the 2026-09-25 fixes. Roach spread timer saved as world.roachLastSpread. Later-dated daily gives 'ahead' with a kept copy. Demolishing a burning or bomb room is refused. VIP and thief held outside during a fire. Chronicle reads running totals. Trip line without the street. Import in the daily slot goes to My tower, and the rewind rows are hidden there. The fire rules from the economy review hold: no structure burn or spread, 45 min fixed, 3 h burn-out, bill capped at build cost, every loss through debitLoss.
- Skipped: none.
- Probes run:
  - The recipe (10 files): 134 tests passed.
  - probeC/roach.ts: the infestation never clears and spreads to all 4 rooms.
  - probeC/bombfire.ts: lobby tiles 90-93 destroyed in both variants.
  - Host `uname -m`: arm64.
