# Lane D: Save, storage, and the game shell at 7b4e60f

## Suspicions

### S1. Switching towers can write the old tower into the new slot, including over My tower (proposed: CRITICAL)
- Where: src/game/game.ts:410-416 (`slot = next` before the world is swapped), 965-975, 347-358 and 360-363 (the autosave reads `slot` and `world` when it runs, not when it was scheduled)
- Input: in Friend's tower at 1x, tap My tower. While the My tower read is still pending, a frame or timer step crosses 06:00.
- Wrong outcome: `slot` is already `mine` but `world` is still the friend's tower. The autosave writes the friend's tower into My tower. With the web storage path the read then returns it too, so My tower is gone from disk and from memory. The same window exists for openDaily and openFriend, and endDaily (game.ts:318-326) can fire in that window as well.
- Reproduce: `scratchpad/audit/probeD/race.ts` uses the real storage module on a fake localStorage. It saves My tower (seed 11, 1 room), runs `openFriend(4242)`, sets the minute to 06:00 minus 1, calls `openMyTower()` without awaiting it, then calls `stepOnce()`. Output: `My tower slot seed after: 4242 rooms: 0`, and the tower in hand has seed 4242.

### S2. Cockroach spread timing is not saved, so a reloaded tower plays out differently (proposed: CRITICAL)
- Where: src/sim/events.ts:61 (`roachSpread` WeakMap) and 773-806. save.ts cannot see it.
- Input: an infested hotel room next to a clean one. Save and reload between spread days.
- Wrong outcome: after the load, `lastSpread` is null and gets reset to the load day, so the spread comes up to 2 days late. `infested` is hashed and lowers eval (evaluation.ts:144) and guest rentals (people.ts:164). Every page load reloads the tower, so `verifySave` on a normal player's save reports a mismatch after any spread, even though the save file itself is sound.
- Reproduce: `probeD/roach.ts` has room 1 (infested) and room 2 (clean) side by side on floor 2. It ticks cockroaches on days 1 and 2, then round-trips the save. The hashes match right after the load. Day 3: the continuous run has `room2.infested=true` and the loaded run has `false`, so `hashEqual=false`. The runs match again on day 5.

### S3. When an IndexedDB write fails, the save goes to localStorage, but the next read still returns the older IndexedDB save (proposed: CRITICAL)
- Where: src/game/storage.ts:62-84 (write) and 86-106 (read). The read tries IndexedDB first and returns any text it finds.
- Input: the tower saved to IndexedDB earlier. A later IndexedDB write fails and the save falls back to localStorage.
- Wrong outcome: `writeSave` resolves as a success. On the next boot, `readSave` returns the older IndexedDB save and quietly rolls the tower back. A related case: an IndexedDB read error followed by an empty localStorage looks the same as "no save" (game.ts:882). Boot then starts a fresh My tower, and its first autosave overwrites the real save once IndexedDB recovers.
- Reproduce: `probeD/idb.ts` uses a fake IDBFactory. It writes at "minute 1000" with IndexedDB working, then at "minute 5000" with the write failing. localStorage holds 5000, but `readSave returns: save at minute 1000`.

### S4. An aborted IndexedDB write never settles, which stops all later saves and can freeze tower switching (proposed: IMPORTANT)
- Where: src/game/storage.ts:66-71. Only `oncomplete` and `onerror` are handled, not `onabort`. A disk-quota failure at commit arrives only as `abort`.
- Wrong outcome: the `writeSave` promise stays pending forever. `autosaveInFlight` (game.ts:350-356) never clears, so nothing autosaves for the rest of the session. "Save now" never answers. `enterSlot` (game.ts:413) awaits forever, so tapping Today's tower or My tower does nothing.
- Reproduce: `probeD/idb.ts` with `mode='abortWrite'` prints `writeSave on a transaction abort: STILL PENDING after 2 s`.

### S5. A save with the right outer shape but a bad inside loads, then crashes or hangs the loop (proposed: CRITICAL)
- Where: src/sim/save.ts:226 (stats is only checked to be an object), 270-300 (room `tenants` is never checked), 302-312 (shaft `width` and `homeFloor` are never checked), 358-370 (sim `route`, `schedule`, `guard` and `collector` are never checked), 506 (events are never checked).
- Input, one change to a real save (`probeD/base.json`, 390 sims) at a time: delete `shafts[0].width`; set `stats` to `{}`; delete `sims[0].schedule`; delete `sims[0].route`; delete a room's `tenants`.
- Wrong outcome: `deserialize` returns ok each time. With `width` missing, `tickPeople` never returns and the page freezes. The other four throw inside `tick` every frame, re-running half a tick each time with the clock stuck. This is reachable through "Open a saved file", and a Save or slot switch then stores it in the slot, so it also breaks every reload. Separately, a room with height 1e9 stalls for 2.7 s and is then refused with the wrong reason ("not a Hundred Stories save").
- Reproduce: `MUT=<name> vite-node probeD/one.ts`. For `shaftWidth`, `probeD/sw.ts` shows it stops after printing "people" and hits the 20 s kill. The fuzz run printed `LOADS+THROWS` for the other four.

### S6. Opening a saved file while in Today's tower freezes it and loses today's daily (proposed: IMPORTANT)
- Where: game.ts:902-913. The import keeps `slot`, and panels.ts:1393-1396 and 1665 offer "Open a saved file" in every slot. game.ts:292 and 314-316 then apply the daily rules to it.
- Input: in Today's tower, open a My tower file that is 20 game days old.
- Wrong outcome: the notice says "Tower opened." but the clock never moves. Every build is refused with "Today's tower is over. Come back tomorrow for a new one." `getDaily()` returns null. Leaving for My tower saves the imported tower into the daily slot, so today's daily is lost and the file's tower is stuck in the wrong slot.
- Reproduce: `probeD/importdaily.ts` prints `clock moved: false | build: {"ok":false,"reason":"Today's tower is over..."}`, and then `daily slot after leaving: seed 11 mode undefined`.

### S7. Failed slot writes say nothing, and a tower switch drops the unsaved tower (proposed: IMPORTANT)
- Where: game.ts:354 (autosave failures are silent) and 413 (`enterSlot` ignores what `saveWorld` returns).
- Input: storage refuses writes (quota full, or a private window). Play, then tap Today's tower.
- Wrong outcome: the player is never told their tower is not being saved. The switch goes ahead and drops the unsaved My tower. This breaks the lane rule that a failed slot write shows one plain message.
- Reproduce: code trace only, not run. Sketch: in game.test.ts's harness, set `slot.refuse = true`, tick, then call `openDaily()`. `saveWorld` returns `{ok:false}` and `enterSlot` drops it, so no reason reaches the player, and `swapWorld` replaces the unsaved My tower.

### S8. Nothing saves while the game is paused or when the page closes (proposed: IMPORTANT)
- Where: game.ts:288 (`speed === 0` returns before `maybeAutosave`). There is no pagehide, beforeunload or hidden-tab save anywhere in src (grep).
- Input: pause, build ten rooms, close the tab.
- Wrong outcome: every build is lost, although Settings says "Your tower saves by itself." Even while unpaused, up to one game day (about 107 s at 1x) is lost on close.
- Reproduce: code trace. `apply` sets `dirty` (game.ts:755), but only `advance` calls `maybeAutosave`, and `advance` returns 0 while paused.

### S9. "We kept a copy of it" is a claim the player cannot use (proposed: ADVISORY)
- Where: game.ts:885-889 and storage.ts:465-478.
- Wrong outcome: the stash write is not checked (a 3 MB save can go over the localStorage quota). No code reads `hs.save.unreadable` back. The next autosave (about 107 s later) overwrites the only good copy in the slot.

### S10. The rentDay event fires at midnight, but rent is settled at 05:00 (proposed: ADVISORY)
- Where: src/game/events.ts:96-98 compared with tick.ts (`onQuarterStart` runs at `quarterStartMinuteOfDay`).

### S11. Two desktop saves of the same slot at once share one .tmp file (proposed: ADVISORY)
- Where: storage.ts:270-271. An autosave and a "Save now" running together: the second rename fails with "This device would not let the game save." even though the data was written. Also, every web read and write opens a new IndexedDB connection that is never closed (storage.ts:49-56).

## Questions for the owner
- A daily share link carries `?daily=DATE`, but `bootTarget` ignores the date (main.ts:74). A friend opening it on a later day gets that day's tower, with a different start and twist from the one "Can you beat it?" refers to. Is that intended?
- The autosave is silent by design (game.ts:351). Should a failed autosave still tell the player once?
- `dailyOpening` treats a saved daily dated after today (for example after the clock or time zone changes) as `fresh` and overwrites it.

## What the tests do not prove
- tests/sim/save.test.ts: the round trip compares hashes of the world only. State kept outside the world (the S2 WeakMap) cannot fail it, and no test compares a loaded tower that keeps ticking against one that never reloaded. Deep validation tests nothing about tenants, route, schedule, stats, events, shaft width, homeFloor, guard or collector. No v1 file here (tests/sim/cars.test.ts has one).
- tests/game/slots.test.ts: the mocked storage is synchronous. No tick or idle autosave lands during a switch, no import happens outside My tower, and no write fails during a switch.
- tests/game/storage.test.ts: the only IndexedDB fake is one whose open always fails. Nothing covers a failed write after a good one, a transaction abort, or read order.
- tests/game/loop.test.ts: no test of saving while paused. The tests show a stuck idle callback blocks later saves but not what clears it.
- tests/game/game.test.ts: `stashUnreadable` is mocked, so nothing shows the copy can be read back.
- tests/game/boot.test.ts: storage always returns null. Nothing tells a read error apart from an empty slot.

## Coverage
- Read in full: src/sim/save.ts, src/game/storage.ts, src/game/game.ts, src/game/api.ts, src/game/events.ts, src/main.ts, src/sim/types.ts, src/game/daily.ts, src/sim/buildlog.ts, src/sim/replay.ts, DECISIONS.md, DESIGN.md, tests/sim/save.test.ts, and every tests/game file except pointer.test.ts. Also read the relevant parts of story.ts (sanitize), events.ts (cockroaches), people.ts (story state), world.ts and ui/panels.ts (settings).
- Skipped: tests/game/pointer.test.ts was only skimmed (test names and harness). It covers placement input, not this lane's rules.
- Probes run: `npx vitest run tests/sim/save.test.ts tests/game`: 16 files, 198 passed. Also roach.ts (divergence confirmed), race.ts (My tower overwritten), idb.ts (stale read, pending abort), one.ts, sw.ts and fuzz (5 bad saves load then crash or hang, 1 slow refusal), importdaily.ts (frozen import), and old.ts (v1 to v5 variants of a real save all load and tick 1500 minutes).
