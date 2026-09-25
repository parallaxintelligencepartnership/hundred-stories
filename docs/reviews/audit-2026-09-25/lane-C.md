# Lane C: Events, story, security, recycling, weather, daily at 7b4e60f

## Suspicions

### S1. Cockroach spread timing is lost on save and load, so a reloaded tower diverges (proposed: CRITICAL)
- Where: src/sim/events.ts:58-70 (`roachSpread` WeakMap), 803-810
- Input: a hotel tower where a room is infested (any dirty single left 3 days). Save and load between the infestation roll and the next spread roll.
- Wrong outcome: `lastSpread` lives in a WeakMap keyed by the world object. It is not saved, so the loaded world starts it at null. At the next 06:00 roll it sets `lastSpread = now` and skips the spread that the running game does. The rooms' `infested` flags differ (EVAL.infestedPenalty is 1, so evaluation, tenants and cash follow), and the hash never matches again. The comment calls this "cosmetic pacing", but it decides which rooms get infested. A replay of the build log would also drift from a live game that was reloaded.
- Reproduce: `npx vite-node@6.0.0 <scratchpad>/audit/probeC/roach.ts`. Seed 11, five singles on floor 2, the first set dirty. First infestation at minute 4681, saved and loaded at 6181, hashes equal at the save. One day later the continuous run has 84,85,86,87,88 infested, the reloaded run has 84,85,87, and `hashWorld` differs from then on. Control (`control.ts`, same tower with no infestation at the save): hashes stay equal for all 4 days.

### S2. A later-dated daily is thrown away when the local date goes backwards (proposed: CRITICAL)
- Where: src/game/daily.ts:164-169. Caller: src/game/game.ts:922-933
- Input: the daily slot holds an unfinished `daily:2026-09-25` and `today()` returns `2026-09-24`. This happens if the device clock is set back, or if the player starts after midnight and then crosses time zones westward (00:30 Sep 25 in New York is 21:30 Sep 24 in Los Angeles).
- Wrong outcome: `dailyOpening` handles only `saved.date < today` and returns 'fresh' when the saved date is later. `openDaily` then calls `beginToday`, which writes a new tower over the unfinished one without asking. If the later-dated one was already finished, the player also gets a second try at a date whose run the single slot already overwrote. The same date should never be played twice, and a player's tower should never be dropped without a choice.
- Reproduce: `dailyOpening({date:'2026-09-25',finished:false},'2026-09-24')` returns `fresh` (probe.ts line F). Trace: game.ts:929 then `beginToday` then `saveWorld(true)`.

### S3. Demolishing the burning room leaves a fire that nothing can burn out, and the tower stays shut (proposed: IMPORTANT)
- Where: src/sim/events.ts:218-231, src/sim/build.ts:447-452 (demolish checks only occupancy), src/sim/people.ts:79
- Input: 2 stars (fire minStar) with no security office, which is not needed until 3 stars. A fire starts in an office. The workers leave it, so its occupancy drops to 0, and the player demolishes it.
- Wrong outcome: the fire event stays in place with only a removed room id. Nothing is on fire, nothing spreads, and without security it never ends, yet `fireBurning` holds every arrival outside. The only ways out are paying $250,000 for a helicopter on an invisible fire or building a security office. With less cash than that, the tower is shut for good.
- Reproduce: probe.ts block A. Demolish returns ok. After 3 days: fire event present, `fireBurning` true, 0 rooms on fire, 0 workers inside.

### S4. The bomb explodes in the oldest rooms (ground lobby) when its room was demolished (proposed: IMPORTANT)
- Where: src/sim/events.ts:256-272 (`distanceFrom` returns `room.id` when the bomb room is gone)
- Input: a bomb threat on an office with no security office. Empty it, demolish it before 13:00, and let 13:00 pass.
- Wrong outcome: the four lowest-id rooms are destroyed, which are the first ground lobby tiles, and the log says "The bomb went off on floor 1." A room that no longer exists wrecks the lobby entrance. Either the bomb should go with its room, or demolishing it should be refused.
- Reproduce: probe.ts block B. Destroyed: lobby@1,90, lobby@1,91, lobby@1,92, lobby@1,93.

### S5. The VIP and the thief walk into the tower during a fire (proposed: IMPORTANT)
- Where: src/sim/events.ts:479-490 (the VIP arrival checks only `incidentActive` for the rating), 719-723 (`thiefWalksIn`), src/sim/people.ts:73-76 (FIRE_HELD_KINDS leaves out vip and thief)
- Input: a fire is burning at the VIP's `arrivesAt`, or at a theft's `enterAt`.
- Wrong outcome: the VIP is routed in from the lobby (phase route, walking on floor 1), and the thief is created and walks to the shop. This breaks the lane invariant and the 2026-09-24 ruling that no arrivals enter during a fire. The people.ts comment makes the exemption on purpose, but only for leaving a burning room.
- Reproduce: probe.ts blocks C and D. C: `fireBurning` true, VIP phase `route`, state walking. D: thief walking, theft phase `approach`.

### S6. The chronicle states whole-tower tallies from a capped, thinned list (proposed: IMPORTANT)
- Where: src/sim/chronicle.ts:175-189
- Input: any tower that reaches Tower status. `story.recent` keeps 256 beats, and unfollowed beats are thinned to one per 10 minutes per code. A busy tower cycles 256 beats in hours.
- Wrong outcome: the lines "N tenants moved out.", "Thieves: N caught, N got away." and "Times waste piled up" count whatever beats are still in the list, not what happened. Older thefts drop out and the line says 0. `room.vacated` also counts hotel checkouts (value 0, people.ts:553) as tenants moving out. The chronicle is written once and saved, so the wrong figures are permanent. The file's own contract is that "no line says anything the record does not".
- Reproduce: probe.ts block G. One caught and one escaped theft, then 260 other beats: "0 tenants moved out. | Thieves: 0 caught, 0 got away."

### S7. The trip.arrived line invents a trip "out to the street" once its room is gone (proposed: ADVISORY)
- Where: src/sim/story.ts:322-326
- Input: a followed worker's trip.arrived beat for their office, and the office is later demolished or burned.
- Wrong outcome: `dest = room ? … : 'out to the street'` turns a missing room into a street trip. "I made it to floor 2 in seven minutes today." becomes "I made it out to the street in seven minutes today." The line should drop the place, as the wait.long line does.
- Reproduce: probe.ts block E.

### S8. One try per date does not hold against the saving menu in the daily slot (proposed: IMPORTANT)
- Where: src/ui/panels.ts:1372-1411 (Save now, Go back to last save and Open a saved file are shown in every slot), src/game/game.ts:899-912, 922-933
- Input: (a) In Today's tower, choose Save to a file, play on, then Open a saved file with that file, which rewinds the run. The same works after the result card, because speed was 0 only because of `dailyOver`. (b) Open a My tower file while in the daily slot: autosave writes it into the daily slot, `dateOfMode` is then null, and the next Today's tower gives `dailyOpening(null)` = 'fresh', a second full try at today.
- Wrong outcome: the lane invariant says one try per date holds across reload.
- Reproduce: trace (a) importSave then dailyFinished false then advance runs. Trace (b) game.ts:926-931 with savedDate null gives beginToday. A browser pass would confirm.

## Questions for the owner
- The lane invariant says a guard catches or misses the thief "by a seeded draw". The code decides by position (same floor, within 12 tiles) and never draws. It is deterministic. Is position meant to replace the draw?
- The theft mess is tidied at the first 06:00 roll at least 1440 minutes later, so it lasts about 1.6 days on average, not 1 day.
- A friend seed above 2^32 hashes the same as its low 32 bits in weather, identity and rng (`seed|0`, `>>>0`). The address parsing is lane D's.

## What the tests do not prove
- tests/game/daily.test.ts: never passes a saved date later than today; no game-level test of one try across import, load or a clock change.
- tests/sim/events.test.ts: the cockroach save test checks only `dirtySinceMinute`, never spread timing or the hash across a reload; no test demolishes a burning or bomb room; no test holds the VIP or thief during a fire.
- tests/sim/story-beats.test.ts: ALL_CODES leaves out the theft, guard and waste codes; no test renders a beat whose room is gone.
- tests/game/weather.test.ts: pure-function checks only. Nothing asserts the hash ignores weather (it holds by construction, since no world is passed).
- Chronicle tallies: no test checks them against events older than the 256 cap.
- tests/scenarios/recycling.test.ts: no test where a theft mess overlaps a waste backlog on one room (traced by hand; the ordering in events.ts:886-888 looks right).

## Coverage
- Read in full: src/sim/events.ts, story.ts, chronicle.ts, identity.ts, security.ts, recycling.ts, src/game/weather.ts, src/game/daily.ts; reference src/sim/types.ts, rules.ts, tick.ts; DECISIONS.md, DESIGN.md, LANES.md Lane C; tests/game/daily.test.ts, tests/game/weather.test.ts, tests/sim/events.test.ts, story.test.ts, story-beats.test.ts, identity.test.ts. Plus the relevant parts of game.ts (daily and slot paths), people.ts (fire hold, thief and VIP send, leaving, beats), build.ts (demolish), panels.ts (settings).
- Skipped or partial: tests/scenarios/security.test.ts, recycling.test.ts, vip-journey.test.ts and story-worker.test.ts were read by test names and fixtures, not line by line, for time. The recipe run shows they pass.
- Probes run: the recipe (10 files, 110 tests pass); probeC/probe.ts (blocks A to G, results above); probeC/roach.ts (reload divergence, hashes differ from day+1); probeC/control.ts (no divergence without infestation). Timezone and DST: `dailyStart` and `dailyTwist` read only the date string, so they are the same in every time zone. `localDateKey` on DST days (2026-03-08 02:30, 2026-11-01 01:30) returns the right date. Midnight during a run keeps the run's own date (from the build log mode), which is correct.
