# Audit verifier brief: Hundred Stories at commit 7b4e60f (2026-09-25)

You are the verifier for one lane. You did not write the lane report. Repo: /Users/matthew/parallax-private/Projects/hundred-stories. Read-only inside the repo.

## Rules (absolute)
- Never edit, create or delete any file inside the repository. If a reproduction needs a mutation (a fix to prove a test flips, a field dropped), do it in a throwaway overlay: `rsync -a --exclude node_modules --exclude .git --exclude dist --exclude dist-app <repo>/ <scratchpad>/overlay-<lane>/` then `ln -s <repo>/node_modules <overlay>/node_modules`, work there, and delete the overlay when done.
- Never spawn agents. Never run the full test suite; one vitest process at a time, only the files you need. Never start a dev server.
- Read .itworks/DECISIONS.md in full before you begin. A suspicion that re-flags a settled decision is REFUTED with the decision line quoted, whatever the reviewer said.
- Read the reviewer's probe scripts if they exist (a folder next to the report) and re-run them yourself; do not take the reviewer's output on trust.

## For each suspicion in the lane report
Reproduce it independently. Acceptable reproductions:
- a test (in the overlay, or a scratch vitest file under the scratchpad that imports from the repo's src/ by absolute path) that fails on the current code and names the input;
- a probe transcript (vite-node script output) showing the wrong value;
- a traced code path with the exact values at each step, only when execution is impossible here (browser, GPU, phone).

Mark each:
- CONFIRMED: reproduction attached, final severity per the rubric below (you may raise or lower the reviewer's proposal; say why), plus a fix spec: what must change, which test must fail before and pass after, what must not change.
- REFUTED: the evidence that the code is right ("looks fine" is not evidence; show the guard, the test, or the probe output).
- PARTIAL: what holds and what does not, each with evidence.
- UNVERIFIABLE HERE: only for things that need a real browser, GPU or phone; give the exact command or manual step that would settle it.

## Severity rubric
- CRITICAL: changes stored money, time, population, stars or the save file for real players; loses a player's tower; makes the same tower diverge between two loads; crashes the loop or blanks the page on a reachable path.
- IMPORTANT: wrong behavior a player would notice with no workaround; a refusal with a wrong or missing reason; an event with no path to ending; a failure path that throws instead of showing the plain message; player-facing text that is not plain US English or shows a code.
- ADVISORY: cosmetic, test gap, code smell.

## Report format (write to the path in your task)
```
# Verification of lane <letter> at 7b4e60f

## Verdicts
### S1. <title from the report> - CONFIRMED | REFUTED | PARTIAL | UNVERIFIABLE HERE (final: <severity>)
- Reproduction: <what you ran and what it printed, or the trace>
- Fix spec: <only for CONFIRMED and PARTIAL>
(repeat for every suspicion, in order; none skipped)

## Duplicates
- <suspicions that are the same defect as one in another lane, if the task names any>

## Notes
- <anything the reviewer missed that you saw while reproducing, marked as a new suspicion with the same fields; the orchestrator decides whether it enters>
```
Keep it under about 1500 words. Reply with a summary under 200 words: counts of confirmed, refuted, partial and unverifiable, the confirmed items in one line each with final severity, and the report path.
