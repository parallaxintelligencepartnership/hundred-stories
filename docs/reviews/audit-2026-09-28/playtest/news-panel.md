# News panel will not close; Watch lights up but does nothing (0.6.8, commit 0f05723)

Diagnosis 2026-09-28, read-only, headless Chrome 154 over CDP (SwiftShader), fresh profile, viewport emulated at 390x844 touch, 1280x800 mouse and 1180x820 touch. Probe transcripts: scratchpad news-panel/phone.txt, desktop.txt, ipad-land.txt, watch6.txt, watch7.txt, p8-*.txt; probe8.mjs is the elementFromPoint check reused by the fix's browser proof.

## Cause (CRITICAL)
createLogPanel (src/ui/panels.ts) adds the class hs-news to the News sheet. The toast region in src/ui/toast.ts has carried that class since 3f4d902; the panel took it in 33051b8 on 2026-09-25, so the bug has been live since ship-2026-09-25. The toast rule in src/ui/ui.css (about line 2717, and 3704 for the phone) sets position absolute, left 50%, a translateX(-50%) transform, the toast width and pointer-events none. It has the same specificity as .hs-sheet and comes later, so it wins: every child of the sheet (Close, the handle, the list, Show older) is pointer-events none, the sheet is misplaced (x 410 to 870 at 1280 instead of the right edge; floating 84 px above the bottom at 390) and the drag transform is replaced.

## Close paths
| Path | 390 phone | 1280 desktop | 1180 iPad landscape |
|---|---|---|---|
| Tap Close | stays (hit the tip card) or closes by accident through the backdrop | stays (hit canvas) | stays (hit the hint text) |
| Drag handle down | stays (pointerdown on the tip card, then pointercancel) | n/a | stays |
| Tap outside | backdrop closes it | stays (hit canvas) | stays (hit the dock) |
| Escape | closes | closes only while focus is still in the card | closes with focus in the card |
| Menu | hidden while a panel is open | replaces News with Settings, whose Close works: the only pointer way out | same |

At 900 px and wider (card mode, no backdrop) no pointer path closes News except the Menu, Settings, Close detour. Below 900 px the sheet cannot be tapped or scrolled; a tap on Close closes it by accident through the backdrop or lands on the tip card. Matt's two symptoms together (stuck panel, Watch lit) match card mode: desktop, iPad landscape or a large phone in landscape.

## Refuted hypotheses
Watch and Sound over Close (rects do not overlap at either width); is-entering never clearing (no such state; the slide-in uses @starting-style, rAF fired); refreshPanel reopening it (a MutationObserver saw no remove or add, only refresh()); the sheet's pointerdown swallowing the click (no pointer event reached the sheet at all).

## Watch
The tap sets aria-pressed true and the amber edge (the "lights up"), but busy() in src/ui/ui.ts includes mountedPanel, and watch.ts restarts its wait while busy, so is-watching never turns on until the panel closes (5 s after a JS close in watch7.txt). The guided first tower gates it the same way. Watch worked as built; decision 2026-09-28: turning it on now closes whatever is open.

## Fix, proven in a scratch mutant
Rename the panel's class to hs-news-panel (panels.ts, and the ui.css rule .hs-sheet.hs-news[data-snap='half']). At 1280 the card sits at [924,72,360,644], pointer-events auto, elementFromPoint at Close is the Close button and a tap closes it; at 390 the sheet sits at [0,211,390,633] and Close, the head drag and Escape all close it.
