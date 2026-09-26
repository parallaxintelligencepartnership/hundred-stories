# Design pass implementation, progress note

Paused the night of 2026-09-25 on Matt's word (session usage). Resume in a fresh session from this file. The run is Matt's 2026-09-26 authorization: packages P1 to P9 of docs/reviews/2026-09-25-design-pass-report.md, no questions except a genuine fork, no ship, push or deploy, stop after the P9 checkpoint and report.

## How the run works

- Finding bundles per package, the constraints from the brief's section 4, the implementer rules and the reviewer rules live in the session scratchpad, which is gone. Rebuild them from the report (each `### D-n` block verbatim, plus the package's bold bet blocks, plus brief section 4) before delegating; the split is one awk over the report.
- One `senior-implementer` per package works in the main checkout, never commits; one `reviewer` per package checks every Verify field against the retaken shot or a measurement; one `reviewer` runs the itworks testing lens per committed package in a scratch worktree at that commit (the tree is always dirty with other packages). At most five agents.
- The orchestrator commits by explicit path only, one commit per package, never `git commit -a` (that mistake happened once tonight and was undone; see the memory note).
- Shots: only the retake list in the report's section 6 row, taken by `node scripts/make-design-sheet.mjs --only <names> --out docs/reviews/design-pass-2026-09-25/<PKG>-after`. Before shots are in `baseline/` (the original sheet plus three click-free shots at 8dae179). The whole `design-pass-2026-09-25/` folder is gitignored.
- Tests: touched test files only per package; the full suite and typecheck once at the end.

## Committed on main (nothing pushed)

| Commit | What |
| --- | --- |
| be47563 | P1 first frame: D-1, D-2, D-3 (CSS in P4), D-11, BB-1; wheel: one notch moves one stop |
| adab4f9, d4b0d53, 7741ad9, d951335 | sheet script: --only, --out, --textures, isolated builds, new shots, targets under the new opening, pause before the first tick, seed guard |
| fe7f65a, 09d0449, ea4310e | P4 chrome: D-19 to D-28, D-23 part 4, BB-5 watch mode; site amber tokens; tests per open state |
| 93609f1, plus tests in the P2 checkpoint close | P2 daytime read: BB-3 (no day panes), D-7, D-12, D-13, D-23 parts 1 to 3 |
| f464377, plus the P7 test close | P7 front door: D-34, D-35 (buildHeroWorld), D-36, D-37 (48 px favicon), D-42 |
| itworks commits | checkpoints for P1, P4, P2, P7 in REVIEWS.md, all findings closed; last_checkpoint moves with each |

Checkpoints found and closed: P4 the site amber hunk left out of the commit (IMPORTANT), P2 two decorative tests, P7 the icon script's write guard untested (IMPORTANT) and the no-WebGL hero fallback untested.

## In flight when paused (WIP commits on main)

- P3 night, WIP b1af642: tests written first, source not started. Eight test files carry the cases for D-4, D-6, D-8, D-9, D-10, D-15, BB-2 and BB-4 (40 of 85 red until the source lands). On resume a senior-implementer implements against them; note tests/render/reconcile.test.ts reads the overlay root at stage.children[5] and D-4's stage order moves it to 6. Retake list: game-desk-z1-2300, game-desk-z1-1830, game-desk-zfar-2200 (the far stop is 0.175; 0.25 is not a snap stop). Print --textures after it (must stay at 6,324,096 bytes). Then reviewer, commit, checkpoint.
- P5 phone, WIP 51ec385: D-29 to D-33 done, tests 45 green, shots in P5-after, not yet reviewed. Pending: four rulings, then one retake to P5-after-2, reviewer, commit (amend or follow-up), checkpoint. Rulings: (1) is-building also while the placing bar is up, so the speed pill and Menu hide and return; (2) open goals and guide cards sit above the bottom-left cluster with a bottom inset of the cluster height plus 8 px; (3) the My tower button is icon-only at 390 px with its label kept; (4) the sheet close gets its own slot outside the scrolling tab row (padding alone fails: the tabs scroll under it; Homes spans 256 to 355 px and the close 338 to 382).
- P8 site system: nothing edited; the implementer had finished reading. Rulings for resume: D-39's specimens draw BB-3's rail and sill (what the game draws by day), not D-5's panes, since D-5's tokens were never added; D-40 needs 404.html to load theme-init.ts for the nav's Theme button and a `.hero-panel a` color rule so "Back to the lobby" reads in dark theme. Retake list: site-home-desk-light, site-guide-desk-light, site-404-desk-light. The Requests link stays until Matt confirms the email address.

## Not started

- P6 game feel (D-14, D-16, D-17, D-18): after P3 commits (render files). Retake game-desk-z1-1300-place at 0, 200 and 600 ms (the script's `place` state) and the listed tests.
- P9 records (D-43 to D-47): last. D-43 rewrites VISUAL.md's chrome, motion and type sections; also trim MAP.md under 60 lines (lint warning) and shorten the eleven long DECISIONS.md lines.
- Closeout of the run: full `npm test` and `npm run typecheck` once, the P9 checkpoint, then the report to Matt. No ship.

## Rulings made tonight (orchestrator, within the report's scope)

- Wheel: one notch moves one snap stop when the gesture travels at least half a notch (|ln(zoom/start)| >= 0.13); a gesture during a snap counts from the snap target; smaller travel settles to the nearest stop as before. Trackpad pinches no longer jump a stop.
- D-22: the collapsed goals card is one control (star, "Goals, N of M", chevron), no Show button, capped to the Share-to-Menu width.
- D-3 and D-25: pressed text and rings use --amber-text everywhere; --amber is the fill only. Keycaps sit on a solid --keycap plate (13.3:1).
- D-23 part 4: the hover card hides over the selection for mouse pointers only; touch unchanged. One cardLeft rule (two edges) shared by P2 and P4.
- BB-5: hidden chrome takes no clicks, the first input only restores, the idle clock restarts when something closes on its own, the hover card hides too.
- D-7: painted feature walls end at FLOOR_PX - SLAB_PX - 2 so the floor line shows.
- D-35: the formula is the spec (20:00 at 45 s); the fast food sits at 130 to 145 and shop 122 is dropped so nothing overlaps the shaft; walkers bounded per floor, 1.5 tiles in on the left; the tower centers only when it clears the panel by 24 px, else anchors 24 px right of it.
- D-37: at 64 px and below all panes are ink, 1 px stroke at 48 and below; a dedicated public/icons/icon-48.png is the favicon on every page.
- Texture budget: the smoke tower measures 6,324,096 bytes (1.619 of the 2026-09-23 baseline) at 8dae179, before any change, and identically after P1 and P2. The overshoot predates this pass; the pass has added no bytes. Flag it to Matt at the end; no package here is asked to reduce it.

## Open with Matt (not part of the pass)

- Cloudflare Email Routing for hello@hundredstories.xyz forwarding to hello@parallaxintelligence.ai: the agent launch was blocked by the auto-mode classifier (it needed the wrangler OAuth token from ~/Library). Options given: dashboard (two minutes), Matt runs the curl steps himself with `!`, or a permission rule then relaunch. The Requests link change (GitHub issues to the address) folds into P8 once he confirms the address.
- Ideas Matt raised: richer share links need a small Worker to serve a per-link og:image (free tier covers it); more daily twists need new sim knobs (only starting cash exists today). Both are their own decisions and packages.
- Analytics: Cloudflare zone analytics and the store consoles are the no-beacon answers; the Web Analytics beacon stays declined.

## Completed 2026-09-26

The run finished in the morning session under the same authorization. Every package is on main with its checkpoint closed in `.itworks/REVIEWS.md`; the state trims are in; the full suite ran once at 89670d1 (165 files, 2033 passed, 1 skipped, tsc clean).

| Commit | What |
| --- | --- |
| 9280b9c, d49b41a, ab9de42 | P3 night: D-4, D-6, D-8, D-9, D-10, D-15, BB-2, BB-4; two reviews, one fix wave; downtown as a faint haze at dusk and a field of warm lights at night, the far facade night graded, burning rooms unlit at any zoom |
| e5f5a67, 26b802e | P5 phone: D-29 to D-33; the bottom-left corner stacks when it does not fit (under 390 px, or Larger text), the sheet close in its own cell, star tap opens goals, minimap idle count from the pointer lift |
| 972e4a0, 368aa65, 7e0372b | P8 site system: D-38 to D-41; specimens drawn by the game's code, lazily after the hero's first frame; the hero's settled signal always resolves; two-tone focus rings |
| d49b41a | P6 game feel: D-14, D-16, D-17, D-18; sheet script: night-clear shot, place spot from the fixture, site shots wait for the hero |
| 89670d1, 98ac29f | P9 records: D-44 (store tower, og only with --og), D-45, D-46, D-47; MAP.md 58 lines, DECISIONS.md lines shortened, lint clean |
| 87a98a2 | docs/BRIEF-AGENTS.md: the review and capture discipline, permanent |

Not done: D-43, the VISUAL.md chrome, motion and type rewrite. The permission classifier refused the agent's write to that file and Matt's own permission is needed; the draft text and the list of chrome elements matched to the two verify shots are in the P9 agent's report. D-14's three placement frames could not be timed in this Chrome; D-14 stands on its tests, and by the 2026-09-26 rule no further capture mechanism is tried.

Texture budget: the demo tower measures 6,553,472 bytes (1.678 of the 2026-09-23 baseline, against a 1.6 cap that was already exceeded at 1.619 before this pass). No line in the pass bakes a texture; the extra 229,376 bytes over the 8dae179 measurement is one car door frame key that normal play always bakes and that the measuring window now catches. `--textures` lists every key since d49b41a. The overshoot predates the pass and is Matt's call.

Process: the run showed the review loop had grown to six or seven rounds per package. Matt's 2026-09-26 ruling ("cut the junk processes", "fix it permanently") is in `~/.claude/CLAUDE.md`, the reviewer and senior-implementer agent definitions, and `docs/BRIEF-AGENTS.md`: one review per package at its commit, advisories batched into one close, senior implementers decide within the finding, the capture script's fixed list is the only screenshot source.
