# Verification of lanes E1 and E2 at 0f05723

Checkout audit-0f05723 (HEAD 0f05723), arm64 (uname -m). I re-ran the reviewers' probes (probeE1/ with 4 files and e2-0928/ with 5 files) and got the same output. My own probes are in scratchpad/verifyE/ (s3, s6, vipreal, share) and run with `npx vitest run --config <verifyE>/probe.config.mjs --disableConsoleIntercept <name>` from the checkout. No overlay was needed. I read DECISIONS.md and the economy review in full, and read every code path cited below.

## Verdicts: E1

### S1. "Expected profit" leaves out income and losses already booked this quarter - PARTIAL (final: ADVISORY)
- Reproduction: probeE1/profit.vt.ts on a fast-food tower at 10 PM prints `Next settle ... "Expected profit", -10000`, with the so-far list showing `Fast food +26052`. The settle then prints `net 16088` and "profit $16,088".
- Definition: the economy review never defines "Expected profit". Its I1 asks only for upkeep to be itemized. The code's own contract defines the forecast as the settle's rent and upkeep lines only: economy.ts:126-130 says "income earned during the quarter (shops, hotels, condos) and event losses are not in it". The fix commit 24b0ed4 says the same ("quarterForecast ... expose the next settle"). So panels.ts:1000 computes exactly what was designed. There is no arithmetic defect.
- What holds: the label. The same word, "profit", means rent minus upkeep in the Next settle list, and income minus upkeep minus losses in the settle line and the "Profit last quarter" tile. For any tower with shops, food, hotels or condos, the two can have opposite signs. The workaround is on the same panel (the "This quarter so far" list), so this is ADVISORY, not IMPORTANT.
- Fix spec: either rename the line to what it covers (for example "Rent less running costs"), or make it `forecast.rent - forecast.upkeep + sum(incomeByKind) - sum(lossesByKind)`, which is what the settle will report if nothing else happens. Test: the tests/ui/panels.test.ts fixture at :476 (Shop +$5,000, Theft -$2,000, pinned "Expected profit -$30,000") must fail before and pass after, asserting either the new label or -$27,000. Must not change: quarterForecast, the settle, the status pill's rent-due line.

### S2. Room panel office rent uses the stressed midday rating - CONFIRMED (final: ADVISORY, lowered)
- Reproduction: probeE1/officerent.vt.ts, with tenant stress forced to 1 at 12:30, prints `$7,060 per quarter now` (x9), `forecast office rent 90000`, `settle credited office 90000`. The trace matches: panels.ts:911 calls `officeQuarterRent(room)`, which defaults to `room.eval` (economy.ts:39). The forecast and the settle rate the office at rest (economy.ts:91, tick.ts:16 at :30, with the 04:30 eval before the 05:00 settle). This contradicts the DECISIONS line of 2026-09-28: "office rent is set by the office's resting rating at the 5 AM settle (stress decayed...); slow elevators cost you through tenants leaving, not through a rent cut". A vacant office also shows "$10,000 per quarter now" (panels.ts:910 never reads `room.vacant`). It does show the "Empty" flag beside it.
- Severity: the number is wrong, but Finances shows the true figure, so there is a workaround. That makes it ADVISORY.
- Fix spec: in rentMoneyText, use `officeQuarterRent(room, evaluateRoom(world, room, 0))`, which means passing the world in. For a vacant office, show "No rent until leased" or similar. Test: a room-panel test with stressed tenants expects the resting-rate figure equal to `quarterForecast(world).rentByKind.office`. It fails today with $7,060 against $10,000. Must not change: the settle, or the rent stepper's percent.

### S3. Elevator panel refusals are only in a tooltip - CONFIRMED (final: IMPORTANT)
- Reproduction: verifyE/s3.vt.ts opens the shaft panel through createQueryPanel for a standard elevator spanning floors 1-30. It prints `Extend up disabled true title "Elevators can span only 30 floors."`, `visible text with the reason: []`, `notices []`. A disabled button fires no click, so `ctx.notice` is never reached. The same pattern: Add car at max (panels.ts:831-834), Remove car at one car (835-836), the car range steppers (807-817), and Every floor (820-821). By contrast, palette.ts:5 deliberately uses aria-disabled so a locked tile can still explain itself.
- Severity: touch is a supported platform (DECISIONS 2026-09-19, touch-capable /play/). The rubric's "a refusal with a wrong or missing reason" puts this at IMPORTANT.
- Fix spec: keep these buttons tappable when refused, using aria-disabled plus the disabled style, and on tap call `ctx.notice(result.reason)` instead of applying. Alternatively, write the reason into a visible hs-note under the actions row. Test: s3-style panel test. Tap Extend up on a 30-floor elevator and expect one notice "Elevators can span only 30 floors." (fails today: no notice). Repeat for Add car at 8 cars. Must not change: the reasons' wording (build.ts:646-668), and the enabled paths.

### S4. Cash pill keeps the old rent after a rent change while paused - CONFIRMED (final: ADVISORY)
- Reproduction: probeE1/statusrent.vt.ts prints `$10,000 rent at 5 AM in 2 days` before and after `room.setRent 150` at the same minute. Finances shows `Office 12750`. The cause is the cache key `${minute}|${structureVersion}` at status.ts:391, while setRent does not bump structureVersion. It corrects itself one game minute after unpausing.
- Fix spec: add a rent signature to the key (the sum of office rents or a rent version), or bump a counter in setRent. Test: the probe as a status.test.ts case, expecting "$12,750 rent" after the change. Must not change: the one-forecast-per-minute budget.

### S5. Watch mode: a restore press with a lost release takes the next real release - PARTIAL (final: ADVISORY)
- What holds: probeE1/watch.vt.ts prints `next real press stopped false its release stopped true`. watch.ts:196 sets swallowPointer, which only a matching pointerup or pointercancel clears (209-210). A new pointerdown clears only the click grace (187). renderer.ts:2530-2535 then never sees the release, so `dragPointer` stays set.
- What is unverifiable here: whether a real browser drops the release (a right-click on the clock opening the macOS context menu). Settling it needs a manual step: Chrome on macOS, Watch on, wait 5 s, right-click the clock, dismiss the menu, left-click a tile with a tool in hand. The room should build.
- Fix spec: on a new pointerdown, clear swallowPointer before `input()` (a fresh press is the player's own). Test: the probe's scenario expecting `u2.stopped === false`. Must not change: the existing swallow tests in tests/ui/watch.test.ts.

### S6. A refusal inflates the next warning toast's count - CONFIRMED (final: ADVISORY)
- Reproduction: verifyE/s6.vt.ts uses the refusal-once harness. Without a refusal, a single give-up line toasts its own sentence. After a refused Add car, the same single give-up line toasts `"2 problems in the tower. Tap for the news."`. The cause is ui.ts:1465-1469, which counts every warn line (the refusal included), while 1504 returns without resetting. The Watch early return (1478) and onWorld (944-967) also leave `warns` and `giveUps` untouched.
- Fix spec: do not count warn lines logged while `acting`, or reset `warns`/`giveUps` at 1504 and in onWorld. Test: the s6 probe as a news-toasts test, expecting the give-up sentence after a refusal. Must not change: the refusal-once behavior, and the folding of real bursts.

### S7. Leftover jargon and literals in player text - PARTIAL (final: ADVISORY)
- What holds: status.ts:198 "Paused, night x8" and keys.ts:138 "(pause, 1x, 2x, 4x)" are symbol shorthand. The speed buttons themselves were rewritten as "two times as quick" (ui.ts:353-356), and the running form as "Night: 16 times as fast", per the DECISIONS lines of 2026-09-24 on plain words and a reader of 8 to 10.
- What does not hold: WATCH_TIP "5 seconds" (watch.ts:44) and the keys literal match today's values (WATCH_IDLE_MS 5_000, SPEED_STEPS [0,1,2,4] at keys.ts:91). No player sees a wrong number today, so those are code smell only.
- Fix spec: "Paused. At night the clock runs 8 times as fast." Build the tip and the keys line from the constants. Update the pin at tests/ui/status.test.ts:178.

## Verdicts: E2

### S1. The VIP checklist shows all done after a fire or bomb has doomed the visit - CONFIRMED (final: ADVISORY)
- Reproduction: e2-0928/vip.probe.ts matches the reviewer's output. The reviewer's real-play path is wrong, though. A stay lasts 600 minutes from a check-in between 8 and 17 h, so it ends by about 03:59 and never covers the 06:00 roll. A real path does exist, shown by verifyE/vipreal.vt.ts (seed 6, VIP arriving at 10:00, no security, a bomb from the arrival day's 6 AM roll). It prints `phase stay now 781 bomb live false incident true`, `checklist [true,true,true,true]`, `lastVip rating poor incident true`. The bomb goes off at 13:00, during the stay. From then until checkout the card says all ready, while the rating is already poor. The cause is vip.ts:99 reading the live events, while events.ts:534/549 set the sticky `incident`.
- Fix spec: for phase route or stay, make the fourth item `done: !incidentActive(world) && !visit.incident`, with a label such as "No fire or bomb during the visit". Test: vipreal as a vip.test.ts case, expecting item 4 false once `visit.incident` is true. Must not change: the notice-phase behavior (a fire before arrival does not doom the visit).

### S2. The first-tower guide stays on "Add an elevator" when stairs reach the office - CONFIRMED (final: ADVISORY)
- Reproduction: e2-0928/guide.probe.ts prints `office vacant false tenants 6 population 6` and then `step after 2 {"title":"Add an elevator"...}`. The none.probe.ts control prints `vacant true tenants 0`. far.probe.ts (a shaft outside the lobby) prints step 4. The cause is onboarding.ts:93-102, which checks only `world.shafts`, while :119 blocks the later steps. No DECISIONS line makes the elevator step mandatory. Skip is the workaround.
- Fix spec: let step 2 pass when `anyTenants(world)` or when findRoute reaches an office from the lobby door, the way vip.ts:72-78 does. Test: an onboarding test with a stairs-served leased office expecting step ≥ 3. Must not change: the step order for the elevator path.

### S3. "1 floors · 1 people" on the share image - CONFIRMED (final: IMPORTANT, raised)
- Reproduction: verifyE/share.vt.ts stubs a 2D context and captures the band text `"1 floors  ·  1 people  ·  ★"` (share.ts:131). One floor is any lobby-only tower, so this is common early on.
- Severity: the same wording was rated IMPORTANT under the rubric's text line at the 2026-09-25 verification ("1 people" in the greeting). It stays consistent with that here.
- Fix spec: singular branches for both nouns, sharing a helper with shareText (:42) and challenge.ts:34. Test: a share.test.ts case with the stubbed context expecting "1 floor  ·  1 person". Must not change: the plural at 2 and above.

### S4. "a 0-floor tower with 0 people" in the share message - CONFIRMED (final: ADVISORY)
- Reproduction: the same probe prints `I'm building a 0-floor tower with 0 people in Hundred Stories...` for an empty lot or a basement-only tower (shareStats counts above ground only, share.ts:29-35). challenge.ts:33 already says "just started a tower" for the same link. The text is grammatical, but awkward.
- Fix spec: when floors is 0, say "I just started a tower in Hundred Stories...". Test: shareText at floors 0. Must not change: the URL, which still carries floors=0 (parseChallenge accepts it).

### S5. Folded Watch and Sound labels do not return on wheel or trackpad zoom - CONFIRMED (final: ADVISORY)
- Reproduction: e2-0928/quiet.probe.ts prints `listened pointermove,pointerdown,keydown` and `quiet after wheel true`. watch.ts:34 counts 'wheel' as input. quiet-labels.ts:17 does not. Its own header (:5) lists only "pointer move, press or key", yet says "Any input takes the class off". Hover still brings a word back (ui.css), so the effect is cosmetic.
- Fix spec: add 'wheel' to INPUT_EVENTS (passive, as now). Test: a quiet-labels test that fires a wheel event and expects not quiet. Must not change: passivity (it must never prevent a zoom).

## Duplicates
- None found. A grep of the other lane reports for each cited function and string found no overlap.

## Notes
- New suspicion (ADVISORY, a variant of E1 S6): while Watch is on, ui.ts:1478 returns before the fold. Every warn line counted during a watch stays in `warns` and inflates the first toast after the chrome returns. Reproduce with the s6 harness, with the shell class `is-watching` set during two give-up lines, then removed before a third. Expected "3 problems" where 1 is new. Traced, not run.
- E1 Questions for the owner (the `?seed=` address and the dead tower's settle lines) are owner questions. DECISIONS 2026-09-24 keeps the number in the address "for testing", so the word "seed" there is settled, not a finding.
