# Remediation plan for the 2026-09-25 audit

Target: every finding in the `## Audit - 2026-09-25` section of `.itworks/REVIEWS.md` (9 CRITICAL, 30 IMPORTANT, 52 ADVISORY at 7b4e60f). Reports, verifications and probe scripts sit under `docs/reviews/audit-2026-09-25/`; each verification report carries a fix spec per item (what changes, which test goes red then green, what must not change). Implementers work from those specs, not from this page.

## Shape

- One branch, `audit-fixes-2026-09-25`, off main. Each package is one agent in its own worktree branched from it; Fable merges packages back in, verifying only the touched test files at each merge (Matt's one-pass rule). One full test run, one build, one deploy, all at the end.
- One fix per finding, each with a test that fails when the fix is reverted. The verifier probes under `docs/reviews/audit-2026-09-25/probes/` are the starting point for those tests.
- Ordering inside a package: CRITICAL first, then IMPORTANT, then ADVISORY. A package agent that finishes its criticals and importants and runs short on time stops there and reports; advisories are never the reason a critical slips.
- At most five agents at once. Opus 5.5 (`senior-implementer`) for anything with judgment, Sonnet (`implementer`) for mechanical packages.
- After the wave: a checkpoint reads the whole diff (lenses real-data and testing), and a verifier re-runs every audit probe against the fixed code. A fix wave brings its own regressions; that pass is not optional.
- Then closeout, then the ship, on Matt's go. SHIPPED.md carries the open criticals until then.

## Decisions this plan assumes (Matt can overturn any before the wave starts)

| # | Question from the audit | Default taken here |
|---|---|---|
| 1 | Demolish a burning room or the bomb's room: firebreak, or refuse? | Refuse, with a plain reason ("Put the fire out first." / "Deal with the bomb first."). Simplest, no new rule, matches how car demolition refuses. |
| 2 | May a free-standing shaft count as structure? | No new rule this wave. Left as an open question; not a finding. |
| 3 | Do the VIP and the thief enter during a fire? | No. The 2026-09-24 decision covers them on its plain reading. Both wait outside until the fire ends. |
| 4 | Music chapter after a lost star: keep the high-water mark or follow stars? | Follow the tower's current stars in session and on reload, so the two agree. Quality never drops by the 2026-09-24 decision either way. |
| 5 | Draw dirt, backlog and cockroaches in the world? | Not this wave. VISUAL.md does not promise it. |
| 6 | Hotel population swings near a star threshold | Not this wave; design question, stays open. |
| 7 | Web saves when the web build flips to demo | Not this wave. |
| 8 | Riders whose room is demolished mid-ride | Fixed in P1: demolition, fire and bomb unseat riders and clear their calls. |
| 9 | Tell the player once per session when autosave fails? | Yes, one plain notice ("This device is not saving your tower right now."), once. |
| 10 | Should ?daily=DATE open that date's tower? | No. |
| 11 | Apply validStart to ?seed in bootTarget? | Yes, cheap and closes a crash-shaped input. |
| 12 | Pay ransom enabled when cash is short? | Disable it, like the fire card's button. |
| 13 | Event log panel wording | Matt, 2026-09-25: "news not event log and it gets cleaned up". The panel is News, per the proposal below. |

News (decision 13, approved): the panel becomes **"News"** in the dock and the sheet. It shows the newest ten lines in plain sentences, newest first, with a relative time ("just now", "an hour ago", "yesterday") instead of a clock stamp. A "Show older" link at the bottom reveals the next fifty. No level tags, no ids. The VIP card keeps its spot at the top. At phone width the list fits without scrolling behind the dock.

## Packages

Files are disjoint between packages that run at the same time. Where two packages need one file, the second waits for the first to merge.

### P1 People, cars, events, stars (Opus)
Files: `src/sim/people.ts`, `src/sim/elevators.ts`, `src/sim/events.ts`, `src/sim/stars.ts`, `src/sim/routing.ts` (read), tests under `tests/sim` and `tests/scenarios`.
- CRITICAL B S1: leasing and booking use the rider-class-aware route check, so an office with no car that carries workers stays vacant, and a lease whose car is later flipped is vacated.
- CRITICAL B S4: demolition, fire and bomb remove the tenant from whatever room they sit in and from any car, so occupancy matches the count.
- CRITICAL new S2: housekeepers never count toward population.
- IMPORTANT B S2: a stop cannot be turned off while a rider aboard is bound for it (refused with a plain reason), or the rider is let off at the next stop; the spec picks refuse.
- IMPORTANT B S3: an exiting person gives up after the retry budget and leaves by stairs or vanishes with a logged reason.
- IMPORTANT B S5: an evicted rider is let off at the car's next door opening and dropped from passengers.
- IMPORTANT B S6 / C S5: the VIP and the thief hold outside during a fire (decision 3).
- ADVISORY B S7, B S8, D S10 / I S11 (rentDay fires when rent moves, not at midnight; this one touches `src/sim/economy.ts`, which P2 also edits, so P1 leaves it and P2 takes it).

### P2 Build rules, economy, chronicle, story, rules (Opus)
Files: `src/sim/build.ts`, `src/sim/economy.ts`, `src/sim/chronicle.ts`, `src/sim/story.ts`, `src/sim/rules.ts`, their tests.
- IMPORTANT A S1 / C S3 and A S2 / C S4: demolishing a burning room or the bomb's room is refused (decision 1); also closes ADVISORY new S3.
- IMPORTANT A S3: `hasSupport` for basements tests the floor above the room's top, so a two-floor basement under B1 builds.
- IMPORTANT A S4: basement refusals name the floor above.
- IMPORTANT A S7: refusal strings use a plural table (Lobbies, Housekeeping, Fast food) and a test sweeps every kind.
- IMPORTANT C S6: chronicle counts come from running totals, and hotel checkouts are not move-outs.
- ADVISORY A S6, A S8 (negative money formats as "-$30,000"), A S9, C S7, D S10 / I S11.

### P3 Save format and determinism (Opus, after P1 merges)
Files: `src/sim/save.ts`, `src/sim/events.ts` (cockroach timer only), `tests/sim/save.test.ts`, `scripts/replay.ts` (read).
- CRITICAL C S1 / D S2: the spread timer moves from the WeakMap into world state, is serialized, and enters the hash; save format v6, v1 to v5 still load with a default that matches the old first-spread timing.
- CRITICAL D S5: `deserialize` validates the insides (shaft width, per-person stats, tenants, schedule, route, room height bounds) and refuses with "This save is damaged and was not loaded. (<field>)".
- ADVISORY I S6: the hash includes room order (the spec says how without moving the six benchmark hashes; if it must move them, the agent stops and reports).

### P4 Game shell, storage, daily (Opus)
Files: `src/game/game.ts`, `src/game/storage.ts`, `src/game/daily.ts`, `src/main.ts`, tests under `tests/game`.
- CRITICAL D S1: the slot changes only after the read resolves, and autosave is held while a switch is in flight.
- CRITICAL D S3: after a fallback write, reads prefer the newer of the two copies (a minute stamp in the payload decides).
- CRITICAL new S1: an unreadable My tower save is kept aside and the player told, on the tap path exactly as at boot.
- CRITICAL C S2: `dailyOpening` never returns fresh for a stored date later than today; the stored run is shown with its date and a "Start today's tower instead" choice that keeps a copy.
- IMPORTANT D S4 (abort rejects), D S6 (Open a saved file is refused inside Today's tower, or leaves it first), D S7 (decision 9), D S8 (save on pause and on pagehide/visibilitychange hidden), D S9 (the "kept a copy" line only when a copy exists, and a way to get it back).
- ADVISORY D S11; decision 11 (`validStart` on `?seed`).

### P5 UI, cards, prefs, site (Opus)
Files: `src/ui/ui.ts`, `src/ui/prefs.ts`, `src/ui/panels.ts` (except the log panel), `src/ui/vip.ts`, `src/ui/daily.ts`, `src/ui/alerts.ts`, `src/ui/controls.ts`, `src/site/challenge.ts`, `src/share/share.ts`, tests under `tests/ui`, `tests/site`, `tests/share`.
- IMPORTANT E1 S1 / E2 S1: `onWorld` resets the alert drain and the card stack; a card is never built from a line older than the swap.
- IMPORTANT E1 S2: prefs keep an in-memory copy when storage throws.
- IMPORTANT C S8: in Today's tower the saving menu shows nothing that rewinds or replaces the run.
- IMPORTANT E1 S7: plain words ("Haptics" becomes "Vibration", "Shaft" becomes "Elevator", "Whole shaft" becomes "Every floor", the x16 line rewritten), and the touch help gains the Build step.
- IMPORTANT E2 S2, E2 S3, E2 S5.
- ADVISORY E1 S3, S4, S5, S6, S8; E2 S4, S6; decision 12.

### P5b Event log becomes News (Opus, after P5 merges)
Files: `src/ui/panels.ts` (log panel), `src/ui/ui.ts` (dock label), `src/ui/ui.css`, `tests/ui/panels.test.ts`, a phone-width screenshot for the evidence.

### P6a Renderer (Opus)
Files: `src/render/renderer.ts`, `src/render/art.ts`, `src/render/curb.ts`, `src/render/weatherfx.ts`, `src/render/weather.ts`, tests under `tests/render`.
- IMPORTANT F1 S1, F1 S3, F1 S4, F3 S2: one reset path on world swap clears layer membership, signs, strips, curb doors and weather easing (the tower-switch family, renderer half).
- IMPORTANT F1 S2 and ADVISORY new S5: people are picked where they are drawn, only when drawn.
- IMPORTANT F2 S1 and ADVISORY new S4: ghost and shaft textures are capped at the GPU limit (tiled or clamped), baked once per span height, and freed when the drag ends; the phone step in Coverage gaps closes the severity question.
- IMPORTANT F3 S1: during a fire the curb figures wait or turn back, none reach the door.
- ADVISORY F1 S5, S6, S7, S8; F2 S2, S3, S5; F3 S3, S4.

### P6b Audio (Opus)
Files: `src/audio/audio.ts`, `src/audio/score.ts`, `src/audio/mood.ts`, tests under `tests/audio`.
- IMPORTANT G S1: incident tension clears on the incident's end event whether or not sound is on, and on a world swap.
- IMPORTANT G S2: a world swap resets chapter, tempo and key from the new world (decision 4 also settles G S5).
- ADVISORY G S3, G S4, new S6.

### P7 Hosting, pages, deploy, scripts (Sonnet, fully specified)
Files: `404.html`, `vite.config.ts`, `deploy/deploy.sh`, `deploy/README.md`, `deploy/compose.yml`, `public/_headers`, `scripts/make-store-shots.mjs`, `src-tauri/capabilities/default.json`, `tests/site/stores.test.ts`.
- IMPORTANT H S1: 404 page and manifest description lose Steam, the stores line and the GitHub link; the stores test covers every page and the manifest.
- ADVISORY H S2 (`--force-recreate` on the compose step), H S3 (runbook order: detach the Workers domain before the A record; curl checks pinned to pi3 with `--resolve`), H S4 (precache glob limited to /play/ assets), H S5 (shots script reads og.png and the wordmark from `public/`), H S6 (closer scene zoom that does not snap), H S7 (capability list cut to read, write, exists, mkdir, rename under app data), H S8 (rules keyed to the page paths), H S9 (a dated snapshot per run, the last three kept), new S7 (comment).

### P8 Tests as guards (Sonnet, fully specified)
Files: new or extended tests only, under `tests/sim`, `tests/scenarios`, `tests/game`.
- ADVISORY I S1 to S5, S7 to S10: one test each, with the input from the lane I verification report; each is a guard that passes on current code and goes red on the named mutation (the agent proves the red in a scratch overlay, never in the repo).

## Order and concurrency

| Wave | Packages | Notes |
|---|---|---|
| 1 | P1, P2, P4, P5, P7 | five agents, disjoint files |
| 2 | P3, P6a, P6b, P8, P5b | P3 after P1 merges; P5b after P5 merges |
| 3 | fix review | one verifier re-runs every probe under `docs/reviews/audit-2026-09-25/probes/` against the branch; a checkpoint on the whole diff |
| 4 | closeout | full test run once, typecheck, build, the nginx-container console grep from the gotchas, then the ship; Matt gave the go for the whole run on 2026-09-25 ("kicks this right off end to end with no interruptions") |

Estimated agent count: 10 implementers plus 2 reviewers. Save format moves to v6 (P3), so the version stamps and SHIPPED.md say so.

## What closes each severity

- CRITICAL and IMPORTANT: the finding's own "Evidence to close" in REVIEWS.md, met by a named test in the package, checked by Fable at merge.
- ADVISORY: the same, or a one-line closure quoting the changed code, for the comment-only items.
- Three items keep a device step (phone GPU, iPhone audio session, Mac Cmd key); they close only when Matt or a device run reports the result, and stay open as ADVISORY otherwise.
