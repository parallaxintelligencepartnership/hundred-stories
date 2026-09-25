# Audit reviewer brief: Hundred Stories at commit 7b4e60f (2026-09-25)

You are one lane reviewer in a whole-application adversarial audit. Repo: /Users/matthew/parallax-private/Projects/hundred-stories. Read-only.

## Rules (absolute)
- You must NOT edit, create, or delete any file inside the repository. Your only output is the report file named in your task, which lives in the scratchpad directory outside the repo.
- You must NOT spawn agents of your own.
- Read every file in scope IN FULL (use Read on the whole file, not excerpts). If you skip a file, name it and say why in the Coverage section.
- Do NOT run the full test suite. Run only the test files named in your lane (npx vitest run <paths>) or targeted probes. Other agents are running in parallel.
- Do not start a dev server. Node-side probes (npx vite-node@6.0.0 <script>, npx vitest run <file>, node -e) are fine. If you need a scratch script, write it under the scratchpad directory, never in the repo.
- Settled decisions are never findings. Read .itworks/DECISIONS.md in full; every ruling there is settled. If you think one is wrong, put it under "Questions for the owner", not under suspicions.
- Never flag: the declined Cloudflare Web Analytics beacon; the lack of an apple-touch-icon; the licence choice; the absence of accounts, auth, backend, server saves; the demo cap; Steam code staying while Steam is off public surfaces; UK vs US spelling in code identifiers or comments (only player-facing text must be US English and plain).
- A hostname is a name, not hardware: pi1/pi2/pi3 are x86_64 Ubuntu servers, not Raspberry Pis.

## What to hunt
Logic defects, not style. For each invariant in your lane, try to construct an input, command sequence, or timing that breaks it. Also look for: arithmetic at boundaries (rounding, zero, negative, midnight, day and quarter edges, the demo cap edge, floor 0 and basements), state read before it is committed or after it can change, writes without the guard the equivalent read has, error paths that continue silently, anything that trusts the page address or a save file, Map or Set iteration order feeding the RNG or the hash, determinism leaks (Date, Math.random, performance.now) into the simulation, and player-facing text that is not plain US English or that shows a code or the word "seed".

Read the tests for each file in scope and state what they do NOT prove.

## Severity rubric
- CRITICAL: a defect that changes stored money, time, population, stars, or the save file for real players, or loses a player's tower, or makes the same tower diverge between two loads (determinism), regardless of how rare the trigger looks. Also anything that crashes the game loop or blanks the page in a reachable path.
- IMPORTANT: wrong behavior a player would notice and that has no workaround, a refused action with a wrong or missing reason, an event with no path to ending, a failure path that throws instead of showing the plain message.
- ADVISORY: cosmetic, a gap in tests, a code smell that could become one of the above.

## Report format (write exactly this, to the path given in your task)
```
# Lane <letter>: <name> at 7b4e60f

## Suspicions
### S1. <one-line title> (proposed: CRITICAL | IMPORTANT | ADVISORY)
- Where: <file>:<line>
- Input: <the concrete input, sequence, or timing>
- Wrong outcome: <what happens vs what should>
- Reproduce: <exact command, test sketch, or code trace a verifier can follow>
(repeat)

## Questions for the owner
- <design choices that look wrong but are not defects>

## What the tests do not prove
- <file>: <gap>

## Coverage
- Read in full: <list>
- Skipped: <list with reason, or "none">
- Probes run: <commands and one-line results>
```
Keep the report under about 1500 words. Precision beats volume: a suspicion without a concrete input and a reproduction path is worth little. It is fine to report zero suspicions if you genuinely found none after a full read; say what you tried.

When done, reply with a summary under 200 words: number of suspicions by proposed severity, the top two in one line each, and the report path.
