# Lane G: Audio and Steam at 0f05723

Host arm64 (`uname -m`). Checkout: scratchpad/audit-0f05723. Probe scripts live in scratchpad/audit-2026-09-28/laneG/ and run from the checkout root with `npx vite-node@6.0.0 ../audit-2026-09-28/laneG/<file>`.

Fixes from the 2026-09-25 audit, checked rather than re-raised:
- S1 (stuck tension): holds. `syncThreat` runs on wake (audio.ts:730) and on a tower switch (audio.ts:906).
- S2 (stale tempo, key and chapter after a switch): holds through `checkWorld` (audio.ts:891-909).
- S3 (stars gained while off): holds (audio.ts:723-724).
- S4 (on then off before the resume lands): holds through `resumeGuarded` (audio.ts:638-640).
- S5: settled. The chapter now follows the current stars, down as well as up.
- N1 (drone lost on a toggle): holds.
- Tests G S1a to S4 pass.

## Suspicions

### S1. A save with a non-number room occupancy puts NaN into the mood for good; with sound on, every tick frame then throws, so render and autosave are skipped (proposed: IMPORTANT)
- Where:
  - src/audio/mood.ts:14 and :82. `clamp` and `venueFillFor` pass NaN through.
  - src/audio/audio.ts:689, :972 and :964. AudioParam writes of NaN, then `easeMood` keeps the NaN.
  - The root cause is shared with lane D: src/sim/save.ts:302-330 never checks `room.occupancy`, and :697-700 copies it as it is.
- Input: open a saved file (or boot a slot) where a restaurant, shop, cinema, fast food or party hall has `"occupancy": "x"` (or `{}`), with Sound on.
- Wrong outcome:
  - The file loads, `venueFillFor` returns NaN, and `moodFor` gives energy and warmth NaN.
  - Browsers throw a TypeError on a non-finite AudioParam value (WebIDL `float`).
  - On the first gesture, `wake` throws at audio.ts:689 halfway through building the graph. On the second gesture it subscribes, then `onClock` throws at :972.
  - From then on, every game minute change throws out of `notify` (game.ts:279) and out of `advance()` (game.ts:369). `maybeAutosave` (game.ts:370) and `renderer.render` (game.ts:670) never run on a frame that ticked.
  - A tick is one game minute, at 10 per second at 1x and 80 per second at night. So at night every frame is skipped: the tower picture freezes, and the 5 AM and quarter autosaves stop for the session.
  - Music is silent. `setSoundOn` throws before `announcePref`, so the button can show the wrong state.
  - The hourly recount repairs the room (people.ts:86), but `easedMood` stays NaN for the rest of the session. `targetForBar` is never reached, a tower switch does not reset it, and an off-and-on toggle does not either. Only Sound off stops it.
- Reproduce: `p1-save.ts` prints `occupancy "x" LOADED; venueFill = NaN mood = {"energy":null,"warmth":null,...}`. `p2-nan.ts` drives the real `createSound` with a stub context that throws on non-finite values and prints:
  - `first pointerdown ... THREW`
  - `100 tick frames: frames that got past notify() = 0`
  - `after occupancy repaired: frames past notify = 0`
  - `sound off: frames past notify = 10 of 10`
- Fix direction: in the loader, refuse a non-integer or negative occupancy (lane D). In audio, treat a non-finite `venueFill` or mood axis as 0 in `clamp` and `venueFillFor`, so audio can never throw into the game loop.

### S2. Turning Sound off then on quickly, or hiding and showing the page quickly, leaves the context suspended with Sound on (proposed: ADVISORY)
- Where: src/audio/audio.ts:776 (a suspend with no guard) against :709 (`wake` resumes only when the state is `'suspended'`), and :651 (`onPageShown` has the same check).
- Input:
  - Sound is on and running. Tap Sound off, then on, before `suspend()` settles.
  - Or the page hides and shows within the suspend window, for example an iOS app-switcher peek.
  - WebKit and Gecko report the new state only when the promise settles. Chromium flips it at once, so Chrome is not affected.
- Wrong outcome:
  - `wake` and `onPageShown` still see `'running'` and do not resume.
  - The pending suspend then lands. Sound shows on, but everything is silent until the next pointerdown or keydown.
  - This is the mirror of the old S4: `resumeGuarded` re-checks after a resume, but nothing re-checks after a suspend.
- Reproduce: `p3-race.ts` uses a stub whose state changes on settle. It prints `A. off then on before the suspend lands: settings.on = true state = suspended` and `B. page hidden then shown ...: settings.on = true state = suspended`.
- Fix direction: chain `.then(() => { if (settings.on && !dozing && gestured) resumeGuarded(ctx) })` onto the suspends at :644 and :776.

### S3. When two incidents overlap, the first one to end clears the tension while the other still burns (proposed: ADVISORY)
- Where: src/audio/audio.ts:807-813. `endThreat` sets `threat='none'` without checking the world. src/sim/events.ts:922-926 can start a fire and a bomb in the same 06:00 roll.
- Input: a fire and a bomb start the same morning (audio follows the bomb, since it was heard last). The player pays the ransom while the fire still burns.
- Wrong outcome:
  - `bomb.resolved` ends all tension: the music un-ducks, the drums return, and elevator bells ring during the fire.
  - The later `fire.resolved` is dropped (`threat !== 'fire'`), so no release cue plays.
  - A theft that is still acting when a fire ends is also silent.
- Reproduce: `p4-firebomb.ts` prints:
  - `ransom paid, fire still in world.events: 1 | tension false tensionLevel 0`
  - `elevator bell oscillators while the fire burns: 4`
  - `fire.resolved later: release cue oscillators = 0`
- Fix direction: after a release, call `syncThreat()` (re-derive from `world.events`) instead of clearing outright.

## Questions for the owner
- The gesture listener hears only `pointerdown` and `keydown` (audio.ts:634-635). The HTML activation rules count a touch `pointerdown` only on `pointerup` or `touchend`. With Sound saved on, a phone reload may stay silent until the Sound button's own click, which does carry activation. Was the saved-on reload checked on an iPhone? This is a device question, not a finding. See Coverage.
- Steam, unchanged since the last audit: a tower opened in session with more stars than `best` is not reported until the next boot or the next rise. Is that fine for achievements?

## What the tests do not prove
- tests/audio/audio.test.ts:
  - `StubContext.suspend` flips the state synchronously while `resume` can be deferred, so the off-then-on race (S2) cannot appear.
  - Every stub AudioParam accepts NaN, so no test would see S1's TypeError.
  - No test covers two live incidents where the one heard first ends first (S3).
  - No test shows that a throwing sound listener is contained.
  - Gestures are synthetic `pointerdown` calls. Which real events carry activation on iOS or Android is untested.
- tests/audio/mood.test.ts and lofi.test.ts: no non-finite input to `moodFor` or `venueFillFor`. The lofi stub's `setTargetAtTime` ignores its argument.
- tests/audio/presets.test.ts: dev gating is proven through `applyDevAudio` only. Nothing checks that the production bundle leaves out presets.ts and wav.ts.
- tests/game/steam.test.ts:
  - No test of a synchronous throw from `invoke`. The default `tauriInvoke` is async, so none is reachable.
  - No world swap.
  - The Rust side is tested only with the steam feature off, and only in its own `cargo test` (not run here).

## Coverage
- Read in full:
  - src/audio/audio.ts, arrangement.ts, cues.ts, drums.ts, mood.ts, phrase.ts, presets.ts, score.ts, wav.ts
  - src/steam/steam.ts
  - src-tauri/src/achievements.rs, lib.rs, main.rs; src-tauri/Cargo.toml
  - src/ui/sound-toggle.ts
  - tests/audio/*.test.ts (5 files), tests/game/steam.test.ts
  - .itworks/DECISIONS.md
  - docs/reviews/audit-2026-09-25/lane-G.md and verify-G.md
- Read in part for tracing:
  - src/sim/events.ts: every incident start and end path
  - src/sim/save.ts: room validation and load
  - src/game/game.ts: notify, advance, drawFrame, subscribe, swapWorld and autosave
  - src/game/weather.ts, src/sim/story.ts BeatCode, src/game/storage.ts isTauri
  - the MAP.md Gotchas
- Skipped: none in scope. `cargo check` and `cargo test` were not run: they would compile the whole Tauri tree, and the Rust side is small enough to verify by reading. The report_star path is unchanged since 7b4e60f.
- Device gap: on an iPhone in Safari, set Sound on, reload /play/, tap the tower canvas once (not the Sound button), and check whether music starts. Repeat on Android Chrome.
- Probes run:
  - `npx vitest run tests/audio tests/game/steam.test.ts`: 6 files, 108 tests, all pass.
  - `p1-save.ts`: a save with non-number occupancy loads, and the mood is NaN.
  - `p2-nan.ts`: 0 of 100 tick frames get past notify, it persists after the repair, and Sound off clears it.
  - `p3-race.ts`: both races end suspended with Sound on.
  - `p4-firebomb.ts`: tension is cleared while the fire burns, and the fire's release cue is dropped.
- Invariants that held:
  - No AudioContext exists before a gesture with Sound on. Sound off releases the timers, sources, the bed and the subscriptions.
  - The score never reads `world.rng` or writes the world. `Math.random` appears only in the noise buffers and the cricket gate.
  - The chapter on a reload matches the chapter in session.
  - A cue during a chapter change does not throw.
  - Steam is inert outside Tauri, and a rejected invoke is swallowed.
