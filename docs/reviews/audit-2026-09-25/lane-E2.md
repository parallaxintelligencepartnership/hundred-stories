# Lane E2: Cards, alerts, onboarding, share and the site at 7b4e60f

## Suspicions

### S1. Switching to a tower with a higher log count replays its old alerts as new cards (proposed: IMPORTANT)
- Where: src/ui/ui.ts:1145 (drainAlerts only resets when `total < lastLogTotal`), src/ui/ui.ts:696-711 (onWorld never resets `lastLogTotal`), feeding src/ui/alerts.ts:391-422 and :283-299.
- Input: My tower with any history (the probe used logTotal 47: a fire put out by the helicopter, a ransom paid, a VIP checkout). Open Today's tower (fresh, logTotal 1; the reset branch runs), then press My tower (game.openMyTower -> swapWorld; the game re-primes its own tap, but the ui does not). The same happens when a file is opened (importSave) or you switch to a Friend's tower, whenever the incoming logTotal is higher.
- Wrong outcome: the last `min(47-1, log.length)` lines (up to 2000) are treated as fresh. The probe printed these cards after the switch: "Fire out, 1 room damaged", "You paid the $500,000 ransom and the bomb in the office on floor 3 was handed over.", "The VIP checked out and rated the tower good." The last one is a card that stays until the player closes it, one per old alert line, stacked under "and N more". A fire or bomb the player already dismissed comes back as a card. This breaks "a dismissed card never returns". The reverse also happens: if the tower you leave has a live fire or bomb card, sync() on the new world turns it into "Fire out, N rooms damaged" or "The bomb threat is over." even though the fire or bomb is still going on in the saved tower.
- Reproduce: /private/tmp/claude-501/-Users-matthew-parallax-private-Projects-hundred-stories/59100aac-82b1-4a98-947c-f0845463d155/scratchpad/e2probe/alerts-switch.probe.ts. Run it from the repo with `npx vitest run --config <scratchpad>/e2probe/probe.config.mjs --reporter=verbose --disableConsoleIntercept alerts-switch`. The harness is the same as tests/ui/alerts.test.ts, except that `world` is a getter so the probe can swap it.

### S2. The VIP checklist says no elevator reaches the suite while the VIP gets there by stairs (proposed: IMPORTANT)
- Where: src/ui/vip.ts:68-79 (elevatorServes needs one non-service car that covers both floor 1 and the suite floor) and :93-94. The sim routes the VIP with findRoute (src/sim/people.ts:309-320), which also uses stairs, escalators and sky lobby transfers.
- Input: seed 11, 3 stars, a lobby run from 90 to 170, stairs at floor 1 x 120, a hotelSuite at floor 2 x 130, no shaft. The visit is booked at day 0, 06:01.
- Wrong outcome: "An elevator stops at floor 2" stays unticked through notice, route, stay and checkout. The visit runs to the end and is rated good (longestWait 0, suiteClean true). The card tells the player the tower is not ready, and the only way to tick the item is to build an elevator the VIP never needed. A suite reached through a sky lobby transfer also stays unticked. So the card does not reflect the real visit.
- Reproduce: <scratchpad>/e2probe/vip-stairs.probe.ts, first test. It prints the phases and the checklist row at each phase.

### S3. The daily choice card for an older date is a broken sentence (proposed: ADVISORY)
- Where: src/ui/daily.ts:38-39
- Input: DailyChoice `{ savedDate: '2026-09-20', today: '2026-09-25', yesterday: false }`
- Wrong outcome: the card reads "You did not finish the one from September 20, 2026 tower yet." It should read something like "You did not finish the tower from September 20, 2026 yet."
- Reproduce: <scratchpad>/e2probe/copy.probe.ts prints the panel text.

### S4. An older daily's cards say "today" and "Come back tomorrow" while today's tower is still unplayed (proposed: ADVISORY)
- Where: src/ui/daily.ts:68 and :79-82
- Input: choose "Finish yesterday's" (the game keeps the 2026-09-24 tower on 2026-09-25) and play it out.
- Wrong outcome: the start card says "No twist today..." and "Everyone gets the same start today" about yesterday's tower. The result card then says "Come back tomorrow for a new tower." But today's tower has not been played. openDaily would start it fresh (dailyOpening returns 'fresh' for a finished older save). The copy sends the player away from the tower that is waiting for them.
- Reproduce: copy.probe.ts renders createDailyPanel with date 2026-09-24, first finished and then unfinished.

### S5. The friend greeting says "1 people" (proposed: ADVISORY)
- Where: src/site/challenge.ts:33
- Input: `?floors=1&people=1&stars=1&tower=5`
- Wrong outcome: "A friend built a 1-floor tower with 1 people and 1 star." shareText in share.ts:42 handles the singular, but the greeting does not.
- Reproduce: copy.probe.ts, first line.

### S6. A share from a tower with nothing above ground makes a link that its own landing page rejects (proposed: ADVISORY)
- Where: src/share/share.ts:30-38 (floors 0 when there is no room above ground) and :78 (`floors < 1` returns null)
- Input: share an empty lot (createWorld(123)). The link is `?floors=0&people=0&stars=1&tower=123`.
- Wrong outcome: parseChallenge returns null, so the friend sees neither the greeting nor Start the same tower, even though `tower` is valid. The round trip fails at floors 0. The link and the message still say "0-floor tower". tests/site/challenge.test.ts:70 pins the rejection, so this may be deliberate. It is listed here because the sharer's own link is what fails.
- Reproduce: copy.probe.ts, second line.

## Questions for the owner
- A daily share link carries `?daily=DATE`, but main.ts bootTarget ignores the value. A friend who opens it the next day gets a different tower than the one the message calls "today's tower". Is that intended?
- bootTarget (src/main.ts:75-78, lane D) accepts `?seed=1e3`, `0x10`, `1.0` and values above 4,294,967,295. A probe with 2^53-1 and 2^32 showed no crash: 2000 ticks ran and save and load worked. But 4294967296 gives the same rng as 0, and the player's own share link then drops `tower`. Should bootTarget apply share.ts validStart?
- The bomb card's Pay ransom stays enabled when cash is short. The fire card disables its button and gives the reason. With the bomb, the refusal notice explains it after the click. Is the difference intended?

## What the tests do not prove
- tests/ui/alerts.test.ts: never swaps game.world, so it never tests the drain cursor across a load, importSave or a slot switch (S1). It has no ui-level test of a save loaded mid bomb or mid fire (alerts.ts:288, :330). It never shows that a dismissed bomb card stays gone. It has no bomb test with short cash.
- tests/ui/vip.test.ts: the checklist is only tested on a tower served by one elevator. It has no stairs, escalator or transfer route, and nothing compares the checklist with whether sendVipToSuite finds a route.
- tests/ui/daily.test.ts: the choice card is only tested with `yesterday: true`, so the older-date wording is never rendered. The start and result cards are only tested for today's date.
- tests/site/challenge.test.ts: people=1 is not covered.
- tests/share/share.test.ts: the round trip is tested at floors 1, never at floors 0.
- tests/ui/onboarding.test.ts and first-run.test.ts: the stub shafts have no kind and no stops. reachedOffice counts any shaft that spans the floors and ignores stairs. An office reached only by stairs gets tenants while the guide stays on "Add an elevator". Nothing tests the guide being offered again on an empty Today's or Friend's tower when guideDone is false.
- tests/site/theme.test.ts: covers src/site/theme.ts only. public/theme.js, which runs before first paint, is never executed.
- tests/ui/overlays.test.ts: calls the popover toggle by hand. isOpen() stays false between show() and the asynchronous toggle event.

## Coverage
- Read in full: src/ui/alerts.ts, vip.ts, cards.ts, onboarding.ts, daily.ts, demo.ts, explain.ts, hover.ts, minimap.ts, overlays.ts; src/share/share.ts; src/site/challenge.ts, hero.ts, platforms.ts, stores.ts, theme-init.ts, theme.ts; public/theme.js; references src/game/api.ts, events.ts, daily.ts; .itworks/DECISIONS.md; DESIGN.md section 10. Also read the relevant parts of src/ui/ui.ts (alert wiring, drainAlerts, onWorld, watchDaily, switchTower), src/game/game.ts (slot open and swap), src/sim/events.ts (fire, bomb, VIP, roll), src/main.ts bootTarget and src/sim/build.ts refusal reasons.
- Tests read in full: tests/ui/alerts, vip, daily, onboarding, first-run, demo, explain, overlays; tests/share/share; tests/site/challenge, theme, daily-entry, us-english.
- Skipped: tests/ui/hover.test.ts and minimap.test.ts (read the case lists only; their sources were read in full and showed no defect). tests/site/landing, platforms, stores, app-build, fonts, versions, wordmark (not read; they ran green in the recipe). The src/ui/ui.ts parts outside the alert and daily wiring belong to lane E1. Browser-only behavior (the real Popover toggle timing, hero WebGL) needs a real browser, for example an agent-browser run on /play/ and /.
- Machine: arm64 (uname -m).
- Probes run:
  - `npx vitest run` on the lane recipe (the 8 ui files, tests/share, tests/site): 209 passed.
  - alerts-switch.probe.ts: 3 stale cards after the switch (S1).
  - vip-stairs.probe.ts: the VIP is rated good with the elevator item unticked throughout (S2). The second test, a service elevator for the guide, was refused by the sim (service needs 2 stars), so no finding.
  - copy.probe.ts: S3, S4, S5 and S6 text confirmed, and bootTarget alias outputs.
  - seed.probe.ts: hostile seeds, no crash, and save round trip ok.
