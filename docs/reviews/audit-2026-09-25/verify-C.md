# Verification of lane C at 7b4e60f

Host arch: arm64. DECISIONS.md read in full. Lane probes re-run (roach.ts, control.ts, probe.ts); outputs match the report. My own scripts: scratchpad/verifyC/s1.ts, s3.ts, and a vitest file run in a throwaway overlay (overlay-C/tests/verifyC/daily-slot.test.ts, storage mocked as tests/game/slots.test.ts does). The overlay has been deleted.

## Verdicts

### S1. Cockroach spread timing is lost on save and load - CONFIRMED (final: CRITICAL)
- The field: `RoachSpreadState.lastSpread`, kept in the module WeakMap `roachSpread` (src/sim/events.ts:58-70). It is not in `SaveData` or `buildSaveData` (save.ts:84-165) and not in `hashWorld` (save.ts:675-693). So the hash is equal at the save while the state is not. `deserialize` builds a new World, the WeakMap misses, and `lastSpread` comes back as null. At the next 06:00 roll, events.ts:808 sets it to that minute and skips a spread that the straight run makes (spreadDays 2: the straight run spreads at 4680+2880=7560).
- Reproduction (s1.ts, seed 11, five hotel singles, first one dirty; save and load at 6181, then 5 days of lockstep ticks):
  - repo: `infested: infested at save 84, hash equal true` then `straight bce5bafc reloaded 9c62fab8 equal false firstDiffMinute 7561`.
  - control, saved at 3000 before any infestation: `hash equal true`, after 5 days `81a553e6 / 81a553e6 equal true firstDiffMinute -1`. Infestations appear later in both runs and stay equal.
  - overlay (only change: `export` on roachSpread): the loaded world has `lastSpread straight=4680 reloaded=null`. When I copy 4680 into the loaded world, the hashes stay equal for 5 days (`bce5bafc / bce5bafc`). That makes `lastSpread` the only cause.
- The lane's control.ts is not really a no-infestation control. Guests dirty the rooms and infestations appear (day+1 shows 84,86,88). It stays equal only because its timers line up. My control above replaces it.
- Severity: the same tower diverges between a straight run and a reload. That is CRITICAL by the rubric. Any hotel without housekeeping reaches this path.
- Fix spec: move `lastSpread` into world state that is saved. Load it back, with absent meaning null for v1 to v5 saves. Add it to the hash projection with null hashing as absent, so the bench hashes of towers without roaches do not move. Delete the WeakMap and fix the comment at events.ts:54-57. Test: the s1.ts scenario as a vitest. Save and load at 6181 and assert `hashWorld` is equal after 5 days of lockstep ticks. It fails now (first diff at 7561) and passes after the fix. Must not change: the spread cadence of a straight run, and the existing hashes.

### S2. A later-dated daily is thrown away when the local date goes backwards - CONFIRMED (final: CRITICAL)
- Trace: the page loads with `?daily=...`. main.ts:74 ignores the value, and main.ts:115 calls `openDaily()`. With `today()` = 2026-09-24: game.ts:924 does not return early. `enterSlot('daily')` runs, and `readWorld('daily')` returns the stored 2026-09-25 run. `dailyOpening({date:'2026-09-25',finished:false},'2026-09-24')` returns 'fresh' (daily.ts:167-168 only handles `<`). game.ts:929 then calls `beginToday('2026-09-24')` → `freshTower` → `saveWorld(true)` → `writeSlot('daily', ...)`.
- Lost, not hidden: storage.ts:62-82 is a single `put(text, KEY)` or `setItem` on the one daily key, with no backup. `stashUnreadable` only runs for saves that cannot be read. The same path is reached from the in-game "Today's tower" row (ui.ts:466). src/ui/daily.ts only renders cards and never offers a choice, because `dailyChoice` stays null.
- Reproduction (vitest, overlay): stored before `{"date":"2026-09-25","minute":1980,"finished":false,"cash":1995000}`, stored after `{"date":"2026-09-24","minute":360,...,"cash":2000000}`, choice null. Second case: a finished run for the 25th is overwritten on the 24th. Back on the 25th, the choice offers the 24th as "yesterday", and "Start today's" gives `{"date":"2026-09-25",...,"finished":false}`, a second full try at the 25th.
- Fix spec: `dailyOpening` must never return 'fresh' when the stored date is later than today. Options: resume or show it (read-only if finished), or offer the choice. `openDaily` must never write over a stored daily with a different date without asking the player. Tests: `dailyOpening({date:'2026-09-25',finished:false},'2026-09-24') !== 'fresh'`, plus the game-level test above (the slot bytes stay the same). Must not change: the same-date resume, the earlier-date choice, and the fresh start after a finished earlier date.

### S3. Demolishing the burning room leaves a fire nothing can burn out - CONFIRMED (final: IMPORTANT)
- Reproduction: probe.ts A. Demolish returns `{"ok":true}`. After 3 days the fire event is still there, `fireBurning` is true, and 0 rooms are on fire. s3.ts uses a real `startFire` at 06:00 (it landed on a lobby tile with occupancy 0), and demolish is allowed. build.ts:447-452 checks only occupancy and stranding. tickFire (events.ts:218-231) with no security only spreads, and it spreads from an empty list.
- Correction: the tower is not shut "for good" with less than $250,000. A security office is buildable at 2 stars (rules.ts:41, star 2, $100,000). With one built, s3.ts shows the fire ending: `Security put the fire out. 0 rooms burned down ... $0`. The real lockout needs cash under $100,000 (or 1 star, where security cannot be built).
- Fix spec: refuse demolishing a room that is on fire (with a plain reason, e.g. "The room is on fire."), or end the fire when its last room is gone. Test: demolish a burning room. Either it is refused, or the fire event is gone and `fireBurning` is false within one tick. Must not change: a fire with rooms still burning.

### S4. The bomb explodes in the oldest rooms when its room was demolished - CONFIRMED (final: IMPORTANT)
- Reproduction: probe.ts B. Output: `destroyed: lobby@1,90 lobby@1,91 lobby@1,92 lobby@1,93 | The bomb went off on floor 1. 4 rooms were destroyed and the repairs cost $2,000,000.` Cause: `distanceFrom(undefined, room)` returns `room.id` (events.ts:269-270), so the lowest ids go first. Those are the first lobby tiles. destroyRoom does no stranding check, which demolish would have made.
- Fix spec: refuse demolishing the bomb room while its threat is open, or have detonate end the threat with no damage when `bombRoom` is undefined. Test: demolish the bomb room and pass 13:00. No room outside the bomb's floor is destroyed, and the lobby is intact. Must not change: detonation around a room that still stands.

### S5. The VIP and the thief walk in during a fire - CONFIRMED (final: IMPORTANT)
- Reproduction: probe.ts C: `fireBurning true vip phase route vip state walking floor 1`. D: `thief walking floor 1 theft phase approach`. The code: tickVip notice (events.ts:479-490) only marks `incident`, and thiefWalksIn (events.ts:607-642) has no fire check. FIRE_HELD_KINDS (people.ts:76) leaves out vip and thief on purpose, per the comment at people.ts:72-75.
- Decision reading: DECISIONS.md line 79, "2026-09-24 | no arrivals enter the tower while a fire is burning". On its plain reading it covers both. The VIP arrives from the street through the lobby door ("walked into the lobby"), and the thief is created at the ground door and walks in. Nothing in DECISIONS exempts them. The people.ts comment is a code choice, not a settled decision. So the finding follows the decision and does not re-flag one.
- Fix spec: while `fireBurning`, the VIP stays in 'notice' (or 'outside') until the fire is out, still marked `incident`, and `enterAt` is held for the theft. The thief must still be called off by `approachMaxMinutes`. Tests: a fire at `arrivesAt` or `enterAt` means no VIP or thief inside until the fire ends. Must not change: a VIP who is already inside is still moved out by their own plan.

### S6. The chronicle states whole-tower tallies from a capped, thinned list - CONFIRMED (final: IMPORTANT)
- Reproduction: probe.ts G. One caught theft, one escaped theft, then 260 other beats. Output: `0 tenants moved out. | Thieves: 0 caught, 0 got away.`
- Code: chronicle.ts:175-189 filters `story.recent`. That list holds 256 beats (story.ts:49, 79-81), and unfollowed beats are spaced at 10 minutes per code (rules.ts:135). With four person codes, a busy tower refills 256 beats in about a day. `room.vacated` also counts hotel checkouts (people.ts:553, value 0), fire and bomb evictions (events.ts:131) and demolitions (build.ts:461). The chronicle is written once at 6 stars (stars.ts:78) and saved. The star lines already handle the cap ("before the record began"); the counts do not.
- Fix spec: keep running totals in `world.stats` or the story state (moved out with value ≥1 only, thefts caught and escaped, waste backlogs and clears), and have the chronicle read those. Test: with more than 256 later beats, the chronicle counts match the totals, and a hotel checkout does not count as a move-out. Must not change: the hash (story is not hashed; if the totals go in stats, give them the same absent-means-0 treatment as waste).

### S7. The trip.arrived line invents "out to the street" once its room is gone - CONFIRMED (final: ADVISORY)
- Reproduction: probe.ts E: `I made it to floor 2 in seven minutes today.` becomes `I made it out to the street in seven minutes today.` story.ts:323. This goes against the file's own contract at story.ts:401 ("A room that has since gone drops out of the line").
- Fix spec: with no room, drop the place ("I made it in seven minutes today."). Test: describeBeat on a trip.arrived beat after the room is deleted must not contain "street". This applies to all three voices.

### S8. One try per date does not hold against the saving menu - CONFIRMED (final: IMPORTANT)
- Menu in the daily slot (panels.ts:1352-1411): the Game group shows My tower and Stories. "Today's tower" is hidden (1355) and so is New game (1357). The Saving group always shows all four: Save now, Go back to last save, Save to a file, Open a saved file. The Menu button is always on the bar (ui.ts:276), including under the result card.
- Reproduction (vitest):
  - (a) Export at minute 960, run to the end (`finished true speed 0 minute 11880`), then import: `finished false`, `setSpeed(1)` is accepted, minute 960 → 1060, and a build works. The run is rewound after its end. This works because `setSpeed` is blocked only by `dailyOver()`, and importSave (game.ts:902-913) makes that false again.
  - (b) Finish the daily, open a My tower file while in the daily slot (`getDaily null`), then choose My tower. `enterSlot` saves the dirty world into the daily slot: `{"date":null,...}`. Today's tower then starts a fresh 2026-09-25 (`finished false, minute 360`).
  - "Go back to last save" also rewinds within a run, to the last 06:00 autosave.
- Fix spec: in the daily slot, refuse importSave (or accept only a file whose `dateOfMode` equals the slot's date and whose minute is not earlier than the one in hand), and hide or refuse "Go back to last save" and "Open a saved file" there. `openDaily` must treat a daily slot with no date as untrusted, not as 'fresh' for a date whose run was already played. Tests: (a) and (b) above must end with `getDaily().finished === true`. Must not change: export (sharing a file is fine), and import in My tower.

## Duplicates
- S3 is the same defect as lane A S1 (demolishing the burning room).
- S4 is the same defect as lane A S2 (demolishing the bomb room).
- S5 is the same defect as lane B S6 (the VIP and the thief enter during a fire). DECISIONS line 79 covers both on its plain reading.

## Notes
- New suspicion N1 (ADVISORY): demolishing a burning room and then building security clears the fire for free. File: events.ts:200-215. Input: s3.ts with security. Wrong outcome: `0 rooms burned down and clearing the damage cost $0`, where waiting would have cost $20,000 per room. The same fix as S3 closes it.
- Checked and dropped: `openDaily` called while already in the daily slot skips the save of the world in hand (game.ts:412). It is unreachable, because the menu hides Today's tower in the daily slot and main.ts calls openDaily only at boot on a fresh game.
