# Verification of lane D at 7b4e60f

Host: arm64 (uname -m), HEAD 7b4e60f. I read DECISIONS.md in full. None of its lines settles anything in this lane. The "autosave is silent" rule is a code comment (game.ts:351), not a decision. I read game.ts and storage.ts in full, and read the relevant parts of save.ts, replay.ts, main.ts, events.ts, panels.ts and the lane D section of LANES.md. I re-ran the lane's probes (race, idb, importdaily, roach, one, sw) and they reproduce. My own scripts are in scratchpad/audit/verifyD/: race2.ts, s2verify.ts, s2b.ts, storage-verify.test.ts, s5.ts, s7.ts, s8.ts, s11.ts and n1.ts. I made no overlay, and the repo is unchanged.

## Verdicts

### S1. Switching towers can write the old tower into the new slot - PARTIAL (final: CRITICAL)
- What holds: `enterSlot` sets `slot = next` (game.ts:414) before `readWorld` finishes (967). `maybeAutosave` and `saveWorld` read `slot` and `world` when they run, not when the save was scheduled (352-363). So any autosave that runs between those two points writes the old world into the new slot.
- What does not hold, "gone from memory too": race.ts gets that result only because it calls `stepOnce()` synchronously between `openMyTower()` and its first microtask continuation. A browser cannot do that, because a tick is always its own task (a frame or the interval).
  - localStorage path: the read (storage.ts:101-102) and the swap all run in microtasks after `await enterSlot`, so no task can land in the window. It is safe.
  - IndexedDB path: the read's `open()` is requested in the microtask right after the tap, so its read transaction exists before any autosave write transaction. IndexedDB runs overlapping transactions in creation order.
- Which awaits open the window: `await enterSlot(...)` sets the slot and yields. Then `await readFrom(...)`, which is `await openDb` plus `await` on the get (storage.ts:89-95). On IndexedDB that takes one or more tasks, so a frame (and, on Safari, the `setTimeout(0)` idle save) can run inside it.
- race2.ts reproduces this with browser-like ordering: a fake IndexedDB that settles in later tasks and keeps transactions in creation order, the game's own `scheduleIdle` (the setTimeout fallback), and the frame as a separate task:
  `IDB get autosave -> seed 11` / `IDB put autosave seed 4242` / `memory: slot mine world seed 11` / `disk My tower (autosave key): seed 4242`.
  - So on disk, the file under My tower's key (`autosave`) holds the friend's tower. In memory the player still has the correct tower.
  - Disk heals at the next My tower save: the next 06:00 or quarter crossing (up to about 107 s at 1x), or leaving the slot while dirty.
  - A close or reload before that (and S8 means nothing saves on close or while paused) boots the friend's tower as My tower, and My tower is lost.
  - The `idlePendingAtTap` ordering is safe. The friend slot is dirty, so `enterSlot` awaits its save while `slot` is still `friend`.
  - The same window opens for openDaily (a young My tower ticks under the daily clamp and can autosave into `daily`) and when leaving daily (the daily world ticks unclamped in `mine`).
- Severity: CRITICAL. The brief counts losing a tower "regardless of how rare the trigger looks", and this is rare: the tick has to land inside a read of a few ms and cross a boundary.
- Fix spec: do not assign `slot` until the new world is in hand. Read the target first, then set `slot` and call `swapWorld` in one synchronous step. Hold `advance` and cancel any pending autosave while a switch is in flight. Have `saveWorld` take `(slot, world)` as arguments, captured at scheduling time.
  - Test: the race2.ts scenario as a vitest (fake ordered IndexedDB, a frame during the read). Assert that the `autosave` key still holds seed 11. It fails now and passes after the fix.
  - Must not change: the dirty save of the slot being left, and "a slot nobody played in is never rewritten".

### S2. Cockroach spread timing is not saved - CONFIRMED (final: CRITICAL), duplicate of lane C S1
- roach.ts reproduces: `day 3: continuous room2.infested=true loaded room2.infested=false hashEqual=false`, and equal again on day 5. This is the same defect as lane C S1, which another verifier already CONFIRMED CRITICAL. The fix spec is theirs.
- The verifySave claim holds for scripts/replay.ts only. s2b.ts built a real logged tower (cash start, offices, 132 hotel singles, no housekeeping) and ran 30 days twice:
  - A, never reloaded: `verifySave: match`.
  - B, reloaded at 03:00 every day the way a page load does: `verifySave: mismatch 11700 lastMatch 10260`.
  - With 22 hotel rooms (s2verify.ts) both runs match, because every room infests itself and the spread never decides anything.
- In game: nothing in src calls `verifySave` (grep finds only replay.ts itself and scripts/replay.ts), so no player sees a mismatch. The false mismatch appears only when the save is checked with scripts/replay.ts.

### S3. A failed IndexedDB write falls back to localStorage, but the read returns the older IndexedDB copy - CONFIRMED (final: CRITICAL)
- Reproduction: verifyD/storage-verify.test.ts uses the stubs the way tests/game/storage.test.ts does. It fails on the current code:
  `IndexedDB holds: {"minute":1000} | localStorage holds: {"minute":5000}` / `readSave returns: {"minute":1000}`.
- `writeSave` resolved as a success. The fall-back is at storage.ts:73-79, and the read prefers IndexedDB at 96.
- A real trigger is any failure that reaches reject: `db.transaction()` throwing (Safari's lost IndexedDB connection), a request error, or `open` failing. After that, the next read in a session where IndexedDB works again rolls the tower back silently.
- The related "read error plus empty localStorage becomes a fresh tower that overwrites" case holds only if IndexedDB recovers inside that same session before the first autosave. This is traced from the code (storage.ts:97-104, then main.ts:119, then the autosave), not run.
- Fix spec: after a fallback write, make the newest copy win. Either delete the IndexedDB key once the fallback succeeds, or stamp both copies and read the newer one.
  - Test: the S3 case in storage-verify.test.ts (expects 5000).
  - Must not change: the private-window path (IndexedDB open fails, localStorage only) and the single refusal message.

### S4. An aborted IndexedDB write never settles - CONFIRMED (final: IMPORTANT)
- Reproduction: storage-verify.test.ts, S4 case: `writeSave on abort: PENDING after 500 ms`. The lane's idb.ts prints `STILL PENDING after 2 s`.
- There is no `onabort` handler (storage.ts:66-71). Knock-on effects, from the code: the `.finally` at game.ts:354 never runs, so `autosaveInFlight` stays true for the session. `enterSlot` (413), `beginToday` (436) and `openFriend`/`openMyTower` (960/971) await forever while the tower is dirty.
- Whether a given browser reports a quota failure at commit as abort only, with no error event, needs a browser: fill the quota in Chrome and Safari and log `tx.onerror` and `tx.onabort`. The code defect stands either way, because any abort that comes without an error event hangs the write.
- Fix spec: `tx.onabort = () => reject(tx.error ?? new Error('aborted'))`, and fall back as the error path does.
  - Test: the S4 case in storage-verify.test.ts.
  - Must not change: a successful write resolves exactly once.

### S5. A save with the right outer shape but bad insides loads, then hangs or throws - CONFIRMED (final: CRITICAL)
- Reproduction: verifyD/s5.ts on probeD/base.json (390 sims), run with a hard `timeout -s KILL 30`:
  - `shaftWidth`: `deserialize ok=true`, then no tick ever finishes. It was killed at 30 s. sw.ts prints `people` and never `elevators`, so the hang is in tickPeople. The likely cause, from the code: `withinReach` at people.ts:473 compares against NaN.
  - `statsIncomeByKind` (one stats field deleted) and `statsEmpty`: both load, then throw at minute 4620 (the quarter start), `Cannot read properties of undefined (reading 'office')`, at economy.ts:10 from 35.
  - `tenants`: throws at minute 2010 (evaluation.ts:93).
  - `schedule`: throws at minute 2018 (people.ts:261).
  - `route`: throws at minute 1980 (people.ts:597).
  - `roomHeightBig`: refused after 1922 ms with "This file is not a Hundred Stories save.", which is the wrong reason. The expected refusal is "damaged (rooms[n].height)".
- What deserialize validates today (save.ts:211-360): the top-level types. For rooms: id, kind, floor, x, width, height, eval, rent and the waste fields. For shafts: id, kind, floorMin, floorMax, x, stops, and for cars: id, y, state, serves, range, plus the hallCalls. For sims: id, kind, state, stress and pos.
- What it would also need:
  - `shaft.width` (equal to `SHAFTS[kind].width`) and `homeFloor`.
  - Upper bounds on room width and height: the room has to fit in the lot and the floor range.
  - `room.tenants` as an array of integers.
  - For sims: `route` and `schedule` as arrays of valid legs and entries, and `guard`/`collector` when present.
  - Every `stats` key with its type.
  - Every event by kind.
- Reachable through "Open a saved file" with an edited or foreign file. In the throwing cases the ui still works, so Save now or a slot switch (the tower is dirty after an import, game.ts:906) stores the file in the slot. In the hang case the page freezes before any save, and a reload recovers it.
- Fix spec: extend `firstInvalidField` with the checks above and return the field name.
  - Test: one case per mutation above. Each must be refused with "This save is damaged and was not loaded. (<field>)", and the 1e9 height must be refused fast.
  - Must not change: v1 to v5 files still load (old.ts) and the save round trip hashes.

### S6. Opening a saved file in Today's tower freezes it and loses today's daily - CONFIRMED (final: IMPORTANT)
- Reproduction (importdaily.ts): `import in daily slot: {"ok":true} slot daily getDaily null`, then `clock moved: false | build: {"ok":false,"reason":"Today's tower is over..."}`, then `daily slot after leaving: seed 11 mode undefined`.
- panels.ts:1393-1411 offers "Open a saved file" in every slot.
- Fix spec: an import outside My tower either moves to `mine` first (saving the slot being left, as `enterSlot` does) or is refused with a plain reason.
  - Test: the importdaily scenario. The daily slot must still hold `daily:2026-09-28`, and the clock of the imported tower must move.

### S7. Failed slot writes are silent, and a switch drops the unsaved tower - CONFIRMED (final: IMPORTANT)
- Reproduction (verifyD/s7.ts, localStorage refusing writes): Save now returns `{"ok":false,"reason":"This browser would not let the game save."}`. That reason reaches the player only through the Save now button.
- Then an autosave, then `openDaily`: `log lines added about saving: []`. Back in My tower: `lobby tiles 1 (had 11 before the switch)`.
- This breaks the LANES.md invariant "a slot write that fails surfaces one plain message".
- Fix spec: when `enterSlot` gets `{ok:false}` back from `saveWorld`, it aborts the switch and shows the reason. A failed autosave shows the reason once per session.
  - Test: the s7 scenario. After a refused switch, the slot stays `mine`, the 11 tiles are in hand, and one warn line is logged.

### S8. Nothing saves while paused or when the page closes - CONFIRMED (final: IMPORTANT)
- Reproduction (verifyD/s8.ts): pause, build 10, run 2000 timer steps: `in hand 11 | on disk rooms 1 | idle autosaves scheduled 0`.
- game.ts:288 returns before `maybeAutosave`, and the idle autosave is only ever scheduled from `advance`, so it does not cover the paused case.
- A grep of src finds no pagehide or beforeunload save. The only `visibilitychange` listener in game.ts (1060) resets `last` and saves nothing. The pagehide and beforeunload hits are in site/hero.ts and render/smoke.ts, not the game.
- Fix spec: when `dirty`, save on `visibilitychange` to hidden and on `pagehide` (fire and forget), and schedule an idle save after a successful `apply` while paused.
  - Test: in the s8 scenario the disk holds 11 rooms after a hidden event.

### S9. "We kept a copy of it" is a promise the player cannot use - CONFIRMED (final: IMPORTANT, raised from ADVISORY)
- Evidence: grep finds `hs.save.unreadable` only at storage.ts:465/474, so nothing ever reads it. The stash failure is swallowed (475). The message at game.ts:888 is logged whether or not the copy was written.
- After a failed boot load, the fresh tower's first autosave writes over the only good slot copy.
- I raised it because the text is player-facing, is false when the stash fails, and there is no way for the player to use the copy.
- Fix spec: `stashUnreadable` returns whether it succeeded, and the message changes to match. Do not autosave over an unreadable slot until the player chooses a new tower. Add a way to get the copy out ("Save to a file").

### S10. rentDay fires at midnight, but rent settles at 05:00 - CONFIRMED (final: ADVISORY)
- Trace: events.ts:96-97 emits when `absoluteQuarter` changes, which happens at 00:00 on day 0. tick.ts:18 runs `onQuarterStart` at `quarterStartMinuteOfDay` = 300 (rules.ts:164).
- The audio cue (audio.ts:208) therefore plays five game hours, about 4 s at night speed, before the cash changes.
- Fix: emit at the same minute as tick.ts:18.

### S11. Two desktop saves at once share one .tmp file - CONFIRMED (final: ADVISORY)
- Reproduction (verifyD/s11.ts, fake Tauri fs with async steps): two concurrent `writeSave` calls give `['ok', 'rejected: This device would not let the game save.']`, while `autosave.json` holds `save now text`. The player is told the save failed although it landed.
- `save()` does not check `autosaveInFlight`. The IndexedDB connections are never closed (storage.ts:49-56, no `db.close()`).
- ADVISORY because the Tauri shell is not shipped (DECISIONS 2026-09-24: Steam off every public surface).
- Fix: serialize writes per slot through a promise chain, or use a unique tmp name per write.

## Duplicates
- S2 is the same defect as lane C S1 (the `roachSpread` WeakMap, events.ts:61), already CONFIRMED CRITICAL.

## Notes
- New suspicion N1: `openMyTower` silently overwrites an unreadable My tower save, with no copy kept and no message (proposed: CRITICAL).
  - Where: game.ts:419-424, where `readWorld` maps a refused deserialize to null, and 965-972, where `freshTower` and `saveWorld` then write over the slot.
  - Input: the `autosave` key holds a save this build refuses (a newer version, or damaged). The player boots from a friend link and taps My tower.
  - Wrong outcome (verifyD/n1.ts): `My tower slot now: version 5 seed 77 | stash written: false | warn lines: []`. The boot path `load()` at least stashes and warns (885-889). This path destroys the save at once.
  - `openDaily` does the same to the daily slot.
  - Fix: route a refused read through the same stash-and-warn path, and never write a fresh tower over a slot that holds unreadable text.
- Questions for the owner (not findings): whether a failed autosave should tell the player once (S7 fix spec assumes yes, per the LANES.md invariant); whether `?daily=DATE` should open that date.
