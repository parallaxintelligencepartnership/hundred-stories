# Lane A: Simulation core and the build log at 0f05723

Host arch: arm64 (uname -m). All reading and probes ran in the read-only checkout; the mutation and event-rate probes ran in throwaway copies under scratchpad/laneA/. The 2026-09-25 lane A fixes held: basement support reasons (S4), multi-floor basements hanging from the floor over their top (S3), plurals (S7), the negative money format (S8), the officeRentEvalScale flag (S9), car ranges refusing floor 0 (S6), and the demolish guards for burning and bomb rooms (S1, S2). I checked each against the code and the tests, and none is raised again.

## Suspicions

### S1. A basement with nothing over it is told to "Build under it first" (proposed: IMPORTANT)
- Where: src/sim/build.ts:417-418 (a single sentence for every restsOnStructure refusal). The test locks it in: tests/sim/build.test.ts:956 (with AIR defined at :879).
- Input: a lobby on floor 1 at x 100 to 105 and a parking space on B1 at x 200. Stars 5, cash is plenty. Then `canBuild(parkingSpace, -2, 250)`, or `canBuild(recycling, -3, 250)`.
- Wrong outcome: both come back `{ok:false, reason:"Nothing is holding this up. Build under it first."}`. Underground, the support a room needs is directly over it (decision 2026-09-24, "above it for basements"), so "under it" sends the player the wrong way. This is the same defect as last audit's S4, which was fixed only in noSupportReason (build.ts:234-238). The sibling sentence was left alone. src/ui/explain.ts:22-37 does not recognise this sentence, so the chip shows it as it is, with no second line to correct it.
- Reproduce: `npx vite-node@6.0.0 scratchpad/laneA/probes/p5.ts` from the checkout root. It prints the two refusals above, plus `ok:true` for B2 at x 202, which is under the B1 space. Fix direction: when floor < 0, say "Build the floor above it first."

### S2. Limits and rent bounds are stated twice, outside rules.ts (proposed: ADVISORY)
- Where: types.ts:8-10 (`TOWER_WIDTH`, `MAX_FLOOR`, `MIN_FLOOR`), which build.ts:21 and :115 enforce; rules.ts:123-125 (`LIMITS.towerWidth/maxFloor/minFloor`), which the player text in src/ui/explain.ts:96 and demo.ts:29 reads. Also build.ts:855, where the rent refusal hard-codes "50% and 150% in steps of 10%" instead of reading `RENT.min/max/step`.
- Input: change `LIMITS.maxFloor` or `RENT.max` in rules.ts.
- Wrong outcome: the rule the sim enforces and the sentence the player reads drift apart. This breaks the lane invariant "every number the logic uses comes from rules.ts". It does not misbehave today.
- Reproduce: `grep -rn "LIMITS.maxFloor\|MAX_FLOOR" src`, then read build.ts:855.

## Questions for the owner
- Demo box and the star ladder: a metro station is three floors tall and underground-only, so it needs B3 to B1. The demo box stops at B2 (DEMO_MIN_FLOOR -2), so a demo player can never build one. At office density (6 people per 9 tiles), 150 tiles over 19 floors holds about 1,900 people, well short of the 5,000 that 4 stars needs. The demo therefore tops out at 3 stars, while the 2026-09-22 line says "every feature open within the cap". The demo is shelved (2026-09-27) and its figures are settled, so this is not a finding. Is that ceiling intended for a possible Steam demo?
- These owner questions from 2026-09-25 are still open in REVIEWS.md and were not re-raised: a shaft counting as structure (lane A S5), and hotel population swings moving a star daily.

## What the tests do not prove
Mutations were run in a scratch copy against the seven lane test files.
- economy.test.ts:
  - `cash <= bankruptAtCash` in place of `<` survives. Nothing tests cash at exactly -$500,000.
  - `nextSettleMinute` with `<` in place of `<=` survives. Nothing tests the settle minute itself, which would then read "in 3 days" at the moment the settle runs.
  - Dropping the rent scaling from `recordCondoSale` survives.
  - The settle is never run through a save and load at 05:00 in these files.
- stars.test.ts: a fall capped at one rank per call (`if` in place of `while`) survives, because every fall test drops exactly one rank. Nothing covers a rise after a fall, or hotel occupancy.
- build.test.ts:
  - economy and events are mocked, so the real spend path is exercised only in economy.test.ts.
  - The demolish guards for burning and bomb rooms (build.ts:524-529) survive deletion in these files. tests/scenarios/demolish-threats.test.ts covers them outside the lane.
  - Most refusals are checked for cash and room count, not the world hash (only I S2 checks the hash).
  - Nothing covers a basement refused for lack of structure above (S1), and the test at :956 asserts the wrong text.
- replay.test.ts:
  - Three days at 1 star. No fire, bomb, helicopter or ransom is replayed, and no log goes through the real demo cap.
  - Deleting the `check.n < n` skip in replay.ts walk survives (dev tool only, decision 2026-09-28).
- demo-cap.test.ts: edges are spot-checked only. My exhaustive probe (below) found no gap in the code.
- baselines.test.ts: covers only the two display baselines, which is all it is for.

## Coverage
- Read in full: src/sim/types.ts, rules.ts, rng.ts, world.ts, tick.ts, build.ts, economy.ts, evaluation.ts, stars.ts, buildlog.ts, replay.ts, scripts/replay.ts; tests/sim/build, economy, stars, replay, replay-start, demo-cap and baselines .test.ts. Also docs/reviews/audit-2026-09-25/lane-A.md, verify-A.md, docs/reviews/economy-review-2026-09-28.md, DECISIONS.md, MAP.md Gotchas, and LANES.md lane A plus the lane-independent rules.
- Read for context (partial): events.ts fire, bomb, VIP-close and command sections (95-345, 440-560, 900-1010); save.ts serialize, deserialize, stats validation and hashWorld; elevators.ts stopOffRefusal; game.ts commit, freshTower and newGame; ui/explain.ts refusalKind.
- Skipped: none in scope.
- Probes run:
  - The lane vitest recipe (7 files): 184 of 184 passed.
  - The lane grep for Date, Math.random, performance, window and document, plus pixi, Intl, toLocale and import.meta, over src/sim: comments only; a local variable named `window` in chronicle.ts; `toLocaleString('en-US')` in log text only, which is not hashed; the EDITION and MODE reads. Clean.
  - p2.ts (copy with the fire and bomb daily chance raised to 0.3, start cash $300M): 30 game days, 3 stars, with fires, helicopter calls, ransoms paid, a security build and refunded demolitions. A continuous run against a save-and-load every 613 minutes gave equal hashes every day (final 8c52ba39). verifySave returned match over 328 entries and 72 checkpoints.
  - p3.ts (VITE_EDITION=demo): 46,074 canBuild and canBuildShaft cases across every kind, floors -10 to 100 and the x edges. Zero cases where the box refused something inside it or accepted something outside it.
  - p4.ts: a fuzz of 60 seeds x 3,000 random build, demolish, shaft, extend and car commands (about 92,000 accepted). Zero refusals that changed the hash or cash, zero cash mismatches against the price and the 25% refund, zero built rooms not held up, and zero demolitions that stranded a room.
  - p1.ts: removing every stop of a shaft during the morning rush. No sim was left waiting or riding for good; the tenants left. Nothing to report for lane A.
  - p5.ts: reproduced S1.
  - mutate.mjs: 17 mutations. 11 killed, 6 survived (listed above).
