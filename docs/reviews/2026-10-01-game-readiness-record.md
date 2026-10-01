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
| G4 Build panels and Menu | pending lane D | | P4 |
| G5 Sheet mode on resize | pending lane D | | P4 |
| G6 Pause button centering | pending lane D | | P4 |
| G7 Clips and Save and exit | pending lane D | | P4 |
| Staff: housekeeping | Confirmed useful when reachable | 50 checkouts, 50 cleans, no cockroaches; without it every room infested | Visibility in P3 |
| Staff: guards | Theft response real; patrol alone changes nothing | 20 of 20 caught with an office, 0 of 20 without; one race where the guard arrives as the thief boards | Race fixed in P2; wording in P3 |
| Staff: collectors | Measured: the rejected "inevitable backlog" claim is right in outcome above about 300 producing rooms | 230 to 335 units a day whatever the shafts; 34% of rooms piling up at 410 offices, 66% at 820, 77% at 1,107; top floors never visited | P2b |
| Recycling center removal | Confirmed | Waste and dirt cleared at the next roll, upkeep gone, stars stay | P2b |
| R1 GPU context recovery | pending lane D | | |
| R2 Save history growth | Growth confirmed and measured; not a near-term failure | 20 bytes a command, 28 a checkpoint; 0.2 to 0.8 MB after 90 hours | Checkpoint trim in P2b |
| R3 IndexedDB connections | Partially confirmed | 21 opens, 0 closes in 10 saves; a stalled open hangs the boot (not mistaken for empty); real-browser frequency unmeasured | P1b |
| R4 Native save durability | Partially confirmed | iOS library writes the live file with `atomically: false`, no previous-good copy; no corruption reproduced; Android library source not on this Mac | P1c, device check still owed |
| R5 Feedback mailer | Verification gap | The live n8n workflow is not exposed to the session's n8n access; repo evidence only | Not blocking the browser release |
| R6 Ship runs no tests | Confirmed | `scripts/ship.sh` and `npm run deploy` run no tests and no Worker typecheck | Closeout package |

## Packages

| Package | Scope | Commit | Review | Status |
|---|---|---|---|---|
| P1a | Save before leaving: `leave` / `resumeAfterLeave`, import awaits the outgoing save, refused switches say why, leave card | `293492e` | in review | built |
| P2 | Sim fixes F5 to F8, VIP suite and best rating, guard race | `3729ffd` | in review | built |
| P1b | Stale-window save refusal, IndexedDB connection reuse and open deadline | | | to do |
| P1c | Native save file protocol (temp file, previous-good copy) | | | to do |
| P2b | More recycling centers, longest-waiting first, waste without a center, checkpoint trim | | | to do |
| P3 | One Stories page: incidents with their buttons, tower problems, VIP, following, today, milestones; toast and VIP cards | | | to do |
| P4 | Panel ownership, resize, centered pause buttons, Clips, Save and exit with the exited screen | | | to do |
| Closeout | Guide wording, ship script checks, advisories batch, full test run, capture run, records | | | to do |

## Verification log

(filled as each step runs; every line names the commit it ran against)

## Still open or unverified

(filled at closeout)
