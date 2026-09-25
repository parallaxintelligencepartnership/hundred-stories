# Lane F3: People, venues, curb, sky and weather rendering at 7b4e60f

## Weather trace (which field each layer reads)
The renderer builds one eased view per frame: `weatherView = easeView(view, weatherNow(seed, minute), dt)` (renderer.ts:2192). easeView reads only `snapshot.kind` and `snapshot.intensity` and ignores `from` and `blend`. It moves at 0.25 per real second (weather.ts:16, 43-48).
- Umbrellas: `umbrellasUp` returns `rainFalling(view) > 0` (curb.ts:68-70, 225).
- Rain sheet: `sheetStyle(view).alpha` is `0.85 * rainFalling(view)` (weather.ts:192-201, weatherfx.ts:407-411). The sheet is also hidden when the clip is empty (weatherfx.ts:450).
- Ripples: `rainFalling(view)`, and only while the street shows (weatherfx.ts:465-469).
- Wet street: `stepStreetWet` soaks while `rainFalling > 0`. It dries over 40 s of real time (weather.ts:93-97, weatherfx.ts:454).
- Sun: `SUN_ALPHA * weights.clear * (1 - night)` (weatherfx.ts:382).
- Lightning: `weights.storm >= 0.5`, off under reduced motion, driven by a real-time clock and the seed (weather.ts:299-312).
- Sky gray, cloud darkening, extra clouds and light tint all come from `view.weights` (weather.ts:115-155, sky.ts:338-396).

The umbrella, rain-sheet and ripple thresholds are the same function (RAIN_ON 0.5 on rain plus storm), so the 2026-09-24 report does not reproduce through the thresholds. The one edge is lightning at exactly storm 0.5 with no rain weight, which is a float knife edge and not reported. No in-scope file reads world.rng, Date, Math.random or performance.now. Sky and weather easing read only the snapshot and the frame dt. Cloud drift, lightning and the curb walk run on real time by design.

## Suspicions
### S1. The curb draws fire-held people walking into the lobby door while a fire burns (proposed: IMPORTANT)
- Where: src/render/curb.ts:51, 63, 97-102 (and createCurb update 227-231). The sim holds them in src/sim/people.ts:243-250.
- Input: any fire event while workers, residents, guests, shoppers, diners or visitors are held in state `outside`. runSchedules `continue`s them, which is correct.
- Wrong outcome: curbFigures picks `outside` sims and gives them `heading: 'in'`. It never looks at `world.events`. curbOffset then walks each one down to 0 px from the door, where they vanish, and the loop brings them back to walk in again. This happens while the fire engine is parked at the curb (emergencyVehicle, curb.ts:83-90). It breaks the lane invariant and the ruling in DECISIONS 2026-09-24 ("no arrivals enter the tower while a fire is burning"). The sim is right; the picture shows the opposite. Expected: during a fire, held people stand or mill at the curb, or walk away from the door.
- Reproduce: scratchpad/f3/probe.ts section 1 (`npx vite-node@6.0.0 <scratchpad>/f3/probe.ts`). With 40 `outside` workers and a fire event, the result is `vehicle fire`, 12 figures, all 12 heading in, and all 12 reach offset 0 at the door within 60 s. curb.test.ts has no fire-heading case.

### S2. Swapping towers carries the old tower's rain, umbrellas and wet street into the new one (proposed: ADVISORY)
- Where: src/render/renderer.ts:925 (`weatherView` is settled only at creation) and 2303-2313 (`resetMotion` does not resettle it). Also src/render/weatherfx.ts:255, 454 (`wet` is never reset) and src/render/curb.ts:220-222 (the sample of old ids is kept for up to 1 s).
- Input: a rainy tower, then Open a saved file, New game, Today's tower or a friend's link, into a tower whose snapshot is clear. All of these go through game.ts swapWorld, importSave or newGame, then resetMotion.
- Wrong outcome: rain and open umbrellas stay for about 2 s and the wet street for about 42 s under a clear sky, which is not what the new tower's snapshot says. Loading the same tower fresh shows a dry street. For up to 1 s the curb also resolves the old sample's ids against the new world (`f.world.sims.get(fig.simId)`), which can put an unrelated sim on the street.
- Reproduce: probe section 3 prints `swap to clear tower: rain+umbrellas 2000 ms; wet street 41967 ms; fresh load shows wet 0`. As a code trace: resetMotion (renderer.ts:2303) touches carMotion, simMotion, simSteps, lookCodes and buildFx only.

### S3. On 2x and 4x nights the HUD says Rain while no rain, umbrella or wet street is drawn (proposed: ADVISORY)
- Where: src/ui/status.ts:388 reads the raw snapshot kind. The renderer eases at 0.25 per real second (src/render/weather.ts:16, 43-48, 70-76). Speed comes from src/game/game.ts:289 (night x8).
- Input: a seed with a rain block from 00:00 to 06:00 (seed 2, day 1), played at 4x. That is 320 game minutes a second, so the 360-minute block lasts about 1.1 s of real time.
- Wrong outcome: the rain weight never passes 0.5, so no rain, umbrellas, ripples or wet street appear, while the status bar shows Rain for the whole block. At 2x, rain is drawn for 0.48 s of a 2.25 s Rain label.
- Reproduce: probe section 2 prints `night 320 min/s: HUD says Rain 1133 ms, rain/umbrellas drawn 0 ms` and `160 min/s: 2250 ms vs 483 ms`. The "unaffected by game speed" test in weather.test.ts uses 84 minutes a second, which stays inside one block.

### S4. A leaving person is drawn twice: inside the tower and already out on the street (proposed: ADVISORY)
- Where: src/render/curb.ts:51, 63 (a `leaving` sim becomes a street figure heading out) and src/render/renderer.ts:677 (simIsVisible is true for `leaving`). In people.ts:407 and 524, `leaving` sims still walk the floors toward the exit.
- Input: a `leaving` sim with an id divisible by 4 (or a guard, collector, VIP or thief), still on an upper floor, whose hash puts it in the 12-person curb sample.
- Wrong outcome: the same person walks toward the elevator on, say, floor 10 and at the same time walks away from the lobby door outside. During a fire, the evacuees from the burning floor (leaveTower) also appear outside before they reach the lobby.
- Reproduce: code trace. curbFigures keeps `leaving` with no check on `pos.floor` or position. The tower sprite pass keeps it through simIsVisible and inCrowd.

## Questions for the owner
- Offices are drawn closed (blinds down) all weekend (venue.ts:118, as VISUAL.md sets out), but about 10% of workers have weekend schedules (people.ts:917). Should an office with people inside show open?
- The street dries over 40 s of real time. A fresh load taken just after rain shows a dry street where a continuous session shows a wet one. Is that acceptable?
- With any basement under the ground floor's span, the band and its mirrored lobby panes are removed there (wetStreetRects, weatherfx.ts:317-329), so "reflection out front" is absent on most real towers. Is that intended, given the rule against drawing weather on room cells?
- The room panel's line says "a bookshop" (venue.ts:32, 126). US English more often says "bookstore"; VISUAL.md uses bookshop.

## What the tests do not prove
- curb.test.ts: nothing checks figure heading during a fire, that a figure is not drawn both inside and outside, or behavior after a world is replaced. The umbrella test feeds a hand-built view, not the renderer's eased one.
- weather.test.ts: nothing checks the renderer resettling on a world swap, or game speeds where a block is shorter than the 4 s ease. No lightning-versus-rain boundary test at storm weight 0.5.
- rain.test.ts: agreement is checked on `alpha`, not on sheet visibility when the clip is empty (weatherfx.ts:450).
- sky.test.ts: createSky's weather grading, extra clouds and cloud tint are untested; only the pure helpers are covered.
- venue.test.ts: nothing covers venueOpen against weekend workers.
- crowd.test.ts and portrait.test.ts: adequate for their claims. They do not cover the curb's own sample or its overlap with the tower sample.

## Coverage
- Read in full: src/render/figure.ts, person.ts, venue.ts, curb.ts, sky.ts, weather.ts, weatherfx.ts; src/game/weather.ts; tests/render/weather, rain, sky, curb, venue, crowd and portrait test files; .itworks/DECISIONS.md; docs/VISUAL.md; docs/DESIGN.md section 9. Supporting excerpts: renderer.ts (weather and curb wiring, resetMotion, simIsVisible), game.ts (swap, speed), people.ts (fire hold), status.ts:388.
- Skipped: src/sim/types.ts was read only in the parts used (Sim state, Room); the lane uses it as reference only.
- Probes run: `npx vitest run` on the 7 lane test files gave 61 of 61 passing. `npx vite-node@6.0.0 scratchpad/f3/probe.ts` gave the S1, S2 and S3 numbers above. `uname -m` returned arm64.
