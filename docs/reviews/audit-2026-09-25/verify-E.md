# Verification of lanes E1 and E2 at 7b4e60f

Machine: arm64 (uname -m). DECISIONS.md read in full. The repo was not touched. My probes are in `scratchpad/verifyE/` (`*.vt.ts`, run with `npx vitest run --config scratchpad/verifyE/probe.config.mjs --disableConsoleIntercept <name>`). I re-ran both lanes' probes: e1probe/alerts-replay.ts, prefs-blocked.ts, refusal-twice.ts, and e2probe/alerts-switch, vip-stairs, copy. Each printed what its report says.

## Verdicts, lane E1

### E1 S1 = E2 S1. Old alerts replay as live cards after a tower switch, and a live fire or bomb card flips to "out" - CONFIRMED (final: IMPORTANT)
- Reproduction: s1.vt.ts uses the alerts.test.ts harness on tests/ui/fake-dom.ts, with a `world` getter swapped and then notified. That is what swapWorld/importSave followed by notify do (game.ts:385-397, 902-912, 965-975).
  - A. Short log to long log (logTotal 1 to 47, reloaded through serialize/deserialize). Before: `[]`. After: `["[hs-toast is-fire] ×Fire out, 1 room damaged", "[hs-toast is-bomb] ×You paid the $500,000 ransom and the bomb in the office on floor 3 was handed over.", "[hs-toast] ×The VIP checked out and rated the tower good."]`. The old tower has `events: []`, so all three cards are history. The VIP card stays until the player closes it.
  - B. Short-log tower with a live fire, then a long-log tower. Before: `["[hs-toast is-fire] ×Fire on floor 2Call a helicopter ($250,000)A security office puts fires out on its own."]`. After: `["[... is-fire is-collapsed] ×Fire out, 1 room damaged", "[... is-fire] ×Fire out, 1 room damaged", <bomb>, <VIP>]`. The fire is still burning in the tower that was left (`young.events` still has `fire`).
  - D. A tower with a live bomb card, then a longer tower. After: `["[hs-toast is-bomb] ×The bomb threat is over."]`.
  - C. The reverse (long log 48 to short log 3) is correct: the `total < lastLogTotal` branch runs, so the old cards clear and only the new tower's live fire card shows.
  - Real game (s3.vt.ts, second test): `createGame(9)` (logTotal 0) with `importSave` of an older tower (logTotal 49) produces the same three stale cards.
- Cause: onWorld (ui.ts:695-712) never resets `lastLogTotal` or the alert stack. drainAlerts (ui.ts:1145) resets only when the log count drops. Then `fresh = min(total - lastLogTotal, log.length)` treats up to 200 lines of a loaded save as new (save.ts:50 LOG_LIMIT = 200; E2's "2000" applies only to an in-memory world). If both towers have a live fire, sync (alerts.ts:286-290) also merges the new tower's rooms into the old incident's floors.
- Fix spec: in onWorld, set `lastLogTotal = world.logTotal`, then run `alerts.reset()` and `alerts.sync()`, so a new tower's live fire, bomb or theft still gets its card. Tests: A and B above must fail before the fix and pass after. C and alerts.test.ts must stay green. A save loaded mid fire must still show "Fire on floor N" with its button.

### E1 S2. Blocked storage: Larger text, Color-blind views and Haptics do nothing - CONFIRMED (final: IMPORTANT)
- Reproduction: s2.vt.ts mounts the real shell, opens Menu and clicks each switch. It runs twice: once with a `localStorage` getter that throws, once with a `setItem` that throws. Both print the same: switches `aria-checked=true`, page root classes `"hs-glass-clear"` only (no `hs-large-text`), renderer `setOverlayColorBlind` calls `[]`, `hapticsEnabled(): true`. Reduced motion does work (`is-reduced` is set). On reopen: `hs-large-text=false hs-color-blind=false hs-haptics=true hs-glass-clear=false`. See-through buttons is still in effect on the page but reads back as off. e1probe/prefs-blocked.ts prints `Larger text on the root: false | color-blind views: false | haptics enabled: true | switch reads back: null`.
- Cause: prefs.ts:64-71 drops a failed write. The header comment says "the choice lasts for this session only", but no copy is kept in memory. display.ts:21-26 and haptics.ts:48-50 read the value back from storage.
- Fix spec: prefs.ts keeps an in-memory map. setPref always writes to it. getPref returns the store's value when the read succeeds and is non-null, and the in-memory value otherwise. Test: with a throwing store, `setFlag(largeText, true)` must give `getFlag === true`, `watchDisplayPrefs` must toggle `hs-large-text`, and `setHapticsEnabled(false)` must make `hapticsEnabled()` false. It must not change: reads from a working store, or values stored in an earlier session.

### E1 S3. A refused Build shows the same refusal twice - PARTIAL (final: ADVISORY)
- Holds: s3.vt.ts runs the real `createGame`. A shaft panel "Add car" is pressed with cash 0 (the ctx.apply path). The first press shows both `[hs-toast is-notice] ×Not enough cash. Elevator cars cost $80,000.` and `[hs-news-toast] Weekday 1 6:00 AMNot enough cash...`. game.apply notifies before it returns (game.ts:756-761), so refreshNews runs while `lastNoticeText` still holds the old text. The Build bar path (ui.ts:381-384, confirmPending, then apply) is the same. e1probe/refusal-twice.ts shows it too.
- Does not hold: "repeating the same refusal alternates between once and twice". Presses 2 and 3 added no news toast. The duplicate check at ui.ts:1104 clears `lastNoticeText`, and then notice() sets it again to the same text. So only the first refusal, or the first one after a different notice, shows twice.
- Fix spec: set `lastNoticeText` before calling game.apply/confirmPending, or have refreshNews skip `warn` lines that a direct user action caused. Test: the first refused Add car must show exactly one card and no news toast.

### E1 S4. A parked outline survives Open a saved file and Go back to last save - CONFIRMED (final: ADVISORY)
- Reproduction: s4.vt.ts and s4c.vt.ts use the real game, a stub renderer, and a touch tap.
  - Room case: the parked office stays pending after `importSave`: `{"floor":2,"x":110,...,"pending":true,"ok":true}`, and the tool is still the office.
  - Shaft case, with the same shaft id 91 in both towers: the parked extension of the own shaft (x100, floors 1-2, parked to 6) re-anchors to the loaded tower's shaft at x60. Build then returns `{"ok":true}`, and the loaded tower now has `91@x60 1-6`.
  - When the id is missing, confirm refuses cleanly: "That elevator is gone."
- The outline is visible before Build, so this is not a silent change.
- Fix spec: importSave (which load also uses) resets `tool`, `pending`, `drag` and the ghost the way swapWorld does. Test: park, importSave, and expect `getPlacement() === null`.

### E1 S5. Space on a focused button pauses; tool keys work behind the modal sheet - CONFIRMED (final: ADVISORY)
- Reproduction: s56.vt.ts. Space keydown with the Menu button as the target calls `['togglePause']` and `preventDefault true`. With Settings open (`aria-modal true`, focus inside the dialog), key "1" calls `setTool {"kind":"room","room":"lobby"}`.
- Decision line 64 ("Space pauses") sets the key map. It does not say a focused button should lose Space, so this is not a re-flag.
- Whether preventDefault on keydown also stops that button's click depends on the browser. The pause itself is shown here.
- Fix spec: skip keyAction when the target is a BUTTON, or anything with a role of button or switch, for Space. Skip tool, group and pause keys while an aria-modal sheet is open. Test: both cases above.

### E1 S6. Controller A clicks the tower behind an open sheet - CONFIRMED (final: ADVISORY)
- Reproduction: s56.vt.ts S6. Start opens Settings, then focus is set to the body, which is what happens when a focused row is removed by replaceChildren. The next A press sends the canvas `pointermove, pointerdown, pointerup, click`, and the panel is still open. The cause is ui.ts:1236-1243: `a()` never checks `padMenu()`.
- Fix spec: if `padMenu()` is not null and focus is outside it, A moves focus to the first item in that menu. Test: the same one, where the canvas must receive nothing.

### E1 S7. Player words - PARTIAL (final: IMPORTANT)
Rubric line: player-facing text that is not plain words is IMPORTANT. Decisions 84 and 85 set the target reader at about age 8 to 10.
- Confirmed:
  - `'Haptics'`: Settings > Display switch label (panels.ts:1436).
  - `` `Shaft ${cost} includes the first car. Extra cars ${carCost} each, up to ${max}.` ``: the elevator panel note (panels.ts:623).
  - `'Whole shaft'`: car row button (panels.ts:742).
  - `` `Night x8, x${speed*8} in all` ``: the night chip beside the speed buttons (status.ts:163) and the nightSpeed tip (onboarding.ts:335).
  - Touch help that leaves out the Build confirm step (decision line 26): `'Tap Build, pick a room, then tap where it goes.'` on the Settings > Help > Controls page on touch (controls.ts:68), and `'Move: one finger. Zoom: pinch. Tap to place.'` in the controls hint shown for the first three loads (ui.ts:92).
- Not a defect: `'Tenants'`, the room panel row (panels.ts:283). It is the game's own word, taught in the intro ("Offices, condos and hotel rooms bring tenants, tenants pay rent", onboarding.ts:39) and used in the tips and chronicle.
- Fix spec: switch to "Vibration". Use plain words for "Shaft" in the elevator panel and "Whole shaft", and replace "x16 in all" with something like "Night: 16 times as fast". Add the Build step to both touch lines. Add these words to tests/site/us-english.test.ts, or a new plain-word test.

### E1 S8. The follow limit is a literal - CONFIRMED (final: ADVISORY)
- panels.ts:105 has `'You can follow eight people at a time.'`, and STORY_FOLLOWED_CAP is 8 (story.ts:50), so the text is correct today. tests/ui/story-panels.test.ts:103 and tests/site/landing.test.ts:154 pin the literal, so changing the cap would not fail any test.
- Fix spec: build the text from the cap with a number word, and add a test that ties the two together.

## Verdicts, lane E2

### E2 S1 - CONFIRMED (final: IMPORTANT). Same defect as E1 S1, verified there.

### E2 S2. The VIP card's elevator item stays unticked when the VIP arrives by stairs or a sky lobby transfer - CONFIRMED (final: IMPORTANT)
- Stairs: the rerun of vip-stairs.probe.ts shows `"An elevator stops at floor 2","done":false` in every phase (notice, route, stay, checkout), then `lastVip {"rating":"good","longestWait":0,"suiteClean":true,"reason":null}`.
- Sky lobby transfer: in vip.vt.ts, a suite on floor 36 has an express shaft from 1 to 30 and a standard shaft from 30 to 37. `sendVipToSuite` finds the route (the phase reaches `route`), but the item reads `"An elevator stops at floor 36","done":false`.
- Trace: `elevatorServes` (vip.ts:68-79) needs a single non-service car covering both floor 1 and the suite floor, but the sim routes with findRoute (people.ts:309-320), which uses stairs, escalators and transfers. A standard shaft reaches at most 30 floors (rules.ts:66). The express stops only at lobbies. So a suite above floor 31 can never tick, whatever the player builds.
- Rating: not affected. vipRatingOf (events.ts:384-386) uses only longestWait, the suite's cleanliness and evaluation at check-in, and incidents. The checklist is display only, and its wrong advice can lead a player to buy an elevator they do not need.
- Fix spec: tick the item when `findRoute(world, lobby door, suite center, {riderClass:'hotel'})` returns a route, and rename it to something like "The VIP can get to floor N". Test: stairs-only tower, expect done=true. A tower with no route must still be unticked.

### E2 S3. Broken daily choice sentence - CONFIRMED (final: IMPORTANT, raised from ADVISORY by the rubric's text line)
- The rendered string is `You did not finish the one from September 20, 2026 tower yet. You can finish it, or start today's.`. It appears on the Today's tower choice card (daily.ts:38-39) when the saved daily is older than yesterday. copy.probe prints it.
- Fix spec: use two templates: "yesterday's tower" and "the tower from {date}". Add a daily.test case with `yesterday:false`.

### E2 S4. Finishing an older daily shows "today" words and "Come back tomorrow" - CONFIRMED (final: ADVISORY)
- The result card says `Come back tomorrow for a new tower.` (daily.ts:68). The start card says `No twist today. ...` and `Everyone gets the same start today. You have 8 days in the game...` (daily.ts:81-82), in a panel titled "Today's tower". copy.probe renders these for date 2026-09-24 on the 25th.
- Today's tower really is still open: dailyOpening returns 'fresh' for a finished older save (daily.ts:164-169). But inside the daily slot, Settings hides the "Today's tower" row (panels.ts:1355), so the only way to it is My tower, then Today's tower.
- Fix spec: when `daily.date !== today`, use date-aware words, and offer "Start today's" on the result card.

### E2 S5. "1 people" in the friend greeting - CONFIRMED (final: IMPORTANT, rubric's text line; rare, since it needs exactly one person)
- The rendered string is `A friend built a 1-floor tower with 1 people and 1 star. Think you can do better?`. It appears in the landing page `#challenge` banner (challenge.ts:33). shareText (share.ts:42) already handles the singular.
- Fix spec: use "person" when people === 1. Add a challenge.test case.

### E2 S6. A share from an empty tower makes a link its own landing page rejects - CONFIRMED (final: ADVISORY)
- copy.probe prints `https://hundredstories.xyz/?floors=0&people=0&stars=1&tower=123 -> parse null`. The cause is share.ts:78 (`floors < 1`). tests/site/challenge.test.ts:66 pins the rejection of floors=0. That is a test, not a DECISIONS line, so it stays a finding. The friend loses both the greeting and "Start the same tower", even though `tower` is valid.
- Fix spec: either allow floors 0 in parseChallenge, or keep the `tower` button when only the stats are invalid. Add a share round-trip test at floors 0.

## Duplicates
- E1 S1 and E2 S1 are one defect, verified once under E1 S1.

## Notes
- New suspicion (a sub-case of S1, fixed by the same change): if both towers have a live fire, the old incident card absorbs the new tower's rooms and keeps the old floors. At alerts.ts:286-290 there is no reset because the log did not shrink. Input: the scenario B setup with a burning incoming tower. Wrong outcome: a headline with floors from both towers. Reproduce: s1.vt.ts B with `startFire` on `old` before the swap.
- E2 "Questions for the owner" (the daily link date, bootTarget seeds, bomb Pay ransom when cash is short) are not findings and were not graded.
- Skipped files: none in scope. src/sim/people.ts and events.ts were read only in the VIP and route parts named above.
