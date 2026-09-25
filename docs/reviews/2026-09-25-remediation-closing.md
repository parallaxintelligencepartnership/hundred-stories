# Remediation closing note, 2026-09-25

0.5.0 is live at https://hundredstories.xyz (tag `ship-2026-09-25`, merge `6027d25` on main, Cloudflare version `994e5173-dcba-4b0f-a50e-05b99d255c1c`). This note closes the run the kickoff note opened.

## What shipped
- Packages P1 to P8 from the remediation plan (every audit finding: 9 CRITICAL, 30 IMPORTANT, 52 ADVISORY at 7b4e60f), each closed in `.itworks/REVIEWS.md` on a named test that fails when the fix is reverted.
- The fix review (`docs/reviews/audit-2026-09-25/fix-review.md`): every audit probe re-run on the branch, 41 of 46 mutations red in their guards, five of six CRITICAL reverts red. Its two exceptions became P11 (a save asked for during a running save is now run after it; the office-reach test now catches a missing lease check).
- The checkpoint over the whole diff (lenses real-data and testing) became P9, P9b and P10: the kept copy of a replaced daily can be saved to a file, the save rollback guard uses a sequence number instead of the wall clock, chronicle counts no longer depend on how many people are followed, loader field codes never reach players, the stranded scenario respects the stop-off rule, two slow tests have timeouts, the precache guard covers the site chunks.
- The closeout sweep (five lenses, dependency vetting, history audit, all on Opus reviewers) became P12, P12b and P13 plus doc and deploy fixes: the save format stays 5 so a rollback to 0.4.10 keeps every tower; a failed storage read never starts a tower over the save, with a first-visit marker so newcomers are not shown the notice; a file opened from Friend's tower lands in My tower; a bankrupt tower shows a card; the Build button's disabled state is guarded; the fallback nginx serves the 404 page; `npm run deploy` runs a static gate for the CSP and the PixiJS shim; two stale landing test sentences follow the page.
- Version stamps 0.5.0 in every manifest (Android versionCode 500), `SHIPPED.md` rewritten, `PROJECT.md` data line names the shell save files.

## How it was verified
- Nothing ran on the Mac. A session runner synced the tree to pi2 (x86_64, 8 cores) and ran vitest, tsc, vite-node probes and mutation patches in a `node:26-bookworm-slim` container with the repo mounted at the Mac's absolute path (so probes importing `src/` by absolute path work). Recipe in `.itworks/MAP.md` under Environment.
- Final tree: 144 test files, 1705 tests (1700 pass, 5 skipped, the opt-in store screenshot run), typecheck clean, build clean, pre-deploy gate ok.
- Browser: the built site served by `deploy/nginx.conf` in a container on pi2 mounts the game under the live CSP with no refusals; a dev harness drove a VIP with no suite, a theft with no guard and a dismissed fire card in real Chromium with 0 errors (`browser-probe.md`); the News panel fits a 390 by 844 phone (`news-phone.png`, the one screenshot taken).
- Rollback rehearsed on pi2: `ship-2026-09-24b` built and served from a separate copy, the game mounted. The rollback probe proved a 0.5.0 tower loads on the 0.4.10 code with all rooms.
- Live after deploy: `/`, `/play/` 200 with the five headers, `/nope` 404, http 301 to https, the live play bundle is the tested one, the game mounts from pi2's headless Chromium.

## What stays open
Nothing. No finding is open at any severity and no risk is accepted (Matt's rule, recorded in `.itworks/DECISIONS.md` on 2026-09-25). Three device checks are extra verification, not open items: the phone GPU on shafts of 57 floors and more (textures now stacked under 8192 px), the iPhone audio session after a resume, and Cmd+A on a Mac keyboard (a harness proves it does not pan, and a blur clears held keys).

## Lessons recorded
- A screenshot is evidence only when a finding names one; the browser probe's spec asked for one per event and Matt stopped it. Memory and MAP updated.
- The plan said "save format moves to v6" for one optional field; the closeout showed that breaks rollback. The rule now: a format bump ships only when the rollback target reads it.
- Pushes to the Gitea origin still cut at 60 s; pushing main in pieces of three commits worked.
