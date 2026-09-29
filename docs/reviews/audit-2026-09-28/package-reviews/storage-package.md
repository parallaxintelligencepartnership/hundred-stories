# Review: storage fix package, commit 3486f01

Scope: tier checkpoint on 3486f01 (design verify, real-data lens and testing lens in one pass). Host arm64 (uname -m). Judged from the commit rather than the working tree: `git archive 3486f01` was unpacked into the scratchpad (`scratchpad/c`, with node_modules symlinked), and every probe and mutation ran there. The repository was not touched.

Read in full at 3486f01: src/game/storage.ts, src/game/game.ts, src/sim/save.ts, tests/game/newgame-pending-save.test.ts, tests/game/storage-reload.test.ts, tests/sim/save-loader-fields.test.ts, and docs/reviews/audit-2026-09-28/verify-D.md.

Read in part: main.ts 120-135 (boot routing); build.ts makeRoom and makeCar; world.ts setOccupancy; every writer of occupancy, gameOver, dir, doorTimer, idleSince, lowEvalSinceMinute, dirty, infested and vacant (git grep at 3486f01); and the DECISIONS.md grep. No DECISIONS line touches this package.

Not covered:
- A real browser. The fakes stand in for IndexedDB, so real WebKit and Chrome failure ordering is not verified.
- S4 (address after import). It is not in this commit.
- The lane G audio half of S6.

## Verdict per closed finding

| Finding | Spec met | Notes |
|---|---|---|
| S1 CRITICAL | Yes, as specified | Both readSave branches record the seq (storage.ts:307, 315). Each slot keeps its own counter, because `lastSeq` is keyed by KEY (the test covers this). The counter only ever grows through `Math.max`. A boot that reads only the localStorage copy also records its seq. A path the spec did not cover remains open; see F1. |
| S2 CRITICAL | Yes | The copy is dropped only after `tx.oncomplete` (storage.ts:224, then 231), not after a request's success. The private-window path keeps its copy (probe P5: seq 1..4 carries on across a reload). A `removeItem` that throws is caught, and the stale copy then stays, so that case behaves as it did before the fix (probe P3). The drop is unconditional, which opens a new loss path; see F2. |
| S3 ADVISORY | Yes | `cancelScheduledSave()` runs first in newGame (game.ts:1272). The daily and friend switches already cancel, in `switching()` (game.ts:592). In those paths `readyToLeave` still writes the old tower, because `dirty` stays true. Cancelling at New game drops only a save of the old tower to the same slot that New game then overwrites, since the pending save captures `slot` and every change of slot cancels it (switching, importSave:1155). Nothing the player expected is lost. |
| S5 IMPORTANT | Yes | The checks cover gameOver `{at int >= 0, reason non-empty}`, dir in {-1,0,1}, a finite doorTimer, idleSince as a number or null, passengers as ids, and calls as integers. |
| S6 IMPORTANT | Yes, plus the optional room scalars the spec suggested | These are occupancy (integer >= 0), builtAtMinute, the four booleans and lowEvalSinceMinute. |
| Refusal wording | Yes | `importSave` on edited files returns "This save is damaged and was not loaded." with the field sent to the console only. `unreadableMessage` builds the usual "We could not open your saved tower. ... We kept a copy of it." (probe-msg.ts). |

## Real-data lens: can a genuine save be refused now?

- **Writers.** Every field the loader now checks has been in types.ts since f1dfc68. It is written by makeRoom and makeCar since 8f0daa1, and the car serializer has written dir, doorTimer, idleSince, passengers and calls since v1 (78c1760).
  - Every occupancy decrement in the history is floored with `Math.max(0, ...)` (git log -G occupancy).
  - gameOver has one writer ever, economy.ts, with a non-empty reason and the integer game minute.
- **Saves from eight builds.** I generated saves with the old code itself, using builds, ticks and a forced bankruptcy: v1 2a2e47d, v2 83c57c2, v3 2f7ef6d, v4 75f20dd, v5 3b39f9b, ship-2026-09-25, ship-2026-09-27 and 3486f01. I loaded all of them with the 3486f01 loader. **496 of 496 loaded.**
  - The set includes 12 game-over records written by old builds, cars with riders and calls, idleSince null, open doors, occupied rooms and a set lowEvalSinceMinute.
  - The store fixtures (demo-tower v2, store-tower v5) and probeD/base.json also load.
  - Scripts: scratchpad/gen.ts, c/check-old.ts, c/cov.ts, c/probe-fixtures.ts.
- **Tests.** `npx vitest run tests/game tests/sim/save.test.ts tests/sim/save-loader-fields.test.ts tests/sim/save-roach.test.ts tests/sim/cars.test.ts tests/sim/replay.test.ts tests/sim/replay-start.test.ts` gave 28 files and 320 tests, all passed.

## Findings

### F1. A slot written in a session that never read it still counts from 0 (S1 left open on another path). IMPORTANT
- **Where.** storage.ts:167-173. `nextSeq` falls back to `lastSeq.get(KEY) ?? 0` when the IndexedDB seq read fails, and `lastSeq` for a slot is seeded only by `readSave` of that slot.
  - The game has a path that writes My tower without reading it. A boot on `?seed=` or `?daily=` never reads `mine` (main.ts:127-128). Open a saved file from there then takes `mine` with no read (game.ts:1149-1160), and the next autosave writes it.
- **Input.**
  1. Session 1 saves My tower three times; IndexedDB now holds seq 3.
  2. Session 2 boots from a friend link and opens a file.
  3. WebKit loses the IndexedDB connection (the S1 trigger), and the autosaves fall back.
  4. Session 3 reloads with IndexedDB healthy.
- **Wrong outcome.** The fallback copies are numbered 1 and 2, so session 3 reads the seq-3 tower. The opened file and everything played in it are silently replaced by the old My tower. The outcome belongs to the same defect class as S1; I rated it IMPORTANT only because the path is narrower (a link boot, then an import, then connection loss).
- **Reproduction.** scratchpad/c/tests/game/probe-storage.test.ts, test P1, printed `P1 ls seq 2 idb seq 3` / `P1 boot reads {"minute":3000}` (the imported text was `{"imported":2}`).
- **Fix spec.**
  - Preferred: when a slot's seq was never learned this session, learn it before the first write. For example, importSave reads `mine` first (it already asks `unread.has('mine')`), or boot reads the seq keys of all three slots in one transaction.
  - Test: P1 must read `{"imported":2}`.
  - Must not change: tests/game/storage*.test.ts, save-read-failure, slots.

### F2. The unconditional drop can delete a newer fallback copy written by a concurrent save. IMPORTANT (a regression introduced by this commit)
- **Where.** storage.ts:231 calls `dropLocalCopy()` (185-193) after a write's own transaction completes. It does not check that the copy in localStorage is older than what that write committed.
  - Two writes to one slot can be in flight together. `saveNow` on visibilitychange or pagehide (game.ts:487-491) does not wait for an in-flight autosave. Save now (`api.save`) does not wait either.
- **Input.**
  1. Autosave A takes seq 2, and its 3 MB commit is slow.
  2. The page hides, and saveNow write B takes seq 3. B's IndexedDB open fails, so B writes localStorage with seq 3.
  3. A's transaction then completes and removes B's copy.
  4. The page reloads.
- **Wrong outcome.** Only A's older tower remains, and the next boot reads `{"minute":2000}`, losing B. Before this commit, B's seq-3 copy survived and won.
- **Reproduction.** probe-storage.test.ts P2 uses a gated fake in which A's puts are held until B has fallen back. It printed `P2 after B: ls {"minute":3000} seq 3` / `P2 after A commits: ls null idb {"minute":2000} idb seq 2` / `P2 next boot reads {"minute":2000}`.
  - Not verified on a device: whether a real browser lets a new open fail while an earlier connection's transaction still commits. In WebKit connection loss the in-flight transaction probably aborts instead.
- **Fix spec.** Drop only a copy that is not newer than the committed write: `if (readLocalSeq() <= seq) dropLocalCopy()`.
  - Test: P2 must read `{"minute":3000}`.
  - Must not change: storage-reload S2's three cases.

### F3. A stale copy left by an earlier build survives until the first good IndexedDB write after the update. ADVISORY
- **Where.** storage.ts:314-321. A healthy boot that finds the IndexedDB copy newer does not remove the older localStorage copy.
- **Input.** A player updates with a fallback copy (seq 2) behind an IndexedDB seq 5. The first boot after the update, or any boot before the first good write, has IndexedDB failing to open.
- **Outcome.** That boot loads the stale seq-2 copy, as in S2. The window closes at the first successful IndexedDB write.
- **Reproduction.** P4 printed `healthy boot reads {"minute":5000} ls copy still there: true`, then `boot with IndexedDB down reads {"minute":2000}`.
- **Fix spec.** In `readSave`, when `fromDb.seq > fromLocal.seq`, drop the local copy.

### F4. Test gaps: three new checks and one new line fail no test when reverted. ADVISORY
Each was removed in the scratch copy and the package's tests re-run:
- **M1.** Removing `sawSeq(local.seq)` (storage.ts:307) left 22 of 22 passing. I found no input where the line changes an outcome, because `nextSeq` re-reads the localStorage seq on every write. It is harmless, but untested.
- **M6 and M7.** Dropping `'dirty'` or `'infested'` from the boolean list left 6 of 6 passing.
- **M10.** Removing `over.at < 0` left 6 of 6 passing.

The other mutations were caught:
- M2, the boot `sawSeq`: 3 tests failed.
- M3, `dropLocalCopy`: 1 failed.
- M4, the newGame cancel: 1 failed.
- M5, the gameOver check: 1 failed.
- M8, idleSince: 1 failed.
- M9, the empty reason: 1 failed.

## Questions for the owner
- IndexedDB `complete` under the browsers' default (relaxed) durability is not an fsync. A power loss right after the drop could lose the IndexedDB write while the localStorage copy is already gone. I cannot verify this here, and localStorage has the same weakness, so it is recorded only as a question.
