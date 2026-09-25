# Kickoff: run the 2026-09-25 remediation end to end

This note is for the session that runs the fix wave. Matt's words on 2026-09-25: "I want to start a fresh session that just kicks this right off end to end with no interruptions." That is the authorization for everything below, through the ship. Do not ask him anything; every choice is already made in the plan.

## Read first, in this order
1. `.itworks/MAP.md` whole, Gotchas especially (the push timeout, the zsh refspec, the worktree node_modules cache, the SwiftShader flags, the nginx console grep).
2. `docs/reviews/2026-09-25-remediation-plan.md` whole. The thirteen decisions are settled; decision 13 is News.
3. `.itworks/REVIEWS.md`, the `## Audit - 2026-09-25` section: the finding lines are the contract, their Evidence to close is what each package must produce.
4. For each package, the verification reports under `docs/reviews/audit-2026-09-25/` (verify-A to verify-I and verify-new) for the fix specs, and `probes/` for the scripts that become tests.

## Rules for the run
- The project-resume replay prints at session start; its one question is already answered: continue with the remediation plan. Do not wait for a reply.
- Branch `audit-fixes-2026-09-25` off main. Each package is one agent in its own worktree (`isolation: "worktree"`), branched from that branch. Fable merges each package back into the branch, running only the package's touched test files at merge. Export a worktree's changes with `git diff --cached --binary` if a direct merge is not possible (gotcha 2026-09-22).
- Agents: `senior-implementer` for every Opus package, `implementer` for P7 and P8, `reviewer` for the fix review. Never general-purpose, never `model: inherit`. At most five agents at once. No agent runs the full test suite. Each worktree's vite cache is private (gotcha 2026-09-24).
- Each package prompt names its files, its finding ids, the verification report sections to read, the tests that must go red then green, and the rule that the agent stops and reports on any fork the spec does not cover. Fable decides forks; the defaults in the plan cover the known ones.
- A package that hits a fork on a CRITICAL finishes its other items and reports the fork; Fable resolves it from the plan's defaults and re-delegates. If a fork is genuinely outside the plan (a save-format choice that moves the six benchmark hashes, a rule change not in the decisions table), pick the option that changes the least player-visible behavior, record it in DECISIONS.md with "chosen in Matt's absence" and the reason, and continue.
- Findings close in REVIEWS.md with `Closed 2026-09-2x: <test name>` as each package merges, not at the end.
- Commit after every merge. Push in small pieces early (gotcha 2026-09-24), refspec written as `"${sha}:refs/heads/audit-fixes-2026-09-25"`.

## Sequence
1. Wave 1: P1, P2, P4, P5, P7 in parallel.
2. Wave 2 as slots free: P3 (after P1 merges), P6a, P6b, P8, P5b (after P5 merges).
3. Fix review: one `reviewer` re-runs every probe under `docs/reviews/audit-2026-09-25/probes/` against the branch and reports which findings' evidence is met; then `itworks:checkpoint` on the whole diff with lenses real-data and testing. Anything it finds is fixed on the branch the same way (one fix, one test) before going on.
4. Closeout: `itworks:closeout` on the branch. One full test run, typecheck, build, the nginx-container console grep from the gotchas, the rollback rehearsal. Save format is v6 after P3; stamp the version (0.5.0) and SHIPPED.md.
5. Merge to main, tag `ship-2026-09-2x`, deploy the way 0.4.10 was deployed (deploy notes in `deploy/` and the last SHIPPED.md entry). Then push main in small pieces.
6. Do not offer or perform the itworks.build wall publish (standing rule: needs an explicit per-publish yes).
7. Finish with a closing note in `docs/reviews/` and a HANDOFF.md refresh: what shipped, which findings closed, which stay open (the three device-only ADVISORY items at least), and the exact device steps for those.

## Stop conditions (the only ones)
- A CRITICAL cannot be closed with a test that fails when the fix is reverted. Do not ship; report which one and why.
- The full test run, typecheck or build fails after two fix attempts on the branch. Do not ship; report.
- The deploy verification fails (the console grep or the live load). Roll back per `deploy/README.md`, report.

## Progress, session of 2026-09-25 afternoon
- Runner: nothing runs on the Mac. Tests run on pi2 (x86_64, 8 cores) in a node:26-bookworm-slim container with the tree mounted at the Mac's absolute path, through the session runner script (rsync of the tracked and untracked tree minus WAVs and PNGs, vitest, tsc, vite-node probes, and mutation patches applied in a sibling copy). Recorded in MAP.md under Environment.
- P2b, P5b and P6a merges verified: typecheck clean, their 15 touched test files green (282 tests). The seven IMPORTANT and sixteen ADVISORY lines those packages and P7 had fixed but never closed are closed in REVIEWS.md on their named tests.
- Matt's rule recorded in DECISIONS.md: no finding stays open at ship at any severity; device-step items get a fix and a test and close on that; verification-only findings get their probe run before the ship.
- The built site served by the deploy nginx.conf in a container on pi2 mounts the game under the live CSP with no Refused or unsafe-eval console lines.
- In flight: P8 (nine test guards with mutation proofs), the real-browser probe for line 294 and the phone-width News screenshot for line 354, both on pi2.
