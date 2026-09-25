# Verification of lane G at 7b4e60f

Host arm64 (`uname -m`). HEAD 7b4e60f. DECISIONS.md read in full. None of the five suspicions re-flags a settled decision. Line 72 (2026-09-24, "the star rating never lowers the soundtrack's quality") is about quality. It does not say whether the chapter drops back after a star is lost.

Probes:
- I re-ran the reviewer's `audit/laneG/probe.ts`. P1 to P4 and P3b print exactly what the report quotes.
- My own probe is `audit/verifyG/probe.ts`, run with `npx vite-node@6.0.0` from the repo root. It drives the real `createSound` from src/audio/audio.ts with a stub context in the style of tests/audio/audio.test.ts. Bus indices match the test file: gains[1] music, gains[7] hat, gains[8] drums. It adds a timer map that honors `clearInterval` and a `run(sec)` that fires the live 500 ms timers so the mood can ease.
- Baseline: `npx vitest run tests/audio/audio.test.ts` gives 35 of 35 passing.

## Verdicts

### S1. Tension stays on for good if the fire, bomb or theft ends while sound is off or after a tower swap - CONFIRMED (final: IMPORTANT)
- Reproduction, trigger 1 (sound off mid-incident). Sequence: fire.started, sound off, fire.resolved emitted, sound on, then 10 minutes of timers.
  ```
  calm baseline: tension=false tensionLevel=0 mood={energy:0.52, warmth:1, tension:0} hatBus=1.12 drumsBus=1 musicBus=0.6
  fire burning:  tension=true  tensionLevel=1 mood={energy:0.52, warmth:1, tension:1} hatBus=0 drumsBus=0 musicBus=0.301
  listeners while off = 0
  sound on, 10 min after the fire ended: tension=true tensionLevel=1 mood={...tension:1} hatBus=0 drumsBus=0 musicBus=0.301
  effects after the fire: oscillators from bell+rentDay+build = 0
  theft.started while stuck: tensionLevel = 1
  only a later fire.resolved clears it: tension=false ... hatBus=1.12 drumsBus=1 musicBus=0.6
  ```
  Bomb gives the same result (bomb.resolved while off leaves tension 1 and both drum buses at 0).
- Reproduction, trigger 2 (tower switch mid-incident). Sequence: fire.started, then `game.world` is replaced by seed 2 at 1 star, then 10 minutes of timers.
  ```
  new tower, 10 min later: tension=true tensionLevel=1 mood={...tension:1} hatBus=0 drumsBus=0 musicBus=0.301
  effects on the new tower: oscillators from bell+rentDay+build = 0
  ```
  Theft followed by a switch gives tensionLevel 0.5 and musicBus 0.425, and still 0 effects, because `tension` is true (audio.ts:753).
- Why no end event is ever emitted:
  - `swapWorld` (game.ts:385-388), `importSave` (907) and `newGame` (980) call `primeTap`.
  - `primeTap` sets `tap.storySeq = world.story.seq` for the new world (events.ts:62), so `drainTap` (events.ts:86-93) never emits the old tower's `fire.resolved`.
  - With sound off, `sleep` removes the only listener, and `subscribeEvents` primes the tap again on resubscribe (game.ts:1005).
  - `sleep` (audio.ts:684-711) resets weather but not `threat`, `tension` or `targetMood.tension`.
  - `inputs()` feeds `threatLevel(threat)` back into every bar (line 601), so the ease never reaches 0.
- Exits:
  - The state clears only on a later `fire.resolved` (or on `bomb.resolved` or `bomb.failed` after a bomb starts). A new `fire.started` returns early at line 774 and plays no cue.
  - A theft cannot clear a stuck fire.
  - Going back to the original tower clears it only if that incident is still live in the save and later resolves there.
  - Otherwise only a reload clears it.
  - The player cannot see the cause, so they have no workaround. That keeps the severity at IMPORTANT.
- Fix spec:
  - Reset `threat='none'`, `tension=false` and `targetMood.tension=0` in `sleep`, or on wake re-derive the threat from the live world's active incident.
  - Do the same when the world changes identity. `createSound` can compare `game.world` by reference, or on seed and tick, inside `onClock`/`targetForBar`, or the game can emit a world-swap event.
  - New tests in tests/audio/audio.test.ts must fail before the fix and pass after:
    - (a) fire.started, setEnabled(false), setEnabled(true): `tension` is false, `tensionLevel` is 0, and a car.arrive schedules 4 oscillators.
    - (b) fire.started, then `game.world` replaced: after the next bar, tension is 0 and gains[7] and gains[8] are above 0.
  - Must not change:
    - the existing "suppresses ordinary bells during an emergency" and "theft's late outcome cannot clear the fire" tests;
    - a fire that is still burning after sound off and on must duck again, so re-derive rather than blindly clear if the world exposes active incidents.

### S2. After an in-session tower switch, the new tower plays the old tower's chapter, tempo and key - CONFIRMED (final: IMPORTANT)
- Reproduction: the page starts on seed 1 at 5 stars. `game.world` is swapped to seed 2 at 1 star.
  ```
  after switch to seed 2 at 1 star: chapter=5 tempo=79 delay=0.38s held key=3
  new tower reaches 2 stars: chapter=5
  fresh page on seed 2 at 1 star: chapter=1 tempo=82 key=10 delay=0.366s
  fresh page, reaches 2 stars: chapter=2
  reverse: 1-star page switched to a 4-star tower: chapter=1
  ```
- Where it comes from:
  - `highest`, `tempo`, `beatSeconds`, `barSeconds` and `key` are fixed at construction (audio.ts:555-560).
  - The reverb delay time is also fixed at construction (line 644).
  - `phraseFor` and `drumHitsFor` read the live seed (995, 1018), so the result mixes the two towers.
  - `createUi` builds the controller once per page (ui.ts:147).
  - Boot opens the daily, friend or saved tower before `createUi` (main.ts:114-138), so a reload starts from the right tower. The in-session paths are Today's tower, My tower, New game and Open a saved file (panels.ts:1355-1396).
- Why IMPORTANT: the 2026-09-23 decisions tie the chapter to the tower's stars. A tower opened in session never climbs the ladder while the old high-water mark stays above it. This affects play in every mode switch, with no workaround short of a reload.
- Fix spec:
  - On a world swap, re-derive `highest`, `chapter`, `tempo`, `beatSeconds`, `barSeconds` and `key` from the new world, and reset the delay time.
  - Restart the music timer and `nextBar` so bars realign to the new tempo, and clear `previousChapter`.
  - New test must fail before and pass after: construct on {seed 1, stars 5}, replace the world with {seed 2, stars 1}, tick. Then `chapter` is 1 and `tempo` is `tempoFor(2)`. Then emit stars 1 to 2, and `chapter` is 2.
  - Must not change: the "keeps the highest chapter" test inside one tower (audio.test.ts:375-381).

### S3. Stars gained while sound is off are not heard when it comes back on - CONFIRMED (final: ADVISORY)
- Reproduction: `chapter after sound back on at 3 stars = 1`, and a reload gives 3.
  - `wake` never reads `game.world.stars`.
  - `subscribeEvents` primes `tap.stars` (events.ts:60 via game.ts:1005), so the rise is never emitted.
- Why ADVISORY: this is a music variant only, and the next star rise corrects it.
- Fix spec:
  - In `wake`, set `highest = max(highest, game.world.stars)` and recompute `chapter`.
  - Test: on, off, set stars to 3, on, and `chapter` is 3.
  - Must not change: the chapter still never drops on a star loss within the session.

### S4. Turning sound on and then quickly off leaves the AudioContext running - CONFIRMED (final: ADVISORY, lowered from IMPORTANT)
- Reproduction: the stub's `resume` is deferred, and the resume promise is still pending when off arrives.
  ```
  on: state = suspended pending resumes = 1
  off before resume settles: state = suspended live timers = 0 listeners = 0
  resume settles: state = running settings.on = false master gain = 0
  a later gesture with sound off: state = running
  next on/off cycle: state = suspended
  ```
- Trace:
  - `sleep` suspends only when `state === 'running'` (audio.ts:710), so it skips `suspend()` while the resume is still pending.
  - The resume then settles to running.
  - Gestures do not fix it: `onGesture` wakes only if `settings.on` (608).
- Verdict: the leak persists until the next on-then-off toggle (or `destroy`). It is not a one-shot. On the next toggle, `wake` sees 'running' and `sleep` then suspends.
- Why lowered:
  - Every bus is at 0. `sleep` clears the music and gate timers ("live timers = 0") and stops every source except the bed's already-stopped nodes, so nothing is audible and nothing is scheduled.
  - The cost is an idle running graph (the compressor, the limiter and the feedback delay), which means battery use and a held audio session on a phone.
  - The player cannot perceive it, and one toggle clears it.
  - Whether iOS keeps other apps' audio ducked while the context runs cannot be checked here. It is UNVERIFIABLE HERE. Settle it on an iPhone in Safari: toggle Sound on and off within about 100 ms while a Music app track plays, then check whether the track stays ducked.
- Fix spec:
  - In `sleep`, call `ctx.suspend()` whenever `ctx.state !== 'closed'`.
  - Or in `wake`, chain `.then(() => { if (!settings.on) void ctx.suspend(); })` onto the resume.
  - Test (with a deferred-resume stub like this probe): on, off, settle the resume, and `state` is 'suspended'.
  - Must not change: the existing toggle and bus tests.

### S5. The chapter after a star falls differs between this session and a reload of the same save - PARTIAL (final: ADVISORY if the owner wants reload parity; no finding otherwise)
- What holds: probe output `session chapter = 4 | reload of same save chapter = 3`.
  - `highest` is a session-only high-water mark, seeded from `world.stars` (audio.ts:555) and only raised (717).
  - Stars fall in the sim (stars.ts:56-58).
  - So the same save sounds like chapter 4 before a reload and chapter 3 after.
  - The in-session hold is intended and tested (audio.test.ts:380-381).
- What is not established: that the divergence is a defect.
  - No decision says whether the hold should survive a reload.
  - It is not a sim divergence either: audio never writes the world, so the CRITICAL "diverge between two loads" clause does not apply.
- Design call left to the owner. The two options:
  - persist the highest star (in the save or in local storage), or
  - have `highest` follow `world.stars`.

## Duplicates
- S1 and S2 belong to the tower-switch family. In every case, `swapWorld`, `newGame` or `importSave` primes the tap and replaces `world`, but a long-lived consumer keeps state from the old tower. The shared cases in other lanes are:
  - lane E, stale alerts: E1 S1 and E2 S1, where old alerts replay as new cards;
  - lane F, stale layer and weather: F1 S1, S3 and S4 (stale layers, signs and strips) and F3 S2 (the old tower's rain).
- One fix at the root would cover all of them: a world-swap signal (event or identity check) that each consumer resets on. S1's sound-off trigger is separate and still needs its own fix in `sleep` and `wake`.

## Notes
- New suspicion N1 (ADVISORY), from the S1 trace:
  - Where: audio.ts:700-701 and 613-674.
  - Input: fire.started, then sound off and on while the fire is genuinely still burning.
  - Wrong outcome: `sleep` stops `tensionOsc`, and `wake` never restarts it. The drone is gone for the rest of the fire, while the duck and the kit stop remain.
  - Reproduction: `audio/verifyG/n1.ts` prints `110 Hz drones after fire.started = 1`, then `110 Hz drones after off/on with fire still burning = 1 | tensionLevel = 1`. The count stays at 1, so no new drone is created after the sleep has stopped the first one.
  - Fix: fold it into S1's re-derive on wake.
- I spent no time on S1 against the real `createGame`. The swap path is proven by the `primeTap`/`drainTap` code quoted above, and the audio side is proven by the probe on the real `createSound`.
