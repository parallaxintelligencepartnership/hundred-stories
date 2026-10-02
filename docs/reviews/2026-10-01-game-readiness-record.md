# Game readiness run: implementation record

Started 2026-10-01 from `50deb78` (0.6.12, the commit the handoff reviewed; nothing had changed since). Branch `game-readiness`. Source: `docs/reviews/2026-10-01-game-readiness-handoff.md`, a read-only review that ran nothing. This file is the reconciliation of that review against the code, the disposition of every item, the commits, the verification and what is still open. A later session continues from here, not from conversation memory.

The assignment prompt was written by Codex Astra and Matt did not read all of it. Where it differs from his standing rules, the standing rules win: one review per package, one capture run, one full test run at the end, no Colima, and the deploy waits for his explicit go.

## Owner decisions made in this run (2026-10-01)

| Question | Answer | Who |
|---|---|---|
| How Stories opens from a toast | One page inside the pause card, always; a toast tap opens the menu on that page and the game pauses | Matt |
| Party hall pay once fixed | $15,000 a party, once | Matt |
| Collectors lever | More than one recycling center allowed; longest-waiting rooms first; the card shows made against collected | Matt |
| Removing the recycling center | Once a tower has had a center, waste keeps piling without one; stars still never fall | Matt |
| Two windows on one tower | The stale window's save is refused and says so, with reload or save-to-file choices | PM, open for Matt to change |
| VIP rating for the fourth star | The best visit counts; the last visit is still shown truthfully | PM, open for Matt to change |
| VIP "cares most about" | Reworded as character, scoring unchanged | PM |
| Closed incident card | A small reminder for a live fire or bomb that opens Stories; the card itself never reopens | PM |

## Reconciliation

Status words: confirmed, partially confirmed, already fixed, refuted, product improvement, verification gap. Evidence files are under the session scratchpad `recon/` (lane-A-save.md, lane-B-sim.md, lane-C-stories.md, lane-D-panels.md) with the scripts that produced them; the key numbers are copied here because the scratchpad does not outlive the session.

| Item | Status | Evidence at 50deb78 | Disposition |
|---|---|---|---|
| F1 Update Reload after a failed save | Confirmed, wider | Probe: `order=['reload'] stored=null`; a build made during the write is dropped; Reload during a tower switch does not wait | Fixed, P1a |
| F2 Import abandons the outgoing tower | Confirmed | Probe: friend tower lost, warning lands in the opened tower; reachable from a friend's tower via Settings and from any slot via the game-over card | Fixed, P1a |
| F3 Two sessions, last writer wins | Confirmed | Probe with two module graphs on one store: B's stale save replaces A's, no warning in either; also on the localStorage-only path | P1b |
| F4 Dismissed fire or bomb card | Confirmed, wider | Probe: zero response buttons anywhere after dismissal; three newer alerts also hide the fire card with its button (`display:none`) | P3 |
| F5 Unreachable dirty room starves housekeeping | Confirmed | Real ticks: reachable room never cleaned, infested by day 7, $0 hotel income | Fixed, P2 |
| F6 Housekeeping office demolition-locked | Confirmed | Demolishable 2 of 96 hourly tries; security and recycling 96 of 96 | Fixed, P2 |
| F7 Party hall pays per attendee | Confirmed | One party $750,000; four halls $3,000,000 | Fixed, P2, $15,000 once per party |
| F8 Eviction during a ride | Confirmed; "always jams" refuted | Heals in 2 to 9 minutes in common layouts; permanent ghost seat in a two-shaft shuttle layout (10,080 of 10,080 minutes), shaft then cannot be demolished | Fixed, P2 |
| G1 Stories and News | Confirmed, wider | News opens only from a 4 s toast; the Stories sheet is dead code; two sections both called Milestones | P3 |
| G2 Warning counts | Confirmed | "8 problems in the tower" from lines 30 minutes old while the panel says "Nothing needs you right now." | P3 |
| G3 VIP presentation | Confirmed | Booking and good ratings are red trouble cards; the result card lives only in News; an unreachable first suite is booked and rated poor | Sim part fixed in P2; presentation in P3 |
| G4 Build panels and Menu | Confirmed at 900 px and wider | Measured in headless Chrome: a room, person or elevator card mounts at 1068,72 on 1440 px, its right edge on Menu's and 8 px below it, the same anchor as the Views dropdown; nothing opens Menu; phones and portrait tablets use bottom sheets | P4, card opens beside the selection (Matt) |
| G5 Sheet mode on resize | Confirmed both ways | Resize across 900 px with a card open: looks like a sheet but no backdrop, Escape ignored, drag handle dead; the other way a floating card stays modal | P4 |
| G6 Pause button centering | Confirmed | Icon and label 60 to 113 px left of center in every entry and Save state; two scoped CSS lines measure offset 0 at desktop and phone, Larger text on and off | P4 |
| G7 Clips and Save and exit | Confirmed absent | No menu entry for either; app builds drop trailers/ and the PWA does not precache them, so clips are online only; no clip has an audio track | P4d; clip sound is a separate video package |
| Staff: housekeeping | Confirmed useful when reachable | 50 checkouts, 50 cleans, no cockroaches; without it every room infested | Visibility in P3 |
| Staff: guards | Theft response real; patrol alone changes nothing | 20 of 20 caught with an office, 0 of 20 without; one race where the guard arrives as the thief boards | Race fixed in P2; wording in P3 |
| Staff: collectors | Measured: the rejected "inevitable backlog" claim is right in outcome above about 300 producing rooms | 230 to 335 units a day whatever the shafts; 34% of rooms piling up at 410 offices, 66% at 820, 77% at 1,107; top floors never visited | P2b |
| Recycling center removal | Confirmed | Waste and dirt cleared at the next roll, upkeep gone, stars stay | P2b |
| R1 GPU context recovery | Confirmed in software rendering; real GPU unverified | Forced context loss and restore: office wall pixels 69,479 to 1,675, no recovery at 8 s, no console error; far zoom unaffected | P4c |
| R2 Save history growth | Growth confirmed and measured; not a near-term failure | 20 bytes a command, 28 a checkpoint; 0.2 to 0.8 MB after 90 hours | Checkpoint trim in P2b |
| R3 IndexedDB connections | Partially confirmed | 21 opens, 0 closes in 10 saves; a stalled open hangs the boot (not mistaken for empty); real-browser frequency unmeasured | P1b |
| R4 Native save durability | Partially confirmed | iOS library writes the live file with `atomically: false`, no previous-good copy; no corruption reproduced; Android library source not on this Mac | P1c, device check still owed |
| R5 Feedback mailer | Confirmed from the repo file; live n8n is a verification gap | The mailer reads the 100 oldest keys with no paging, has no error workflow, and a dead mail login ends green; the live workflow is not exposed to the session's n8n access | Not blocking the browser release; needs Matt or n8n access |
| R6 Ship runs no tests | Confirmed | `scripts/ship.sh` and `npm run deploy` run no tests and no Worker typecheck | Closeout package |

## Packages

| Package | Scope | Commit | Review | Status |
|---|---|---|---|---|
| P1a | Save before leaving: `leave` / `resumeAfterLeave`, import awaits the outgoing save, refused switches say why, leave card | `293492e`, fix `10c7c60` | 0 CRITICAL, 1 IMPORTANT (fixed at `10c7c60`), 6 ADVISORY for the close batch | reviewed |
| P2 | Sim fixes F5 to F8, VIP suite and best rating, guard race | `3729ffd` | 0 CRITICAL, 0 IMPORTANT, 6 ADVISORY for the close batch | reviewed |
| P1b | Stale-window save refusal, IndexedDB connection reuse and open deadline | | | to do |
| P1c | Native save file protocol (temp file, previous-good copy) | | | to do |
| P2b | More recycling centers, longest-waiting first, waste without a center, checkpoint trim | | | to do |
| P3 | One Stories page: incidents with their buttons, tower problems, VIP, following, today, milestones; toast and VIP cards | | | to do |
| P4 | Panel ownership, resize, centered pause buttons, Clips, Save and exit with the exited screen | | | to do |
| Closeout | Guide wording, ship script checks, advisories batch, full test run, capture run, records | | | to do |

## Verification log

(every line names the commit it ran against)

- `293492e` P1a review: the old code (97777fa) fails all five behaviors asserted through the old API (clock moved during the reload save, reload save resolved before a switch, friend tower dropped on import, reload after a refused write, silent second refused switch); protection files pass on the new code (save-read-failure 7, shell-audit 19, storage-seq 10, slots 27); typecheck clean.
- `10c7c60` I1: `tests/ui/leave-card.test.ts` 9 passed; the new case fails with the fix commented out (clock frozen at 360).
- `3729ffd` P2 review: six bench hashes unchanged (3b283dda d8f2c09e 9de7c3a7 b2d54ef5 98fe5e06 b9ea75da); the 0.6.12 loader opens a save with the new VIP suite fields and hashes it the same; seven test files 79 passed; reverting each fix in a scratch copy fails its tests.

Review reports are under the session scratchpad `reviews/` (p1a-review.md, p2-review.md). Advisories carried to the close batch:
- P1a: A1 double tap on Reload makes two cards; A2 a write that never settles holds the game with no word (closes with the P1b open deadline); A3 no test for pointer refusal, the per-slot queue order, or the wait for an in-flight write; A4 no UI test for the refused-switch and New tower notices; A5 the leave card can be pushed into a hidden pause menu; A6 Open a saved file is not refused during a leave.
- P2: A1 the no-route set is rebuilt every tick; A2 a 0.6.12 save made in the first minutes of a party pays that party nothing once; A3 no test for the caught thief's car call; A4 the cannot-reach list has no UI caller and the old "Housekeeping will clean them out." line stands (P3b); A5 an evicted rider's old car call stays lit for one empty stop; A6 goal lines say "now" for the best VIP visit (P3c).

## Still open or unverified

(filled at closeout)

## Rendered verification

One run, on the final commit, from the repo root (Chrome at the default macOS path, or `CHROME=<path>`):

```
npx vite-node@6.0.0 scripts/make-readiness-fixtures.ts
node scripts/make-readiness-shots.mjs
```

The first writes the saved towers the shots seed (built from the store tower with the sim's own ticks, commands and event starters) to `docs/reviews/readiness-2026-10-01/fixtures/`. The second builds the web bundle into a temp dir, serves it, and for each shot in its fixed list seeds the tower, reaches the state through the game's own controls, runs the DOM checks and writes the PNG. Output goes to `docs/reviews/readiness-2026-10-01/` (gitignored): `<shot>-<viewport>.png`, `report.txt` (one line per shot: OK, CHECK FAILED with the check, or NOT-CAPTURED with why) and `report.json`. It exits 1 when any check failed. `--checks-only` runs the same without PNGs.

(results filled at closeout)
