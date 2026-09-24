# Hundred Stories: execution plan for stories, art, weather, services, and sound

Status: implementation handoff, based on code at `34a7e07` and the companion [direction review](2026-09-23-visual-audio-direction.md). This file defines work units and pass criteria. The direction review explains the creative choices and current-state findings.

## Outcome and constraints

Players should recognize people and venues, learn what individuals want, see events change their lives, and remember those lives when the tower reaches a new star. The game should retain its side-on cutaway and a little retro texture while looking and sounding contemporary. The score should grow from an intimate one-star building to a full Tower landmark.

- Keep the browser/PWA, phone, tablet, and desktop builds working offline. Preserve existing saves and the deterministic simulation.
- Keep the saved master Sound switch, currently off by default. Music, ambience, and effects must all obey it.
- Weather occurs outdoors. Rain, lightning, puddles, and wind belong to the sky, façade, roof, windows, and street, never to room interiors.
- Use authored, bounded story text from recorded events. No network dialogue service or per-tick prose generation.
- Work in the numbered packages below. One package is one reviewable change; do not combine all simulation, art, and audio work into one giant diff. Packages sharing `src/sim/types.ts`, `src/sim/save.ts`, or `src/sim/events.ts` run sequentially.

## Dependency map

| Package | Depends on | Deliverable |
| --- | --- | --- |
| 0. Baseline and contracts | none | Updated visual contract, reference captures, asset briefs, event taxonomy |
| 1. Person stories | 0 | Stable identity, truthful story beats, person/room UI, save migration |
| 2. Illustrated slice | 1 | Five people, office, shop, restaurant, elevator, exterior entry scene |
| 3. Exterior weather | 0; may follow 2 for final art | Sunshine, overcast, rain, storm in one shared state and readable exterior rendering |
| 4. VIP journey | 1 | Named visitor follows real routes; experience controls rating |
| 5. Guards and hostile visitor | 1, 4 | Visible guard dispatch and one hostile-person encounter |
| 6. Recycling round | 1 | Collection worker, bounded waste load, service outcome |
| 7. Adaptive audio | 0, 1; 3–6 for their final cues | Six score chapters, location sound, event cues, mixer and controls |
| 8. Chronicle and rollout | 2–7 | Milestone retrospectives, remaining room/people art, landing/guide copy |

Audio composition and illustration asset production can begin after package 0 while code packages run. Final integration cannot pass without finished original assets; placeholder tones or repeated furniture are not the requested result.

## Shared contracts to settle in package 0

1. **Semantic events:** Add stable optional codes and entity IDs to relevant `LogEntry`/game events, or one equally small typed event path, so stories and audio never parse English log text. Required first codes: `wait.long`, `trip.gaveUp`, `trip.arrived`, `room.vacated`, `fire.started/resolved`, `bomb.started/resolved/failed`, `vip.notice/arrival/rated`, `star.gained/lost`. Extend for guards, collection, and wedding when those packages land. Keep existing log wording and UI working.
2. **Person identity:** A pure function of `world.seed`, `sim.id`, kind, and existing schedule yields a stable name, look key, and restrained voice key. It must not consume `world.rng`; existing saves should display identities immediately. Every live person has a current goal derived from their actual schedule/route and a grounded line even with no history.
3. **Story memory:** Add a compact `StoryBeat` `{ code, minute, simId?, roomId?, value? }`. Keep a capped recent tower list (start at 256) and a capped followed cast (start at 8 people, up to 6 beats each). Record beats only at transitions. Render prose when a panel opens. Persist the bounded state in the next save version, validate it on import, and default old saves safely. Story-only data remains out of gameplay RNG and world hashes.
4. **Weather:** `src/game/weather.ts` should expose a pure `weatherAt(seed, minute)` snapshot shared by renderer, UI, audio, and story prose. States: `sunny/clear`, `overcast`, `rain`, `storm`, with intensity and transition timing. Derive it without consuming simulation RNG. Story beats that mention weather must store or reconstruct the weather at their event minute.
5. **Asset production:** Keep editable original source art/music and a small manifest of authored assets, variants, credits, and permitted use. Define performance and file-size baselines from the representative tower before filling all 22 room kinds or loading the full score.

## Package 0 — baseline and prototype brief

**Files:** `docs/VISUAL.md`, this plan, `store/fixtures/demo-tower.json`, `scripts/make-store-shots.mjs`, relevant benchmark scripts.

**Do:** Update the visual contract to allow higher-resolution illustrated layers and smooth silhouettes inside the same floor grid. Capture the current game at desktop, phone, close, and far zoom, plus day/night. Record baseline build size, large-tower save size, and frame/tick measurements. Write a one-page art sheet for one office/shop/restaurant/person set and a music sheet for the ascent and lives-inside motifs. Freeze the event code and weather interfaces above before another package consumes them.

**Pass:** Reference images and measurements are saved with the package; art/audio sample briefs show the same tower identity; no gameplay code or save format changes yet.

## Package 1 — a person can tell a true story

**Files:** `src/sim/types.ts`, `src/sim/world.ts`, `src/sim/people.ts`, `src/sim/evaluation.ts`, `src/sim/save.ts`, new `src/sim/story.ts`; `src/game/events.ts`; `src/ui/panels.ts`, `src/ui/ui.ts`, `src/ui/ui.css`, `src/ui/onboarding.ts`; matching tests.

**Do:** Implement the shared event and identity contracts. Start with worker commute, resident quiet/home, hotel guest stay, and housekeeper round. A thread has introduction, goal, observed setback, later outcome, and an unhappy path. The person panel shows **Who**, **On their mind**, **Recent chapter**, **What helps**. Room panels link to occupants because normal rendering samples one in four people; add Follow and a quiet recent-stories entry point without another persistent HUD row. Keep alerts above story lines in the ticker. A person leaving keeps a short closing beat in the bounded chronicle. Introduce the first person story in onboarding.

**Pass:** A reproducible test tower can show one worker's long wait, a later shorter trip after a relevant tower change, and an accurate story card. The text states the observed before/after; it does not claim unproven causation. Save/load preserves followed history; a v1–v3 save still loads; seed plus commands reproduces the same story facts. At 15,000 people, story storage remains bounded and no prose is assembled per tick.

## Package 2 — illustrated character and venue slice

**Files:** `src/render/art.ts`, `src/render/anim.ts`, `src/render/renderer.ts`, `src/render/palette.ts`, `src/render/ambient.ts`, `src/ui/panels.ts`, `docs/VISUAL.md`; authored art files if used; render tests.

**Do:** Keep 16 px tile/72 px floor geometry and selection behavior. Re-author five person silhouettes with role props and calm/impatient/activity poses; use the stable look key from package 1. Re-author one office, shop, restaurant, and elevator with several deterministic venue treatments, lighting, and occupancy overlays. Make the active person and venue match their panel identity. Add a small lobby/curb arrival scene. Layer motion separately from cached structural room textures. Show simplified category shapes at far zoom; keep reduced-motion states informative.

**Pass:** At phone, desktop, and far zoom, the five people and three venues are distinguishable without reading labels. Selecting a person or room still hits the correct entity. Screenshot comparisons show occupied rooms remain more prominent than repeated windows and stairs. Large-tower frame and texture-memory measurements stay within the package 0 budget; if they do not, reduce atlas/variant cost before expanding art.

## Package 3 — sunshine, rain, and storms outside

**Files:** new `src/game/weather.ts`; `src/render/sky.ts`, `src/render/light.ts`, `src/render/renderer.ts`, `src/render/ambient.ts`; `src/ui/status.ts`; weather/render tests.

**Do:** Implement stable sunny/clear, overcast, rain, and storm patterns. Sun brings directional warmth and dry street detail. Rain brings cloud cover, exterior window streaks, roof runoff, wet street reflections, and umbrellas at the entrance. Storm adds dark exterior cloud banks, wind-driven rain, sparse sky lightning, and wet façades. Clip foreground weather to exterior geometry: no drops, puddles, or wind in interior room cells. Indoor lamps stay legible. Add a small clock-adjacent weather readout. Respect reduced motion and reduced flashing. Transition slowly in real time even when game minutes race by.

**Pass:** Day and night captures at phone/desktop show all four states from the tower view; room interiors stay dry and selectable; a reduced-motion storm has no jarring flash. `weatherAt` is deterministic across save/load and does not change the simulation hash. Audio later reads this same snapshot.

## Package 4 — make the VIP visit a real journey

**Files:** `src/sim/events.ts`, `src/sim/people.ts`, `src/sim/rules.ts`, `src/sim/types.ts`, `src/sim/save.ts`, star/story/UI tests.

**Do:** Keep one-day notice and the fair-or-better four-star requirement. Give the VIP a stable identity and a visible itinerary: entrance, elevator route, suite, checkout. Replace the direct suite placement in `tickVip` with normal movement and recorded waits. Score the stay from actual wait, suite evaluation/cleanliness, and any modeled safety incident. Show the guest's preference, preparation checklist, score breakdown, and next possible opportunity. Tune thresholds with scenario tests so fair is achievable by a competent tower and poor has an intelligible cause.

**Pass:** The VIP can be seen traveling; a bad elevator/dirty suite can lower the rating; better service can improve the next visit. The four-star gate remains reachable and its reason is visible. A deleted suite or unreachable route ends with a coherent failed visit, never a stuck event. Save/load during notice, route, and stay resumes correctly.

## Package 5 — guards and one hostile encounter

**Files:** `src/sim/types.ts`, `src/sim/events.ts`, `src/sim/people.ts`, `src/sim/rules.ts`, `src/sim/save.ts`, possibly new `src/sim/security.ts`; renderer art/animation; UI and audio event tests.

**Do:** Give security-office capacity visible guard sims with shifts or patrols. Add one low-frequency hostile visitor type, initially a shop thief, who enters, travels to a real target, acts, and leaves or is intercepted. A guard must travel/dispatch; office presence alone cannot instantly resolve the incident. A successful or failed response records target, responder, loss/avoidance, and a story ending. Keep fire/bomb response behavior working while moving it toward visible dispatch. Place threat symbols and sounds only on real threats; include cooldowns so a busy tower is playable.

**Pass:** A seeded scenario shows guard and visitor routes, detection, catch/escape, and understandable consequences. With no viable guard route, an incident can fail visibly. The player can improve coverage through existing building/shaft choices. Pausing, saving, and loading mid-encounter preserves its state. No threat cue fires for unrelated alerts.

## Package 6 — collection workers make recycling useful

**Files:** `src/sim/types.ts`, `src/sim/rules.ts`, `src/sim/evaluation.ts`, `src/sim/save.ts`, new or existing service logic in `src/sim/people.ts`; room/worker art; UI tests.

**Do:** Give active rooms one aggregate daily waste load derived from visits/occupancy, with a small cap. Assign a named collection worker a route from room to recycling center. A missed round becomes a visible backlog and only after a grace period affects room cleanliness/evaluation. Do not create one item per piece of trash. Before the center is available, avoid an unwinnable sanitation penalty. Explain capacity and route failures in the recycling panel and worker story.

**Pass:** Collection completes through a reachable route, fails clearly when access/capacity is inadequate, and can recover after a player fix. A large tower does not add per-item sims or unbounded save data. Four-star recycling requirement still works; old saves load.

## Package 7 — score the whole tower

**Files:** `src/audio/audio.ts`, new score/manifest modules under `src/audio/`, original compressed files under `public/audio/`, `src/ui/panels.ts`, `src/game/events.ts`, tests and an audio asset manifest.

**Production deliverables (cut by Matt, 2026-09-23):** no commissioned or recorded score. The direction review's twelve pieces and 35 to 50 minutes are withdrawn: a tower cannot reach TOWER in one sitting, so a player hears one chapter per session and a large library buys nothing. Instead, one generative mood per star chapter (six moods, built in code from the ascent and lives-inside motifs, with phrase-level variation seeded so an hour inside one chapter does not audibly loop), day, night and weekend as parameter changes on the same mood, one 10 to 15 second Tower fanfare, and the cue and location sound set below at whatever count the events actually need. Phase 1 (fc1e71d) shipped chapters 1, 3 and TOWER with fixed per-bar patterns; phase 2 adds the variation and the missing chapters.

**Code:** Add a music bus and slider alongside existing Effects/Ambient, retaining master mute and gesture unlock. Load/stream only current and likely next chapter; decode short cues separately. Choose broad score chapter by highest attained star to avoid rapid swaps on population dips. Keep long-form music on a real-time playhead. The 23:00–06:00 automatic 8x period lasts about 5.25 seconds at 1x and 1.3 seconds at 4x: use a brief nighttime color change, not a full track switch or faster BPM. Weekends can hold fuller arrangements. Weather audio is exterior roof/street/window ambience from `weatherAt`; location layers are interior and should be mixed near the viewed floors. Emergency cues outrank elevator and story sounds, ducking music modestly with a clear resolution. The first hostile cue ships with its actual encounter.

**Pass:** Master mute cuts all buses immediately and persists; an off state constructs no audio context. Repeated lift arrivals stay comfortable; bomb, fire, hostile visitor, VIP, star, wedding, and Tower are audibly distinct. No music thrash at 4x/night, no precipitation treated as interior sound, no full-score decode spike on a phone. Listen for at least 20 minutes at empty lot, midgame, and Tower on phone speakers and headphones. A muted player receives equivalent visual/text alerts.

## Package 8 — milestone chronicle and full rollout

**Files:** `src/ui/ui.ts`, `src/ui/panels.ts`, `src/sim/stars.ts`, story modules, remaining room/character art, `index.html`, `how-to-play/index.html`, `docs/VISUAL.md`, tests.

**Do:** On star gain, offer a short optional recap of real people/places affected since the last milestone beside the new unlocks. At Tower, assemble a bounded local chronicle with actual residents, departures, VIP rating, security outcomes, collection work, and wedding. Make it reopenable and exportable as an image without uploading. Extend the illustrated style to remaining room types and recurring characters. Update site copy that still promises “pixel art drawn in code” and guide copy that describes stress only by body color once the replacement is shipped.

**Pass:** Recaps contain only recorded facts, work after import, and never block play. At least one resident, service worker, threat, VIP, and venue can be followed from the tower to a coherent ending. Landing and guide accurately describe the shipped game; representative store screenshots and offline build still work.

## Required verification on every package

Run `npm test`, `npm run typecheck`, and `npm run build`. Run focused tests for each changed module and capture production-build images for visual/UI packages. For packages 1–3, gameplay hashes should stay unchanged; packages 4–6 intentionally change gameplay, so update hash fixtures only with a written account of which rules changed and prove same-seed replay still matches. Verify import/export from an older v3 save after any save schema change. Use `store/fixtures/demo-tower.json` plus focused seeded scenarios; do not judge art solely from code or audio solely from oscillator tests. Report files changed, evidence, known limits, and the next package's dependency state.

## First assignment to hand another agent

> Implement **package 0**, then **package 1** in separate reviewable changes. Read this plan and the companion direction review first. Keep the simulation deterministic and offline. Start by recording current visual/performance/save baselines and updating `docs/VISUAL.md`; then add semantic event codes, deterministic person identity, bounded story beats, a person/room discovery UI, and v1–v3 save migration. Demonstrate one worker's real setback and recovery in a seeded scenario. Run the required checks and report the screenshot, save/replay, and story evidence. Continue to package 2 only after package 1's pass criteria are met.
