# Lane E1: UI shell, panels, build tools and controls at 7b4e60f

## Suspicions

### S1. Switching to a tower with a longer log replays its old alerts as live cards (proposed: IMPORTANT)
- Where: src/ui/ui.ts:1141-1159 (drainAlerts); src/ui/ui.ts:695-712 (onWorld resets the news and star watchers but not `lastLogTotal`, `alerts` or `toastLayer`)
- Input: play Today's tower (young, short log), then tap My tower (older, longer log). The same happens with Open a saved file on a bigger tower. The shell only notices a new world when `logTotal` goes down.
- Wrong outcome: `fresh = min(total - lastLogTotal, log.length)` treats up to 200 old lines of the loaded tower as new. Every old alert line goes through `alerts.onAlert`. Old fires come back as a "Fire out, 1 room damaged" card, and "The bank took the tower..." or any other alert line becomes a card that stays until it is closed. Going the other way, a live fire or bomb card from the tower you just left is closed with "Fire out" or "threat over" text that describes the wrong tower. What should happen: a new world resets the alert stack the way `total < lastLogTotal` already does.
- Reproduce: `npx vite-node@6.0.0 scratchpad/audit/e1probe/alerts-replay.ts`. It uses a fake game on tests/ui/fake-dom.ts, swaps a world with logTotal 5 for one with logTotal 500 holding a finished fire and a bank line, then notifies. Output: `after swap: ['hs-toast is-fire :: ×Fire out, 1 room damaged', 'hs-toast :: ×The bank took the tower ...']`.

### S2. With site data blocked, Larger text, Color-blind friendly views and Haptics do nothing (proposed: IMPORTANT)
- Where: src/ui/prefs.ts:64-91 (a failed write is dropped); src/ui/display.ts:21-26, 55-60 (reads the value back from storage); src/ui/haptics.ts:48-54; src/ui/panels.ts:1422-1436
- Input: the browser blocks site data, so the `window.localStorage` getter throws (Chrome's "block all cookies"). Then turn on Larger text or Color-blind views, or turn off Haptics.
- Wrong outcome: the switch looks flipped, but display.refresh reads the flag back as null, which counts as false, so nothing happens. Haptics stays on. Reopening Settings shows the switches off again. prefs.ts says a blocked store keeps "the choice for this session only", but no copy is kept in memory. Reduced motion and See-through buttons do work for the session, because they act on the value directly.
- Reproduce: `npx vite-node@6.0.0 scratchpad/audit/e1probe/prefs-blocked.ts` prints `Larger text on the root: false | color-blind views: false | haptics enabled: true | switch reads back: null`.

### S3. A refused Build shows the same refusal twice (proposed: ADVISORY)
- Where: src/ui/ui.ts:381-384, 434-440 (the notice comes after the apply); src/ui/ui.ts:1104-1108 (dedupe); src/game/game.ts:750-761 (apply logs the refusal and notifies synchronously)
- Input: park an office with too little cash, then press Build on the bar. The same happens with any refused `ctx.apply` (rent, add car, extend).
- Wrong outcome: game.apply logs a warn line and calls notify() before it returns. So update() runs refreshNews while `lastNoticeText` still holds the previous text, and the refusal becomes a news toast. After that, `notice()` shows it again as a notice card. The comment at 1103 says the refusal is shown only once. Repeating the same refusal alternates between showing it once and twice.
- Reproduce: `npx vite-node@6.0.0 scratchpad/audit/e1probe/refusal-twice.ts`. It prints a notice card and a news toast, both saying "You need $40,000 to build that.".

### S4. Open a saved file and Go back to last save keep the parked outline from the old tower (proposed: ADVISORY)
- Where: src/game/game.ts:902-912 (`importSave`, which `load` also uses, clears the selection but not `tool`, `pending`, `drag` or the ghost; `swapWorld` at 385-397 and `newGame` do clear them). Seen from src/ui/panels.ts:1381-1411.
- Input: on a phone, tap to park an office or an elevator stretch, then open Menu and choose Go back to last save or Open a saved file.
- Wrong outcome: the chip and bar still show the parked outline, now on the loaded tower, and Build applies there. A parked stretch keeps the old `shaftId`, so Extend stretches whichever shaft has that id in the loaded tower, using the old span.
- Reproduce: code trace. `confirmPending` (game.ts:855-874) builds `shaft.extend` from `pending.shaftId`, and nothing clears it on import.

### S5. Space on a focused button pauses the game instead of pressing the button (proposed: ADVISORY)
- Where: src/ui/ui.ts:1353-1366; src/ui/keys.ts:63
- Input: Tab to Save now, a palette tile, or the Build button, then press Space.
- Wrong outcome: `isFormField` is false for a button, so keyAction returns pause and calls `preventDefault()`. The game pauses and the button is not pressed. Enter still works. Also, while the phone bottom sheet (aria-modal) is open, the number and letter keys still pick tools behind it.
- Reproduce: in tests/ui/keys.test.ts style, focus a panel button and fire a keydown `{key:' ', target: button}`. `togglePause` is called and `defaultPrevented` is true.

### S6. Controller A can click the tower behind an open sheet (proposed: ADVISORY)
- Where: src/ui/ui.ts:1236-1243
- Input: hold an office, press Start, choose Stories, and move the d-pad onto a followed person. That person gets a new beat, so `followList.replaceChildren` (panels.ts:1087) removes the focused button and focus falls to the body. Then press A.
- Wrong outcome: `a()` only checks whether focus is inside the shell. It never checks `padMenu()`, so it calls `pointAtTower('click')` and builds the office, or demolishes if Demolish is held, under the pad cursor behind a modal sheet.
- Reproduce: fake-dom shell test. Mount the Stories panel, set `dom.activeElement = null`, press A through the gamepad test harness, and check that the canvas receives a click (or add a `padMenu()` guard and see it refuse).

### S7. Some player words are not plain for a reader of 8 to 10, and the touch help leaves out the Build step (proposed: ADVISORY)
- Where: src/ui/panels.ts:1436 "Haptics" (the approved spec only says "an off switch"; "Vibration" is the plain word); panels.ts:283 "Tenants"; panels.ts:623, 742 "Shaft ... includes the first car", "Whole shaft"; src/ui/status.ts:163 "Night x8, x16 in all"; src/ui/controls.ts:68 "tap where it goes" and ui.ts:92 "Tap to place". On touch, a tap only parks an outline and Build confirms it (decision 2026-09-19).
- Input: read Settings, a room panel, an elevator panel, the night chip, and Controls on a phone.
- Wrong outcome: jargon, and help text that does not match the two-step touch build.
- Reproduce: grep the lines above.

### S8. The follow limit is a hard-coded word (proposed: ADVISORY)
- Where: src/ui/panels.ts:105 `'You can follow eight people at a time.'`, versus `STORY_FOLLOWED_CAP` in src/sim/story.ts:50
- Wrong outcome: this number on screen is a literal, not read from the rule, so it will go stale if the cap changes.

## Questions for the owner
- Open a saved file is offered in Today's tower and Friend's tower. The file replaces that slot's tower (the slot stays daily or friend, and `dirty` is true, so the autosave writes it there), and the daily card disappears. Should opening a file always go to My tower?
- Follow and Unfollow change `world.story` directly instead of going through `apply`. The story is left out of the hash by design (save.ts:40-44), so this is only a note.

## What the tests do not prove
- tests/ui/shell.test.ts: no world swap at all, so S1 and S4 are untested. No refusal flows through notify, so S3 is untested.
- tests/ui/prefs.test.ts: with a throwing store it proves nothing throws, not that a choice lasts the session. No display or haptics test uses a blocked store.
- tests/ui/settings.test.ts: the switches are checked only against a working store and a ctx spy. Nothing checks the page root class end to end.
- tests/ui/keys.test.ts: covers form fields and text-field cards only. No test covers Space on a focused button, or keys while a modal sheet is open.
- tests/ui/gamepad.test.ts: A is tested with nothing open. No test covers A while a panel or sheet is open and focus is outside it.
- tests/ui/placement.test.ts: pure layout and label functions only. No shell test covers Build exactly once, or Build after a world swap.
- tests/ui/panels.test.ts: no test for the share panel revoking its preview URL, or for a query panel across a world swap.
- tests/site/us-english.test.ts: UK spellings and "seed" only. Reading level and jargon ("Haptics", "Tenants", "Shaft") are not tested.

## Coverage
- Read in full: src/ui/ui.ts, panels.ts, status.ts, sheet.ts, build.ts, palette.ts, layout.ts, display.ts, controls.ts, keys.ts, gamepad.ts, haptics.ts, prefs.ts, toast.ts, icons.ts, format.ts; src/game/api.ts; .itworks/DECISIONS.md; DESIGN.md section 10. Read in part for tracing: src/game/game.ts (swap, import, pointer, apply, pending), src/ui/alerts.ts (onAlert, sync, reset), src/game/storage.ts (reads), src/render/renderer.ts (keys, pick), ui.css (z-order), the UI polish spec (Haptics).
- Tests: all describe/it lines of the 12 named files, plus the setups of shell.test.ts, gamepad.test.ts (shell block), prefs.test.ts and settings.test.ts (display switches) in full. Not every assertion body was read.
- Skipped: none in scope.
- Probes run:
  - `npx vitest run` on the 12 named test files: 147 of 147 pass.
  - `grep -rn "innerHTML|insertAdjacentHTML" src/ui/`: 3 hits (icons.ts:117, controls.ts:119, 130), all static constant SVG, safe.
  - `vite-node e1probe/alerts-replay.ts`: S1 confirmed.
  - `vite-node e1probe/prefs-blocked.ts`: S2 confirmed.
  - `vite-node e1probe/refusal-twice.ts`: S3 confirmed.
- Tried and found sound: the touch Build path applies once (confirmPending clears pending, a second press gets "Pick a spot to build first."); a pad A on the tower builds once (build on pointerup, pick on pointerup, the extra click is ignored); the query, log and finance panels rebuild on switchTower; every world swap in game.ts clears the selection; the placement bar sits under the sheet's backdrop; no "seed" or UK spelling found in the scope's player strings.
