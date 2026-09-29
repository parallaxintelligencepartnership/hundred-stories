# Lane E2: Cards, alerts, onboarding, share and the site at 0f05723

## Suspicions

### S1. The VIP checklist shows every item ticked after a fire or bomb has already made the visit poor (proposed: ADVISORY)
- Where: src/ui/vip.ts:99 (`done: !incidentActive(world)` reads only the live events). The rating reads the sticky `event.incident` flag instead: src/sim/events.ts:519 and :535, and vipRatingOf :428.
- Input: seed 11, 3 stars, the tests/ui/vip.test.ts `bookedTower` layout. Run until the visit is in `stay`, then start a bomb. The bomb ends by detonation, by being found or by the ransom. The real-play version: the VIP stays 600 minutes, overnight, so a 6 AM bomb roll lands during the stay and security finds it by about 6:30.
- Wrong outcome: once the bomb is gone, the card shows all four items done ("No fire or bomb in the tower" = true) while `visit.incident` is true. The visit then closes as `rating: "poor"` with `incident: true`. During the rest of the stay, the card says the tower is ready while the result is already fixed as poor. That breaks the lane invariant "the VIP card reflects the real visit". The breakdown only explains it after checkout.
- Reproduce: `cd <checkout> && npx vitest run --config <scratchpad>/e2-0928/probe.config.mjs --disableConsoleIntercept vip`. Output: `incident flag true phase stay`, then a checklist with all four `"done":true`, then `lastVip {... "rating":"poor", ... "incident":true}`.

### S2. The first-tower guide stays on "Add an elevator" when stairs already bring tenants to the office (proposed: ADVISORY)
- Where: src/ui/onboarding.ts:93-102 (`reachedOffice` counts only `world.shafts`) and :119 (step 2 blocks every later step).
- Input: seed 5, a lobby, an office on floor 2 at x 100, and stairs at floor 1 x 120. No shaft. Run 3 days.
- Wrong outcome: the office leases (`vacant false`, 6 tenants, population 6), but `guideStep` is still 2. The card still says "Pick Elevator and run it from floor 1 to floor 2, inside the lobby, so workers can reach the office." The workers already reach it. The guide cannot reach "Wait for tenants" or "Reach 2 stars" until the player builds an elevator they do not need, or presses Skip. This is the same class of defect as the 2026-09-25 VIP stairs finding (E2 S2), which was fixed in vip.ts with findRoute. The guide never got that fix. The 2026-09-25 report listed this only as a test gap.
- Reproduce: `npx vitest run --config <scratchpad>/e2-0928/probe.config.mjs --disableConsoleIntercept guide`. Output: `office vacant false tenants 6 population 6` and `step after 2 {"title":"Add an elevator",...}`. The control probe `none` (no stairs) gives `vacant true tenants 0`, so the stairs are what give the reach.

### S3. The share image's caption says "1 floors" and "1 people" (proposed: ADVISORY)
- Where: src/share/share.ts:131
- Input: share a tower with one person, or one floor, for example stats `{floors: 1, people: 1, stars: 1}`.
- Wrong outcome: the PNG band reads `1 floors  ·  1 people  ·  ★`. shareText (:42) and the landing greeting (challenge.ts:34, fixed after 2026-09-25 S5) both use the singular. The image is the one place left without it. Verify-E rated the same "1 people" wording IMPORTANT last time under the text rule, so the verifier may raise this.
- Reproduce: code trace. panels.ts:1849 calls `composeShareImage(source, stats)`, and :131 formats the counts with fixed plural words. There is no singular branch.

### S4. A share from a tower with nothing above ground says "a 0-floor tower with 0 people" (proposed: ADVISORY)
- Where: src/share/share.ts:43
- Input: share an empty lot, or a tower with basements only (floors 0).
- Wrong outcome: the message is "I'm building a 0-floor tower with 0 people in Hundred Stories...". The friend's greeting for the same link was reworded to "just started a tower" (challenge.ts:33), but the sender's own message was not.
- Reproduce: `node -e` style trace: `shareText({floors:0, people:0, stars:1})` returns the string above. challenge.ts:33 shows the other wording.

### S5. The quiet labels do not come back when the player zooms with the wheel or trackpad (proposed: ADVISORY)
- Where: src/ui/quiet-labels.ts:17 (`['pointermove', 'pointerdown', 'keydown']`). Compare watch.ts:34, which also listens to `'wheel'`.
- Input: wait 2 s so the Watch and Sound words fold away. Then scroll or pinch-zoom on a trackpad without moving the pointer.
- Wrong outcome: the camera zooms, which is input, but the words stay folded. The lane invariant is "the quiet labels always come back on input", and the file's own header says "Any input takes the class off at once". Watch mode treats the wheel as input, so the two chrome timers disagree on what input is.
- Reproduce: `npx vitest run --config <scratchpad>/e2-0928/probe.config.mjs --disableConsoleIntercept quiet`. Output: `listened pointermove,pointerdown,keydown`, then `quiet after wheel true`, then `quiet after pointermove false`.

## Questions for the owner
- The daily share link `?daily=DATE` still opens today's tower, not the dated one (main.ts:71-80 documents this). A friend who opens it the next day plays a different tower than the message calls "the tower from ...". Keep it?
- specimens.ts:300-308: HERO_DEADLINE_MS runs from when the module runs, not from the load event as the comment says. On a slow first load (the renderer is fetched only after load), the specimens can start drawing before the hero's first frame. That is the fallback working as built. Say whether "never delay the hero's first frame" should hold on slow connections too.
- The Pay ransom button disables with the reason when cash is short (the 2026-09-25 question is resolved in alerts.ts:433-448). No action needed. This is recorded only so it is not asked again.

## What the tests do not prove
- tests/ui/vip.test.ts: never ends an incident during `route` or `stay` and then reads the checklist (S1). The fire test removes the event by hand, before the VIP has arrived.
- tests/ui/onboarding.test.ts and first-run.test.ts: stub worlds with shafts only. No stairs-served office (S2).
- tests/share/share.test.ts: composeShareImage is never run (it needs a canvas), so the band text is untested (S3). shareText is not tested at floors 0 (S4).
- tests/ui/quiet-labels.test.ts: covers pointer and key events only. No wheel event, no gamepad (S5).
- tests/ui/alerts.test.ts and alerts-swap.test.ts: nothing checks that a theft card is not duplicated when the log line and the event arrive in one drain. A trace of alerts.ts:469-490 against events.ts:703-766 shows the event ends in the same tick that logs the outcome, so it holds today. No test pins that order.
- tests/site/hero-trailer.test.ts: fakes only. It does not prove how a real browser orders `stalled` and `playing`: a `stalled` during buffered playback with no later `playing` would end a trailer that is still playing after 4 s. This needs a real browser with a throttled network, for example agent-browser on / with a CDP throttle.
- tests/site/theme.test.ts: public/theme.js is still never executed (it is a 6-line try/catch, and the code read shows it is safe).

## Coverage
- Read in full: src/ui/alerts.ts, vip.ts, cards.ts, onboarding.ts, daily.ts, demo.ts, explain.ts, hover.ts, minimap.ts, overlays.ts, sound-toggle.ts, quiet-labels.ts. src/share/share.ts. src/site/challenge.ts, hero.ts, hero-ready.ts, hero-trailer.ts, platforms.ts, specimens.ts, stores.ts, theme.ts, theme-init.ts. public/theme.js. .itworks/DECISIONS.md and the MAP.md Gotchas. The 2026-09-25 lane-E2.md and verify-E.md.
- References read in part: src/sim/events.ts (fire, bomb, VIP, theft, commands), build.ts (refusal strings, hasSupport), routing.ts (findRoute, cache), people.ts (sendVipToSuite), game/daily.ts, main.ts bootTarget, ui.ts (onWorld, drainAlerts, sound wiring), panels.ts soundSection, audio.ts setEnabled, watch.ts input list, index.html hero video, site.css .hero-trailer.
- Earlier findings checked, not re-raised: E1/E2 S1 (alerts replay on a world switch) is fixed at ui.ts:944-960. The VIP stairs finding is fixed (vip.ts:72-78 findRoute). The broken daily sentence and the "today" words for an older daily are fixed (daily.ts:69, :90-137). The "1 people" greeting and the floors-0 parse are fixed (challenge.ts:33-34, share.ts:78).
- Skipped: none in scope. Test files were read only for the harness they use (vip.test.ts), not in full.
- Machine: arm64 (uname -m).
- Probes run:
  - The lane recipe plus explain, demo, sound-toggle, quiet-labels and alerts-swap: 35 files, 478 tests passed.
  - e2-0928/vip.probe.ts: checklist all done, incident true, rated poor (S1).
  - e2-0928/quiet.probe.ts: the words stay folded after a wheel event and come back on pointermove (S5).
  - e2-0928/guide.probe.ts: stairs-served office leased, guide still at step 2 (S2). none.probe.ts is the control: no reach, vacant. far.probe.ts: a shaft outside the lobby still reaches the office, so no finding there.
