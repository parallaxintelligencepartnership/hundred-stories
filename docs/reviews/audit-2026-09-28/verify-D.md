# Verification of lane D at 0f05723

Host arm64 (uname -m). Checkout audit-0f05723 at 0f05723; `git status` clean after the work. I read these in full: VERIFY.md, lane-D.md, the probesD scripts, .itworks/DECISIONS.md, docs/reviews/audit-2026-09-25/verify-D.md, src/game/storage.ts, src/sim/save.ts and src/game/game.ts. I read these in part: main.ts 60-140, ui.ts 525-570 and 875-910, panels.ts 1540-1590 and 1880-1900, alerts.ts 380-410, mood.ts 60-85, tick.ts 1-25, and the storage tests. No DECISIONS line settles any suspicion here.

My scripts are in audit-2026-09-28/verifyD/: idb-verify.test.ts, s56.ts, newgame*.test.ts, and copies of the reviewer's probes. I made the fixes in the throwaway overlay-D, ran the checks there, and then deleted it.

## Verdicts

### S1. IndexedDB stops opening mid-session: later saves are numbered below the old copy, and the next load rolls back - CONFIRMED (final: CRITICAL)
- **Reproduction.** I re-ran the reviewer's idbseq.test.ts and got the same output: `session 2 write 9000 resolved ok` / `localStorage now: {"minute":9000} seq 2` / `session 3 boot read: {"minute":3000}`.
  - My own verifyD/idb-verify.test.ts uses a task-ordered fake and covers two ways IndexedDB dies. Both fail on the current code:
    - (a) `open()` errors: `[S1 openFails] ls seq 2 idb seq 3 -> boot reads {"minute":3000}`.
    - (b) `open()` works but `db.transaction()` throws UnknownError: `[S1 txThrows] ... {"minute":3000}`.
  - Why both paths hit it: `readIndexedDbSeq` (storage.ts:143-153) returns 0 on any throw. `lastSeq` is never seeded by `readSave`, so after a reload it is 0 (storage.ts:119, 164-170).
- **The real browser path.** WebKit's "Connection to Indexed Database server lost. Refresh the page to try again" (UnknownError). In iOS/iPadOS Safari and home-screen PWAs, the IndexedDB server process is torn down while the page is in the background. After the page comes back, every open or transaction fails until the page reloads, which is exactly the S1 sequence.
  - The hidden-page save (game.ts:427-429) fires at the moment of backgrounding. Every later 06:00 or quarter autosave then "succeeds" into localStorage with seq 1, 2, ... and no notice shows (the write resolves).
  - The next launch reloads with IndexedDB healthy, so the older seq-3 copy wins, and its first autosave (seq 4) buries the session for good.
  - Not the trigger: a quota error (the seq read still works, so the fallback is numbered higher), private mode (IndexedDB never works there, so no higher IndexedDB copy exists), and a blocked open (the version is fixed at 1, and a blocked open hangs rather than failing).
  - Not affected: the Capacitor iOS app (file storage).
- **Fix spec.** `readSave` records the highest seq it saw, whether from IndexedDB, localStorage, or the localStorage-only branch at 281-282: `lastSeq[KEY] = max(lastSeq, seq)`.
  - Test: idb-verify S1 (both modes) expects `{"minute":9000}`. It fails now. It passed in the overlay with this change.
  - Must not change: tests/game/storage*.test.ts, save-read-failure.test.ts and slots.test.ts. All 37 passed in the overlay.

### S2. IndexedDB fails to open at boot while an old fallback copy sits in localStorage: the stale copy loads as current - CONFIRMED (final: CRITICAL)
- **Reproduction.** I re-ran idbstale2.test.ts and got the same output: `session 2 boot read with IndexedDB not opening: {"minute":2000}` / `ls after session 2: {"minute":2300} seq 5` / `session 3 boot read, IndexedDB back: {"minute":2300}`.
  - My idb-verify S2 case (one failed put, then three good IndexedDB saves, then a boot where open fails) prints `[S2] boot with IndexedDB not opening -> {"minute":2000}`.
  - main.ts:132 then says "Welcome back. Your tower is just as it was when it last saved."
  - Cause: storage.ts:281-282 returns any localStorage copy without comparing, and 207-208 never removes a fallback copy once IndexedDB writes succeed again.
- **The real browser path.** It needs two failures.
  - (1) Any earlier fallback write, which leaves a copy behind forever. The S1 WebKit connection loss makes this one, and so does an IndexedDB QuotaExceededError on a nearly full disk while localStorage still takes the text.
  - (2) A later boot whose `open()` rejects. Chrome/Android TWA: "UnknownError: Internal error opening backing store for indexedDB.open" (LevelDB locked or corrupt, low disk). WebKit: the same connection-lost error on a page that resumed while the IndexedDB process was down.
  - The repo already treats (2) as a real input: save-read-failure.test.ts:95 models a single failed boot open with this exact WebKit message. S2 is that same input with a localStorage copy present, which is the case the 2026-09-25 verify-D S3 fix never tested.
  - Rarer than S1, but the outcome is a silent rollback plus the loss of the stale session's autosaves. That is CRITICAL under "loses a player's tower".
- **Fix spec.** After a successful IndexedDB write, remove `hundred-stories:<key>`, `:written` and `:seq` from localStorage. Any copy left there is then newer than IndexedDB by construction. When IndexedDB fails with the marker set and no copy remains, the existing SaveReadError / protected-slot path takes over.
  - Test: idb-verify S2 (the boot read must not be 2000; in the overlay it throws SaveReadError). It fails now and passed in the overlay.
  - Must not change: the private-window path (storage.test.ts:82), "an old save with no stamps still reads IndexedDB first", and the fallback-wins cases in storage-audit.test.ts. All passed in the overlay.
  - S1 needs its own fix as well. Deleting the copy alone still reads seq 3 over seq 2.

### S3. New game does not cancel a pending idle save - CONFIRMED (final: ADVISORY)
- **Reproduction.** The reviewer's fake `scheduleIdle` returned a no-op cancel, so it could not tell a fix apart. I made the cancel real (verifyD/newgame.test.ts).
  - Current code: `after newGame save: seed 12 | after idle save: seed 11 rooms 2 | world in hand seed 12`.
  - Overlay with `cancelScheduledSave()` added at the top of `newGame` (game.ts:1269): `after idle save: seed 12 rooms 0`.
- **Severity.** ADVISORY. The window is one idle slot (requestIdleCallback, up to 2 s; setTimeout 0 on Safari). The only effect is that the old tower reappears after a reload before any build. Nothing the player made is lost, and New game again fixes it.
- **Fix spec.** Call `cancelScheduledSave()` in `newGame` before the world swap. Test: the corrected newgame probe expects seed 12 after the idle slot runs. Must not change: the existing newGame test in save-read-failure.test.ts:120-124.

### S4. After opening a file from Friend's tower the address still says ?seed= - CONFIRMED (final: ADVISORY)
- **Trace.** The import paths (ui.ts:535-538 and panels.ts:1578 and 1895) call `game.importSave`, which moves to `mine` at game.ts:1156. Only `switchTower` (ui.ts:904) and the daily choice (ui.ts:1384) call `syncAddress`.
  - slots.test.ts:172 pins `bootTarget('?seed=4242') -> friend` (it passed in my overlay run).
  - A reload therefore runs `openFriend(4242)`, and the opened file sits behind My tower (saved by the dirty pagehide or the next autosave). The same happens from Today's game-over card, with `?daily=`.
- **Severity.** ADVISORY. The player has a workaround (the My tower button) and nothing is lost.
- **Fix spec.** After a successful `importSave` in both ui paths, call `syncAddress()` (hand it to panels through ctx). Test: a ui test with history stubbed, where the address is `/play/` after an import from the friend slot.

### S5. Loader: `gameOver: {}` loads frozen; bad car fields refused with the wrong reason - CONFIRMED (final: IMPORTANT, raised from ADVISORY)
- **Reproduction.** verifyD/s56.ts on probesD/base.json:
  - `gameOverEmpty: LOADED gameOver={} minutes advanced=0`. tick.ts:12 returns at once, and alerts.ts:400 builds the reason paragraph from `undefined`, so it is blank.
  - `passengersNumber: REFUSED "This file is not a Hundred Stories save."` and `callsNumber:` the same. The spread at save.ts:722-723 throws, and the catch at 757 turns that into NOT_A_SAVE.
- **Severity.** Raised because the rubric lists "a refusal with a wrong reason" as IMPORTANT. It is reachable only with an edited or foreign file.
- **Fix spec.** In `firstInvalidField`:
  - `gameOver` must be null or `{at: integer, reason: non-empty string}`.
  - Each car needs `passengers` as an array of ids and `calls` as an array of integers. Also check `dir` in {-1,0,1}, `doorTimer` finite, and `idleSince` number or null.
  - In the overlay these gave `damaged ... (gameOver)`, `(shafts[0].cars[0].passengers)` and `(...calls)`.
  - Must not change: v1 to v5 still load and tick (old.ts, run in the overlay), and tests/sim/save.test.ts, save-roach.test.ts and cars.test.ts still pass (94 passed in the overlay).

### S6. A venue with a non-numeric occupancy passes the loader - CONFIRMED (final: IMPORTANT)
- **Reproduction.** s56.ts:
  - `venueOccX` ("x"), `venueOccObj` ({}) and `venueOccGone` (the key deleted) all print `LOADED ... venueFill@load=NaN`, and the tick repairs occupancy to 0 within 200 minutes.
  - save.ts:302-335 never checks `occupancy`, and 697-700 copy the room as it is.
  - The audio outcome (a NaN AudioParam throwing out of `notify`, so render and autosave are skipped) is lane G's to verify. The loader half is confirmed. If lane G's claim holds, the combined result stops autosaves for the session.
- **Fix spec.** `rooms[i].occupancy` must be an integer >= 0, or the file is refused as `damaged (rooms[n].occupancy)`. The field exists in types.ts since f1dfc68, the first contract, so no real save lacks it. In the overlay all three mutations were refused and v1 to v5 still loaded.
  - Consider also checking the other room scalars the loader copies as they are (`vacant`, `dirty`, `infested`, `onFire` as booleans, `builtAtMinute` finite, `lowEvalSinceMinute` number or null).

## Duplicates
- S6 shares its root cause with lane G S1: this lane owns the loader half, lane G owns the audio half (non-finite guards in mood.ts and audio.ts).
- S1 and S2 are the untested remainder of the 2026-09-25 D S3 (verify-D S3) fallback rollback.

## Notes
- The reviewer's newgame probe could not prove its own fix, because the fake `scheduleIdle` cancel was a no-op. The corrected version is in verifyD/.
- **UNVERIFIABLE HERE:** which exact WebKit call fails after connection loss (`open` or `transaction`). Both variants reproduce S1, so the verdict does not depend on it. To settle it on a real device:
  - Play at /play/ on an iPhone in Safari or the home-screen app.
  - Switch to other apps for a few minutes, return, and play past 06:00.
  - With Web Inspector attached, watch for "Connection to Indexed Database server lost".
  - Reload, and compare the tower minute before and after.
