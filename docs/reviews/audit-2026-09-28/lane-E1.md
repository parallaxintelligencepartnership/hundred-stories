# Lane E1: UI shell, panels, build tools and controls at 0f05723

Host arm64 (uname -m). Checkout /private/tmp/.../scratchpad/audit-0f05723 (the read-only copy). Probes are in scratchpad/audit-2026-09-28/probeE1/ and run with `npx vitest run --config <probeE1>/probe.config.mjs --disableConsoleIntercept <file>` from the checkout.

## Suspicions

### S1. "Expected profit" in Finances is not the profit the settle then reports (proposed: IMPORTANT)
- Where: src/ui/panels.ts:1000 (`amount: forecast.rent - forecast.upkeep`). The settle's profit is at src/sim/economy.ts:182-185 (`net = sum(incomeByKind) - upkeep - losses`).
- Input: any tower that earns during the quarter (shops, fast food, hotels, condos) or loses money to trouble. Open Finances before the settle.
- Wrong outcome: "Expected profit" counts only office rent less upkeep. It leaves out the income and losses already booked this quarter, even though the panel lists them one section above. The settle's own line counts both. A fast-food tower is shown "Expected profit -$10,000" at 10 PM. At 5 AM the News line says "profit $16,088". The panel's own test fixture has the same gap: tests/ui/panels.test.ts:476 pins "Expected profit -$30,000" beside "Shop +$5,000" and "Theft -$2,000", so the settle would report -$27,000. The label should match the settle, or it should say what it covers.
- Reproduce: probeE1/profit.vt.ts prints `Next settle, 5 AM tomorrow [...{"label":"Expected profit","amount":-10000}]`, then `settle net 16088`, then `The quarter is over. Earned $26,088, spent $10,000 on running costs, profit $16,088.`

### S2. The room panel's office rent reads the midday rating, not the rating the settle pays on (proposed: IMPORTANT)
- Where: src/ui/panels.ts:910-911 (`officeQuarterRent(room)`, which defaults to `room.eval`, the last hourly evaluation, stress included). Compare src/sim/economy.ts:91: the forecast uses `evaluateRoom(world, room, 0)`, and the settle uses the 04:30 eval. This follows the 2026-09-28 ruling that rent is set by the resting rating.
- Input: an office tower in the working day, with stressed tenants. Open an office.
- Wrong outcome: each office shows "$7,060 per quarter now". Finances forecasts $10,000 for each, and the settle credits $90,000 for 9 offices ($10,000 each). The review's I-2 fixed this same misreading in the forecast but left it in the room panel. A player tuning rent from the room panel sees a number the game never charges. A vacant office also shows "$10,000 per quarter now" even though it pays nothing (panels.ts:910 never checks `room.vacant`).
- Reproduce: probeE1/officerent.vt.ts prints `room panel lines: $7,060 per quarter now | ... (x9)`, `forecast office rent 90000`, `settle credited office 90000`.

### S3. Elevator panel refusals are only in a tooltip, so a touch player never sees why (proposed: IMPORTANT)
- Where: src/ui/panels.ts:884-887 (`offerReach` disables the button and puts `result.reason` in `title` only). The same pattern is at 807-817 (car range steppers), 831-836 (Add car and Remove car) and 819-821.
- Input: on a phone, open a standard elevator that already spans 30 floors, then tap "Extend up". Or tap "Extend up" under a floor that has a room on it.
- Wrong outcome: the button is disabled, and the sim's reason ("Elevators can span only 30 floors.", "Something is already there.", "An elevator is in the way.") sits in a `title` that touch screens never show. The tap does nothing and says nothing. This breaks the lane invariant that a refused command reaches the player as its reason string.
- Reproduce: code trace from shaftPanel refresh (panels.ts:837-838) to offerReach. The reasons are in canExtendShaft (src/sim/build.ts:646-668). Nothing in panels.ts writes a visible note for them.

### S4. The cash readout keeps the old rent after a rent change while paused (proposed: ADVISORY)
- Where: src/ui/status.ts:390-398. The cache key is `minute|structureVersion`. `room.setRent` (src/sim/build.ts:850-860) does not move structureVersion.
- Input: an offices-only tower. Pause, open an office, press + until 150%.
- Wrong outcome: the pill still reads "$10,000 rent at 5 AM in 2 days", while Finances shows +$12,750. It corrects itself one game minute after unpausing.
- Reproduce: probeE1/statusrent.vt.ts prints the same meta before and after the change, and `finances next: {"label":"Office","amount":12750}`.

### S5. Watch mode: a restore press whose release never arrives takes the next real release of the mouse (proposed: ADVISORY)
- Where: src/ui/watch.ts:195-197 and 209-211. `swallowPointer` is cleared only by a matching pointerup or pointercancel. A new pointerdown clears the click grace (line 187) but not `swallowPointer`.
- Input: while watching, press the mouse without moving it first, with the release lost. For example, right-click the clock, which stays visible: on macOS the native menu eats the release. Then left-click the tower. A mouse's pointerId is always 1.
- Wrong outcome: the tower's pointerdown gets through, but its pointerup is swallowed. The renderer (src/render/renderer.ts:2520-2535) keeps `dragPointer` and never picks, so the build click is lost and the view follows the mouse with no button held until the next click.
- Reproduce: probeE1/watch.vt.ts prints `next real press stopped false its release stopped true`.

### S6. A refused command inflates the next warning toast's count (proposed: ADVISORY)
- Where: src/ui/ui.ts:1465-1469 (every warn line counts, including the refusal logged during `act`); 1504 returns without resetting `warns`. onWorld (944-967) never resets `warns` or `giveUps` either.
- Input: press Build with too little cash (refused, said once as a notice). Later one person gives up waiting.
- Wrong outcome: the toast reads "2 problems in the tower. Tap for the news." for one problem, instead of the give-up line. After a world swap, the count carries lines from the tower that was left.
- Reproduce: code trace. `act` sets `acting`, game.apply logs the warning and notifies, and refreshNews sets `warns=1` and returns at 1504. The next give-up line makes count 2 with `onlyGiveUps` false (1490-1499).

### S7. Leftover jargon and literals in player text (proposed: ADVISORY)
- status.ts:198 "Paused, night x8" (the running form was made plain, but this one was left; pinned at tests/ui/status.test.ts:178).
- watch.ts:44 WATCH_TIP says "after 5 seconds" as a literal. It is not built from WATCH_IDLE_MS, which already moved once, from 20 s to 5 s.
- keys.ts:138 "(pause, 1x, 2x, 4x)" is a literal copy of SPEED_STEPS.
- Reproduce: grep the lines above.

## Questions for the owner
- ui.ts:888 writes `?seed=<n>` into the page address for Friend's tower. The 2026-09-24 ruling keeps the number reachable in the address. Is the word "seed" in a visible address bar acceptable under "player-facing text never says seed"?
- After game over, Finances still titles its list "Next settle, 5 AM tomorrow" and the pill can still say "rent at 5 AM ...", but tick() never settles again. Should a dead tower drop those lines?

## What the tests do not prove
- tests/ui/panels.test.ts: "Expected profit" is checked only against its own formula (476), never against the settle's net, which is how S1 was baked into a fixture. rentMoneyText is only matched against a regex (373), never against the forecast or a vacant office. No test covers a disabled shaft or car button showing its reason visibly.
- tests/ui/status.test.ts: the rent-due cache is never exercised across a non-structural change at the same minute (S4).
- tests/ui/watch.test.ts: every restore press gets its release. No test covers a lost release, or a later press with the same pointerId (S5).
- tests/ui/news-toasts.test.ts and refusal-once.test.ts (describe lines read): the refusal is shown once, but the warn counter it leaves behind is not tested (S6).
- tests/sim/economy.test.ts: the forecast matching the settle is proven only for offices at rest with no stranded night worker.

## Coverage
- Read in full: src/ui/ui.ts, panels.ts, status.ts, sheet.ts, build.ts, palette.ts, layout.ts, display.ts, controls.ts, keys.ts, gamepad.ts, haptics.ts, prefs.ts, toast.ts, icons.ts, format.ts, watch.ts, quiet-labels.ts, sound-toggle.ts; src/sim/economy.ts, src/sim/evaluation.ts, src/sim/tick.ts (to check the forecast and the settle). The Lane E1 section and lane-independent rules of .itworks/LANES.md; .itworks/DECISIONS.md; MAP.md Gotchas; docs/reviews/audit-2026-09-25/lane-E1.md and verify-E.md; docs/reviews/economy-review-2026-09-28.md.
- Read in part: src/render/renderer.ts:2455-2640 (pointer handlers); src/sim/build.ts (setRent, canExtendShaft reasons, extend); tests/ui/watch.test.ts setup and swallow tests; tests/ui/panels.test.ts finances blocks; tests/sim/economy.test.ts forecast block.
- Skipped: none in scope.
- Checked, and the fixes from 2026-09-25/26 hold: old alerts reset on world swap (ui.ts:958-960); prefs keep a session copy under blocked storage (prefs.ts:59-110); refusal said once (`acting`, ui.ts:1504); Space on a button and keys behind a modal sheet (1837-1839); pad A behind a sheet (1673-1677); "Vibration" and touch help with the Build step; the follow limit built from the cap. nextSettleWords is right at 04:59, 05:00 and 05:01 (the settle runs in the tick that starts at 300). The share preview URL is revoked through sheet.unmount calling node.remove. innerHTML appears only with static SVG constants (icons.ts:130, controls.ts:119, 130).
- Probes run:
  - `npx vitest run` on the 12 named lane files plus watch, quiet-labels, toast and sound-toggle: 16 files, 227 of 227 pass.
  - probeE1/profit.vt.ts: S1 confirmed.
  - probeE1/officerent.vt.ts: S2 confirmed.
  - probeE1/statusrent.vt.ts: S4 confirmed.
  - probeE1/watch.vt.ts: S5 confirmed at unit level. The browser trigger (a lost release) is argued, not captured.
  - grep for UK spellings and "seed" in player strings in scope: only ui.ts:888 (see Questions).
