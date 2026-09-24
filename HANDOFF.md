# Handoff: 2026-09-20b performance round, rent, sixth ship

Written at the end of the session that shipped 0.2.3 (tag `ship-2026-09-20b`). Everything below is a claim with a check. Run the check before trusting the claim.

> **Checked 2026-09-20 (next session):** section 1 route cache: exact, invariant comment and same-minute car range test added; section 1 rent row: verified in a driven browser at 390 px, and its label no longer elides; section 1 riding sims: not a bug, a riding sim is drawn by its car; section 2 vite-node pin: still matches; section 3 and 8: settled by the comment above `cacheOf`; section 5 REVIEWS heading: renamed, lint down to the long decision lines. Left as recorded: the stepOnce hack, the rent-as-percent regret, the ?perf overlay wish.

## 1. Blind spots

**Claim:** The route cache in `src/sim/routing.ts` (searches keyed per origin tile and game minute, line ~277) was only proven equivalent on the three benchmark towers and the scenario tests, never on a tower with a mid-day build, a demolished shaft, or per-car range changes inside the cached minute.
**Evidence:** The hash script ticks static towers; commands set `routingDirty`, which throws the cache away, but no test builds a shaft between two trips in the same minute.
**Check:** `npx vitest run tests/sim/routing.test.ts`, then write one case: start two trips in one minute, apply `shaft.setCarRange` between them, assert the second trip's route differs from the first when the range excludes its floor.
**Priority:** soon

**Claim:** The rent row in the room panel (`src/ui/panels.ts`, `rentText` and the Rent row) has never been rendered by a test or a driven browser; it was verified by reading the code.
**Evidence:** The suite has no DOM environment (no jsdom); the headless boot only checks the game mounts. The `hidden` attribute on Reset works because `.hs-btn` sets no `display` rule.
**Check:** Open https://hundredstories.xyz/play/?new on a phone, build an office, tap it, confirm the Rent row with −, +, Reset and the "per quarter now" figure.
**Priority:** soon

**Claim:** Viewport culling in `reconcileSims` uses a sim's raw position; a sim mid-ride in an elevator car has `pos.x` at the shaft and `pos.floor` at the boarding floor until it alights, so a car crossing the screen may show no rider sprite until arrival.
**Evidence:** I never looked at how riding sims are drawn relative to the car; the culling margin is one full viewport so this only matters when a shaft is off screen and the car reaches an on-screen floor.
**Check:** Zoom in on a tall shaft with riders, pan so the boarding floor is more than a screen away, watch whether riders appear as the car arrives.
**Priority:** whenever

## 2. Time bombs

**Claim:** `scripts/bench/README.md` pins `npx vite-node@6.0.0`, which is not a repo dependency and will stop matching the local Vite major on the next Vite upgrade.
**Evidence:** vite-node was pulled by npx from the cache this session; nothing in package.json declares it.
**Check:** `npx vite-node@6.0.0 scripts/bench/hash.ts` prints six hashes ending 823b38bb / d4023cca for the large tower; if it errors after a Vite bump, add vite-node as an exact devDependency.
**Priority:** whenever

**Claim:** The routing cache is a module-level `WeakMap<World, RoutingCache>`; a world object that lives across many saved days accumulates nothing, but `cache.searches` is only cleared when the minute changes, so a pathological minute with thousands of distinct origin tiles holds them all until the next tick.
**Evidence:** 327 distinct origins over a four-hour rush on the 4,920 tower; bounded in practice by tile count.
**Check:** `npx vite-node@6.0.0 scripts/bench/bench3.ts`; the large tower's worst 5% stays under 25 ms.
**Priority:** whenever

## 3. Least certain

**Claim:** Caching the settled search for a whole game minute is behaviour-identical to searching per trip, including when elevators move within the tick.
**Evidence:** Six world hashes identical before and after on frozen copies of the tree, 604 then 611 tests green. Settled while writing this note: `buildGraph` (line ~112-140) reads `world.shafts`, each shaft's cars for their range and rider setting, and `world.rooms`; `runSearch` reads only the graph and the origin. No car position, door state or hall call is read, so the cache is exact for as long as the graph stands, and `routingDirty` rebuilds it on every build command. The per-minute clear is belt and braces, not a correctness need.
**Check:** `npx vite-node@6.0.0 scripts/bench/hash.ts` after any change to `src/sim/routing.ts`; the six hashes must not move. If someone later makes the search read car positions or queue lengths, the cache must go.
**Priority:** soon (write the invariant as a comment above the cache)

## 4. Design regret

**Claim:** The rent setting should have been a per-room absolute dollar figure with the percent as the UI, not a percent stored on the room; a future rebalance of `incomePerQuarter` silently changes every player's set rent.
**Evidence:** `Room.rent` is a percent (50..150) in `src/sim/types.ts`; the stored value survives a table change but its meaning does not.
**Check:** `grep -n 'rent' src/sim/types.ts src/sim/economy.ts`. Stopped by: the round was scoped to ship the same session and a percent kept the save format at version 2 with a trivial default.
**Priority:** whenever

## 5. Hacks ledger

**Claim:** `stepOnce()` is on the `Game` interface purely so tests can drive one timer step; nothing in the app calls it.
**Evidence:** Added at closeout to close the two testing findings; `grep -rn stepOnce src` shows only the definition and the test.
**Check:** `grep -rn 'stepOnce' src tests`. Real fix: move the loop into its own module with an injected clock so the game shell does not expose it.
**Priority:** whenever

**Claim:** The "Closeout sweep 2026-09-20b" section heading in `.itworks/REVIEWS.md` is not one of the linter's sanctioned headings and adds a warning, like the four post-ship headings before it.
**Evidence:** The linter reported five heading warnings at session start; I added a sixth.
**Check:** `bash /Users/matthew/parallax-private/Projects/itworks/scripts/itworks-lint.sh .` and read `references/state-format.md` for the sanctioned heading, then rename.
**Priority:** soon

## 6. Decided NOT to do

- No jsdom devDependency for a room panel test. A dependency choice does not belong in a ship round; the panel was verified by review. Revisit if a second DOM-only panel bug appears.
- No by-kind room index. `pickRoomOfKind` still scans every room per trip; cheap now (the search was the cost), but it is the next ceiling if lunch crowds grow. The Opus specialist flagged it.
- No worker for the autosave. An idle callback moved the 8 ms stringify off the tick step; a worker would need a structured clone of a multi-megabyte world and was not worth it.
- No dedicated rent for commerce rooms. Shops, food and cinema earn per visit; a "price" knob is a different mechanic. Recorded in `docs/BACKLOG.md` only if Matt asks.
- No itworks.build publish. Standing rule: needs Matt's explicit per-publish yes.

## 7. Tribal knowledge

- The five implementers ran in parallel on disjoint files; the only collision risk was `src/sim/types.ts` (log counter and rent both touched it). It worked because both used exact-string edits in different regions. Do not run two agents on the same function.
- `bench4.ts` numbers taken while another agent edits `src/sim` are noise; the first run showed no improvement for that reason. Measure only on a quiet tree.
- The headless Chrome boot check works from `vite preview` on a port no other project uses (4199 here); port 4173 is shared with other projects' service workers (MAP.md gotcha).
- The closeout skill switches the session model to Opus and back; the sweep itself was delegated to a `senior-implementer` subagent so it ran in the background per Matt's "keep it light" rule.

## 8. Skeptic's flag

**Claim:** A hostile reviewer points at the Dijkstra cache first: "you cached a search across a minute and proved it with six hashes on synthetic towers; show me the invariant, not the coincidence."
**Evidence:** Section 3 above. The invariant is that `runSearch` depends only on the graph (rooms, shafts, car settings) and the origin, never on car positions or queues.
**Check:** Done at the end of this session, see section 3: the search reads structure only. The remaining ask is the comment naming the invariant above the cache in `src/sim/routing.ts`.
**Priority:** whenever

## 9. Wishlist

**Claim:** A live performance overlay (tick ms, frame ms, sim count) behind `?perf` would have found this freeze weeks earlier and will find the next one.
**Evidence:** The whole diagnosis needed a bench harness written from scratch.
**Check / first step:** in `src/game/game.ts` record `performance.now()` around `drainTicks` into a ring of 120 values; in `src/ui/ui.ts` show p50 and max when `?perf` is in the query, dev only like `?smoke`.
**Priority:** whenever

## 10. Next steps

1. Write the cache invariant as a comment above `cacheOf` in `src/sim/routing.ts` (section 3): the search reads rooms, shafts and car settings only; if it ever reads car positions or calls, the cache must go.
2. Add the in-minute build test to `tests/sim/routing.test.ts` (section 1) and run `npx vitest run tests/sim/routing.test.ts`.
3. Rename the REVIEWS.md sweep heading to the sanctioned form and run `bash /Users/matthew/parallax-private/Projects/itworks/scripts/itworks-lint.sh .` to zero warnings.

---

# Addendum: 2026-09-23 Hundred Stories design review

Note added 2026-09-24: the packages this addendum said were not yet built landed later on 2026-09-23 (packages 0 to 8, see DECISIONS.md and the 2026-09-24 checkpoint in .itworks/REVIEWS.md). The checks below describe the state before that work and are kept for the record.

The creative brief is `docs/reviews/2026-09-23-visual-audio-direction.md`; the agent-ready work packages and pass criteria are in `docs/reviews/2026-09-23-execution-plan.md`. Neither is an implemented feature. This addendum records what the next session should verify before building them.

## 1. Blind spots

**Claim:** The proposed illustrated art and weather masks have not been rendered in the game.
**Evidence:** This session inspected the procedural renderer and current phone/tablet captures, then wrote a direction document; it made no graphics code or assets.
**Check:** `npm run store:shots` after a visual slice exists, then inspect phone, tablet, and desktop output in `store/shots/` for room legibility and rain outside the cutaway.
**Priority:** blocker-for-next

**Claim:** The new score has not been composed or listened to on target devices.
**Evidence:** The audio pass read `src/audio/audio.ts` and event hooks; no recorded score or physical phone listening test exists.
**Check:** `rg --files public src/audio | rg '\.(ogg|mp3|wav|m4a)$'`, then play the first score slice on a phone speaker and headphones for 20 minutes.
**Priority:** soon

## 2. Time bombs

**Claim:** Loading an entire 35–50 minute score as decoded Web Audio buffers would put unnecessary memory pressure on phone builds.
**Evidence:** Current `src/audio/audio.ts` only synthesizes short sounds and a small ambient buffer; the proposed soundtrack is far larger.
**Check:** `rg -n 'decodeAudioData|createBufferSource|Audio\(' src/audio` after implementation; profile memory while switching from one star chapter to another on a phone.
**Priority:** soon

## 3. Least certain

**Claim:** A six-chapter, 35–50 minute score is the right production scale for long play.
**Evidence:** Matt rejected the first small-loop proposal as lacking grandeur; no composed vertical slice has established the exact duration or density.
**Check:** Produce the 1-star, 3-star, and Tower slices specified in the review, then listen across a 20-minute session at each stage before committing the remaining chapters.
**Priority:** soon

## 4. Design regret

**Claim:** The first audio brief sized the game around one short theme and too few cues.
**Evidence:** It missed the six-star progression, VIP/wedding significance, and the requested grand scale; the review document now carries a full chapter plan.
**Check:** `rg -n 'Score the \*whole rise\*|35–50|Tower, landmark' docs/reviews/2026-09-23-visual-audio-direction.md`.
**Priority:** whenever

## 5. Hacks ledger

None. This design review changed documentation only.

## 6. Decided not to do

**Claim:** Freeform AI dialogue, a 3D camera rebuild, and weather inside rooms are outside the selected direction.
**Evidence:** The game promises offline/private play and a clear side-on cutaway; authored event-driven lines and exterior weather fit those constraints.
**Check:** `rg -n 'Story approach|Visual direction choice|Weather is outside' docs/reviews/2026-09-23-visual-audio-direction.md`.
**Priority:** whenever

## 7. Tribal knowledge

**Claim:** Security, recycling, and VIP visits exist as progression systems but do not yet create the intended visible character stories.
**Evidence:** `securityOnDuty` checks only for a room; recycling is a star prerequisite and upkeep cost; `tickVip` places the guest directly in a suite and scores stress.
**Check:** `rg -n 'securityOnDuty|tickVip|recycling' src/sim/events.ts src/sim/stars.ts src/sim/rules.ts`.
**Priority:** blocker-for-next

## 8. Skeptic's flag

**Claim:** Story cards could become decorated status messages rather than stories if they do not record a real setup, setback, player-relevant change, and outcome.
**Evidence:** The current person panel has only position, activity, stress, and leaving reason; the proposed arc has not been played.
**Check:** After a story slice exists, drive one saved worker or guest through a long wait, tower improvement, and later successful trip; inspect the person card and chronicle for factual continuity.
**Priority:** blocker-for-next

## 9. Wishlist

**Claim:** A locally saved Tower chronicle would make the game's name and final star feel earned.
**Evidence:** The landing page promises every floor and person has a story, while the current star change only logs a line; the review proposes a bounded record of real lives and events.
**Check:** `rg -n 'Why Hundred Stories|Every floor is a story' index.html how-to-play/index.html` and compare a proposed endgame chronicle with `src/sim/stars.ts`.
**Priority:** soon

## 10. Next steps

**Claim:** The first implementation should prove a person's story and the new art together in a small playable slice.
**Evidence:** The review names a worker or resident, guest, venue visit, and five new people as a test of identity and causality.
**Check:** Open `docs/reviews/2026-09-23-visual-audio-direction.md`, then `src/sim/people.ts`, `src/ui/panels.ts`, and `src/render/art.ts` before coding.
**Priority:** blocker-for-next

**Claim:** VIP travel should be repaired before new hostile and collection loops are added.
**Evidence:** The four-star VIP gate exists but `tickVip` teleports the guest to the suite, leaving little tower experience to rate.
**Check:** `sed -n '260,335p' src/sim/events.ts` and `sed -n '105,115p' src/sim/rules.ts`.
**Priority:** soon

**Claim:** Weather and audio should share one state and semantic event vocabulary.
**Evidence:** Current `src/render/sky.ts` has only day/night, while `src/audio/audio.ts` maps all alert logs to one effect.
**Check:** `rg -n 'KEYFRAMES|effectFor|case .log.' src/render/sky.ts src/audio/audio.ts`.
**Priority:** soon
