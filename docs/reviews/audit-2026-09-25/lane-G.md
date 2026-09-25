# Lane G: Audio and Steam at 7b4e60f

Host: arm64 (uname -m). Probe script: scratchpad/audit/laneG/probe.ts (run with `npx vite-node@6.0.0 <path>` from the repo root). It drives the real `createSound` with a stub context and a fake game whose `world` can be swapped.

## Suspicions

### S1. Tension stays on for good if the fire, bomb or theft ends while sound is off or after a tower swap (proposed: IMPORTANT)
- Where: src/audio/audio.ts:684-711 (`sleep` never resets `threat`, `tension` or `targetMood.tension`), src/audio/audio.ts:742-748 (the release is only heard through the event stream), src/audio/audio.ts:753 (`if (tension) return` drops every effect)
- Input: sound on, a fire starts (`fire.started` beat). The player turns Sound off. The fire resolves while the sound is unsubscribed (sleep drops `unsubEvents`). The player turns Sound on. Same result with no toggle at all: a fire is burning in My tower and the player opens Today's tower, a friend's tower, a new game or a file. `swapWorld`, `newGame` and `importSave` call `primeTap` (src/game/game.ts:386-388, 905-907, 977-980), so `fire.resolved` is never emitted.
- Wrong outcome: `threat` stays `'fire'`, so `tension` stays true and `tensionLevel` stays 1. `urgent(threat)` keeps the drums and hats at 0 (lines 860, 1014), `targetForBar` keeps re-reading tension 1 through `inputs()` (line 601), so the music stays ducked by 6 dB. Every elevator bell, door, build, rent and star-down effect is dropped (line 753), and ordinary story cues are dropped too (line 750). It only clears when another incident of the same kind resolves (`startThreat` returns early at line 774 because `threat === next`), or on a page reload. It should reset to calm on sleep, on a world swap, or when the world has no active incident.
- Reproduce: probe P1 prints `listeners while off = 0 | after on: tension = true tensionLevel = 1 | oscillators from bell+rentDay = 0`.

### S2. After an in-session tower switch, the new tower plays the old tower's chapter, tempo and key (proposed: IMPORTANT)
- Where: src/audio/audio.ts:555-560 (`highest`, `chapter`, `tempo`, `beatSeconds`, `key` are read once in `createSound`). src/ui/ui.ts:147 creates the controller once per page. A world swap primes the tap, so no `stars` event arrives.
- Input: My tower at 5 stars, seed 1. The player opens Today's tower, a friend's link tower, New game or Open a saved file (1 star, seed 2).
- Wrong outcome: the chapter stays at 5 on a 1-star tower. When the new tower reaches 2 stars the chapter is still 5 (`highest = max(5, 2)`). Tempo and key stay those of seed 1, while `phraseFor` and `drumHitsFor` read the live `game.world.seed` (lines 995, 1018), so the result is a mix of the two towers. A reload of the same tower gives chapter 1, tempo 82 and key 10 instead. So the same tower sounds different depending on which tower the page booted with, and Today's tower never walks up the chapter ladder.
- Reproduce: probe P2 prints `chapter = 5 tempo = 79 | fresh load ... chapter 1 tempo 82 key 10 vs held key 3`, then `tower B reaches 2 stars: chapter = 5`.

### S3. Stars gained while sound is off are not heard when it comes back on (proposed: ADVISORY)
- Where: src/audio/audio.ts:613-674 (`wake` never re-reads `game.world.stars`). src/game/game.ts:1005 primes the tap when the sound resubscribes.
- Input: the player plays with Sound off (or turns it off) at 1 star, reaches 3 stars, then turns Sound on.
- Wrong outcome: the chapter stays at 1 until the next star rise or a reload. A reload gives chapter 3. The chapter should be `max(highest, world.stars)` on wake.
- Reproduce: probe P3 prints `chapter = 1 (reload would give 3)`.

### S4. Turning sound on and then quickly off leaves the AudioContext running (proposed: IMPORTANT, timing-dependent)
- Where: src/audio/audio.ts:659 (`void ctx.resume()`) and src/audio/audio.ts:710 (`sleep` suspends only when `state === 'running'`).
- Input: the context is suspended from an earlier off. The player turns Sound on, then off again before `resume()` settles (resume can take a noticeable moment on iOS Safari).
- Wrong outcome: `sleep` sees `'suspended'` and skips `suspend()`. Then `resume()` settles and the context runs with Sound off. Every bus is at gain 0, but the graph keeps being processed (compressor, limiter, the delay feedback loop). On a phone that keeps the audio thread and hardware awake until the next on and off cycle. `sleep` should always call `suspend()`, or `wake` should re-check `settings.on` when resume settles.
- Reproduce: probe P4 (the stub `resume` is deferred) prints `ctx.state = running settings.on = false`.

### S5. The chapter after a star falls differs between this session and a reload of the same save (proposed: ADVISORY)
- Where: src/audio/audio.ts:555-556 and 717 (`highest` is kept for the session only, seeded from `world.stars`). Stars can fall (src/sim/stars.ts:56-58).
- Input: at 3 stars the tower rises to 4, then falls back to 3. The player saves and reloads.
- Wrong outcome: in this session the chapter is 4. After the reload of that same save it is 3. This breaks the lane invariant "a save and reload picks up the same chapter". Either persist the highest star or derive the chapter from `world.stars`.
- Reproduce: probe P3b prints `in session chapter = 4 | after reload of the same save chapter = 3`.

## Questions for the owner
- S5 depends on intent. Is the in-session "the chapter never drops after a star loss" meant to carry across reloads? The 2026-09-24 ruling covers quality, not whether the chapter goes back down. If yes, the high-water mark needs to live in the save or somewhere it survives a reload. If no, `highest` should follow `world.stars`.
- Steam only reports a rise it sees through `stars` events. A tower opened in session (Today's tower, a friend's tower, an imported file) that already has more stars is not reported until the next boot. Is a delayed unlock acceptable, and should an imported file be able to earn achievements at all? Stars are validated to 1..6 (src/sim/save.ts:254), so there is no out-of-range risk.

## What the tests do not prove
- tests/audio/audio.test.ts: never turns sound off during a threat (S1). Never swaps `game.world` (S2). Never changes stars while off (S3). The stub `resume()` settles synchronously, so the on-then-off race (S4) cannot show. "Off releases everything" is checked only through bus gains and listener counts. `clearInterval` is a no-op stub, so nothing asserts that the music and cricket timers are cleared, though reading lines 690 and 1095 shows they are.
- tests/audio/lofi.test.ts, mood.test.ts, arrangement.test.ts: pure shape and level checks. Nothing checks mood output for NaN or undefined weather kinds (`clamp` passes NaN through).
- tests/audio/presets.test.ts: shows that `applyDevAudio` is inert with `dev=false`, but not that the production bundle excludes presets.ts and wav.ts. I checked the existing dist/assets and found no `__audioSample`, preset names or `OfflineAudioContext` there. That dist was not rebuilt at 7b4e60f.
- tests/game/steam.test.ts: no case for an invoke that throws synchronously (it would reach the game's emit, since `report` has no try). No world swap. The Rust `report_star` path is only unit-tested with the steam feature off.
- There is no test that a throwing sound or Steam listener cannot break `drainTap` or `notify`. Both run listeners without a try (src/game/game.ts:211-217). I found no concrete throwing input, so this is not listed as a suspicion.

## Coverage
- Read in full: src/audio/audio.ts, arrangement.ts, cues.ts, drums.ts, mood.ts, phrase.ts, presets.ts, score.ts, wav.ts; src/steam/steam.ts; src-tauri/src/achievements.rs, lib.rs, main.rs; src/game/events.ts, src/game/api.ts; .itworks/DECISIONS.md; docs/reviews/2026-09-24-audio-closeout.md; tests/audio/*.test.ts (5 files); tests/game/steam.test.ts. Read in part for reference: src/main.ts 1-140, src/game/game.ts (tap, swap, notify), src/sim/events.ts (incident end paths), src/sim/stars.ts, src/game/storage.ts isTauri, src/sim/save.ts star validation.
- Skipped: none in scope. I did not build the Tauri shell or run Steam, so the Rust side was checked by reading only (closing that needs `cargo test --features steam` on a machine with the SDK).
- Invariants that held: no AudioContext and no game listener before a gesture with Sound on (lines 606-620). The music and cricket timers, the bed, the tape, weather and tension nodes, and the subscriptions are all released on off. The score reads only `seed`, `stars`, `time.minute` and room `kind`, `occupancy` and `width`. It never reads `world.rng` and never writes the world. `Math.random` appears only in noise buffers and the cricket gate. Phrase and drum variation use their own hashes. `moodFor` and `easeMood` keep every axis in 0..1. The dev hook and presets are reachable only under `import.meta.env.DEV`. Steam is inert without a Tauri global, and a rejected invoke is swallowed.
- Probes run: `npx vitest run tests/audio tests/game/steam.test.ts`: 6 files, 98 tests, all pass. `npx vite-node@6.0.0 scratchpad/audit/laneG/probe.ts`: P1 to P4 and P3b reproduce S1 to S5 as quoted above. A grep of dist and dist-app for dev audio strings found nothing.
