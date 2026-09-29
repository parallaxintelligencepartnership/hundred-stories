# Lane D: Save, storage, and the game shell at 0f05723

Host arm64 (uname -m). Checkout /private/tmp/.../audit-0f05723 at 0f05723. Nothing in the repo was touched. The probes are in scratchpad/audit-2026-09-28/probesD/.

## How the 2026-09-25 fixes held
- Slot race (D S1): holds. `switching()` holds the clock, `takeSlot` and `swapWorld` run in one synchronous step after the read (game.ts:590-620), and `saveWhenIdle` captures the slot and world when it is scheduled (456-476). The shell-audit test replays the frame-during-read case and it passes.
- IndexedDB fallback rollback (D S3): held for the audited input only (the write fails, but in the same page that made the earlier writes). A reload between the two breaks it, and so does IndexedDB failing to open. See S1 and S2.
- Damaged saves (D S5, new S1): hold. The previous mutations are refused. A 29-way fuzz of cross-references (missing rooms, cars, sims, shafts, events; bad car fields) ran 3 game days each with no throw or hang. v1 to v5 variants of a real save all load and tick. `openMyTower` now keeps an unreadable text (game.ts:1257-1261).
- Daily clock rollback (C S2): holds. `dailyOpening` returns `ahead`, the slot bytes stay untouched and a copy is kept before "Start today's" (daily.ts:186, game.ts:1195-1223).

## Suspicions

### S1. IndexedDB that stops opening mid-session: every later save is numbered below the old copy, and the next load rolls the tower back (proposed: CRITICAL)
- Where: src/game/storage.ts:164-170 (`nextSeq`), 143-153 (`readIndexedDbSeq` turns a failed open into 0) and 288-292 (the read picks the higher seq).
- Input: session 1 autosaves normally (IndexedDB seq 3). Session 2 reloads, and the boot read works. Then IndexedDB stops opening, which is WebKit's "Connection to Indexed Database server lost" (the repo's own save-read-failure.test.ts:21 models this). The player plays on and it autosaves twice. Session 3 reloads with IndexedDB healthy again.
- Wrong outcome: in session 2, `lastSeq` is 0 after the reload (the boot read never records the seq it saw), and the seq read fails to 0. So the fallback writes get seq 1 and 2. Both `writeSave` calls resolve, so no "not saving" notice appears. Session 3 reads the IndexedDB copy (seq 3 > 2), and its first autosave writes seq 4, which hides session 2's work for good. The player silently loses every minute played since that boot.
- Reproduce: `node_modules/.bin/vitest run --root <scratchpad>/audit-2026-09-28/probesD idbseq.test.ts`, which writes idbseq.out: `session 2 write 9000 resolved ok` / `localStorage now: {"minute":9000} seq 2` / `session 3 boot read: {"minute":3000}`.
- Fix direction: have `readSave` seed `lastSeq` with the highest seq it saw in either store. Test: the probe above expects 9000.

### S2. IndexedDB fails to open at boot while an old fallback copy sits in localStorage: the stale copy loads as the real tower (proposed: CRITICAL)
- Where: src/game/storage.ts:274-284 (`if (local) return local.text`). A fallback copy is never removed after later IndexedDB writes succeed (207-208).
- Input: one IndexedDB write fails once (localStorage now holds minute 2000, seq 2). Later saves succeed to IndexedDB (minute 5000, seq 5). On a later boot, IndexedDB fails to open.
- Wrong outcome: `readSave` returns the stale 2000 copy with no error. The game resumes it and main.ts:132 logs "Welcome back. Your tower is just as it was when it last saved." Autosaves in that session go to localStorage with seq 3 to 5. They tie with IndexedDB at seq 5 and win on the later wall stamp. The next healthy boot reads the tower built on the stale copy, so the 3000 to 5000 progress is gone for good. With fewer saves in the bad session, that session's work is lost instead.
- Reproduce: probesD/idbstale2.test.ts (fake timers move the clock a minute between sessions), which writes idbstale2.out: `session 2 boot read with IndexedDB not opening: {"minute":2000}` / `ls after session 2: {"minute":2300} seq 5` / `session 3 boot read, IndexedDB back: {"minute":2300}`.
- Fix direction: after a successful IndexedDB write, remove the localStorage copy and its seq, so any copy that remains is by construction newer. When IndexedDB fails with the save marker set and the only copy is a numbered fallback, treat the slot as unread.

### S3. New game while an idle save is pending: the old tower is written after the new one (proposed: ADVISORY)
- Where: src/game/game.ts:1269-1287. `newGame` never calls `cancelScheduledSave`, which the switches (592), `saveNow` and `flush` all do. The pending save captured the old world (466).
- Input: a moved tower, then Pause (1001 schedules an idle save), then Settings > New game before the idle slot comes. `requestIdleCallback` can wait up to 2 s on a busy tower.
- Wrong outcome: New game writes seed 12, and then the idle save writes seed 11 over it. `dirty` stays false, so neither pagehide nor pause writes again. While the game stays paused, a reload brings back the old tower. The comment at 1286 says this must never happen.
- Reproduce: probesD/newgame.test.ts writes `after newGame save: seed 12 | after idle save: seed 11 rooms 2 | world in hand seed 12`.

### S4. Opening a file from Friend's tower (or from Today's game-over card) leaves `?seed=`/`?daily=` in the address, so a reload lands in the other slot (proposed: ADVISORY)
- Where: src/ui/ui.ts:535-538 and panels.ts:1893-1896 call `importSave`, which moves to `mine` (game.ts:1149-1158). Only `switchTower` calls `syncAddress` (ui.ts:904).
- Input: open /play/?seed=4242, use Open a saved file, then reload.
- Wrong outcome: boot routes by the stale address to Friend's tower. The opened file is behind the My tower button (not lost). The lane invariant says each address lands in the right slot.
- Reproduce: code trace. `bootTarget('?seed=4242')` returns friend (main.ts:84-86), and nothing rewrites the address after the import.

### S5. Validator gaps with the wrong or no reason (proposed: ADVISORY)
- Where: src/sim/save.ts:256 (`gameOver` is only checked to be an object) and 722-723 (`passengers`/`calls` are spread without a check).
- Input: an edited file with `gameOver: {}`, or with `cars[0].passengers = 5`.
- Wrong outcome: `gameOver: {}` loads, and `tick` returns at once forever (tick.ts:12). The game-over card shows a blank reason (alerts.ts:400). `passengers: 5` is refused as "This file is not a Hundred Stories save." rather than as damaged.
- Reproduce: `MUT=gameOverEmpty` / `MUT=passengersNumber npx vite-node@6.0.0 <scratchpad>/audit-2026-09-28/probesD/fuzz.ts` from the checkout.

## Questions for the owner
- Open a saved file from Friend's tower (and from Today's game-over card) replaces My tower on the next save. My tower is not read first and there is no confirmation (game.ts:1149-1161). The closeout test pins this behavior ("always opens My tower"), but DECISIONS.md does not record it. Is that intended?
- On phones, a save is one `Filesystem.writeFile` straight over autosave.json (storage.ts:320-326). There is no tmp-and-rename, unlike Tauri (storage.ts:444-475), and iOS can kill a backgrounded app during the save that the hide event triggers. The native write lives in the Ionic library, which is not in node_modules, so atomicity could not be checked here. Closing step: in the iOS and Android shells, kill the app mid-save on a 3 MB tower and relaunch.
- A daily or friend save that exists but will not open is replaced by a fresh one without a copy (game.ts:1188-1191 and 1239-1241). The doc comment (daily.ts:178) says this is by design for the daily. Confirm the same holds for Friend's tower.
- `?daily=DATE` still ignores the date (main.ts:80). This is carried over from RECORD.md:119.

## What the tests do not prove
- tests/game/storage-audit.test.ts: the fake IndexedDB fails only on put, and always in the same page that made the earlier writes. Nothing covers a reload before the failure, `open` failing after a good boot read (S1), or a stale fallback copy read when `open` fails (S2).
- tests/game/save-read-failure.test.ts: the protected-slot path is tested only with no localStorage copy present.
- tests/game/slots.test.ts, loop.test.ts, game.test.ts, buildlog.test.ts, lobby-drag.test.ts, placement-guards.test.ts: storage is a synchronous in-memory mock. `newGame` is never raced against a pending idle save (S3). The idle slot either runs at once or never.
- tests/game/boot.test.ts: the read always returns null. No boot resumes a real save, and no boot hits a read failure or `?daily`.
- tests/game/storage-native.test.ts / storage-slots.test.ts: the Capacitor fake writes atomically. Nothing covers a write cut off partway or two writes at once.
- tests/sim/save.test.ts: no referential checks (these ran clean in the fuzz), and no `gameOver` shape check. The v1 case exists only in tests/sim/cars.test.ts and in this audit's probe.
- tests/game/events.test.ts: no test that a world swap mid-quarter (a slot switch or an import) emits no rentDay.

## Coverage
- Read in full: src/sim/save.ts, src/game/storage.ts, src/game/game.ts, src/game/api.ts, src/game/events.ts, src/main.ts, src/game/daily.ts; tests/sim/save.test.ts, tests/sim/save-roach.test.ts, and every file in tests/game (boot, buildlog, daily, events, game, lobby-drag, loop, placement-guards, pointer, save-read-failure, shell-audit, slots, steam, storage-audit, storage-native-plugin, storage-native, storage-slots, storage-tauri, storage, weather). DECISIONS.md in full; the MAP.md Gotchas; the lane D and independent-rules sections of LANES.md; lane-D.md, verify-D.md and verify-new.md from the previous audit.
- Read in part, for context only: src/ui/ui.ts (520-570, 880-930, 1880-1900), src/ui/panels.ts (1500-1600, 1885-1896), src/sim/buildlog.ts (checkpoints, buildLogFromSave), src/sim/types.ts (World, Stats), src/sim/tick.ts, and git history of types.ts for v1 key coverage.
- Skipped: none in scope.
- Probes run:
  - `npx vitest run tests/sim/save.test.ts tests/game`: 259 passed.
  - idbseq.test.ts: rollback reproduced (S1).
  - idbstale.test.ts and idbstale2.test.ts: stale copy served, later progress lost (S2).
  - newgame.test.ts: the old tower written after New game (S3).
  - fuzz.ts across 29 mutations: the sim survives every one. Two wrong reasons were found and one frozen game over (S5).
  - old.ts: v1 to v5 variants load and tick 1500 minutes.
  - A grep of src/sim for Date, Math.random and performance.now found none in the sim.
  - A grep for unsaved World fields found that `longWaits` is read only by the UI.
