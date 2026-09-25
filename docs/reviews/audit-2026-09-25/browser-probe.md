# Probe report, audit 2026-09-25 (REVIEWS.md lines 294 and 354)

## Part A: events in a real browser (line 294)
Setup: a dev-only harness on pi2 only (~/hs-review/probe-dev/: index.html, harness.ts, vite.probe.config.ts). It mounts the game the way boot() does for ?new and serves it from vite in hs-dev. The probe config adds only allowedHosts ['hs-dev'], because vite returned 403 without it. Chromium ran with the swiftshader flags.
Tower: lobby 90-200, a shaft on floors 1-6, offices, a shop on floor 5, no security office, cash 500M, world.stars=3.
How I forced the events: EVENT_TEST_HOOKS only works under vitest (MODE==='test'), so the harness called the roll's own starters directly (startVip, startTheft(11:00), startFire). This skips the chance and star gates. The status bar went back to 1 star, so the tower did not meet the gates by itself.
- VIP, no suite: startVip with no suite made no event. Next, a suite was built, the VIP booked and the suite demolished. After 1880 ticks the log said "The VIP left: no suite was ready." and a card showed the same line. stats.lastVip.reason matched, and the rating was poor.
- Theft, no guard: the card said "Theft on floor 5, no guard can reach it" (noGuard: "No guard could reach floor 5: no guard is on shift."), then "Thief escaped, $2,000 lost". Story beats: theft.started, theft.escaped. Both card texts match tests/ui/security.test.ts.
- Fire, card dismissed: the card said "Fire on floor 1 / Call a helicopter ($250,000) / A security office puts fires out on its own." Clicking .hs-toast-close took the fire cards from 1 to 0. 125 minutes later 17 rooms were burning and the card had not come back. After the helicopter command the fire event was gone.
Console: 3 lines. Two are vite debug lines; one is a GPU stall warning. 0 errors, 0 pageerrors, no Refused or unsafe-eval lines.
Screenshots (pi2 ~/hs-probe/out and scratchpad/probe/out): a1 to a7 *.png.

## Part B: News at 390x844, scale factor 2 (line 354), built page in hs-web
Path to the panel: the Build button, then Lobby, then 7 mouse drags on floor 1, then a tap on the "Built a lobby on floor 1." news toast.
- Panel .hs-news: left 12, top 127, right 378, bottom 760 (366x633)
- List .hs-log-list: left 83.5, top 260, right 306.5, bottom 577.9 (223x317.9)
- Horizontal overflow: none. scrollWidth equals clientWidth for the panel and the list, and the document is 390 wide.
- Rows: 10. The Show older button (.hs-news-older) is present and visible at 146,581.9 (98x44).
- PNG: docs/reviews/audit-2026-09-25/news-phone.png, 139,635 bytes, 780x1688. Not committed.
- Console: 0 errors, 0 pageerrors.
Seen in the screenshot: a first-run hint ("Panels show the details... Got it") covers the News title bar, and the list is only 223px wide inside the 366px panel.

## Other
hs-dev was removed. No tracked files were changed. The failed Part B attempt left extra PNGs in pi2 ~/hs-probe/out (b0, b1-a, b1-b).
