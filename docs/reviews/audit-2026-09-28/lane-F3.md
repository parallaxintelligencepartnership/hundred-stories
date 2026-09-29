# Lane F3: People, venues, curb, sky and weather rendering at 0f05723

Host: arm64 (uname -m). Checkout: scratchpad/audit-0f05723 at 0f05723.

## Last audit's F3 findings, re-checked against the moved code
- S1 (curb sends people into the door during a fire): fixed. curbFigures gives `outside` sims `heading: 'wait'` under `options.fire` (curb.ts:97). createCurb works out `fire` from `emergencyVehicle(world) === 'fire'` (curb.ts:262), which is the same test as the sim's `fireBurning` (people.ts:81-82: any `fire` event). It resamples as soon as a fire starts or ends (curb.ts:263). A waiting person stands at least `CURB_WAIT_PX` (fire engine width + 24 = 112 px) from the door (curb.ts:133). The VIP car reaches at most 76 px out on the left, so nobody stands inside a vehicle. curb.test.ts covers this over 40 s. Invariant holds.
- S2 (a tower switch carries the old weather over): fixed. `worldReplaced` settles `weatherView`, publishes it, and calls `weatherFx.reset()` (wet = -1, ripples cleared) and `curb.reset()` (renderer.ts:2784-2824).
- S3 (the HUD says Rain over a dry street at 2x and 4x): fixed. `publishWeatherView` and `shownWeatherKind` now name the eased view, so the label uses the same test as the rain, umbrellas and ripples (weather.ts:337-357, status.ts:454).
- S4 (a person drawn inside and outside at once): fixed. A `leaving` sim is on the street only on floor 1, between the doors, and only when `inTower` (the renderer's `drawn`) is false (curb.ts:79-85).

## Invariants attacked
- Umbrellas only in rain; rain sheet, ripples and HUD agree. All of them read `rainFalling` (weather.ts:70). When the clip is empty (weatherfx.ts:456) the sheet hides while umbrellas stay up. That can only happen when no open air above the street is in view. Curb figures are in the `ground` layer behind the tower, so none shows in that case. Refuted.
- Wet street only after rain. `settledStreetWet` gives 1 only while `rainFalling > 0`. Otherwise the street soaks only in rain and dries over 40 s. Overcast never wets it (rain.test.ts). Holds.
- Lightning only in a storm. The flash needs `storm >= 0.5` and rain needs `rain + storm > 0.5`. They disagree only when storm is exactly 0.5. I eased storm from 0 up to 1 and from 1 down to 0 at 11 common frame intervals (60/120/144/30/90/75 Hz and 16, 20, 25, 50, 100 ms). No step landed on exactly 0.5. Refuted.
- No Date, Math.random, performance.now or world.rng in the seven files (grep: none; the only hits are comments). Sky, stars, downtown and extra clouds use their own `createRng` seeds or the tower seed. Easing uses snapshot plus dt only. The curb's `performance.now()` comes from renderer.ts:2715, and real-time curb motion is by design. Holds.
- Throw paths: `headTopOf` and `decodeLook` always get integer codes (the `mix` bitwise ops turn NaN into 0). venueOf name indexing stays in range. No throw found.

## Suspicions
### S1. A person sprite stays mirrored for good after its first mirrored frame, so the D-16 walk, the weight shift and hand-held props go wrong for every walker (proposed: ADVISORY)
- Where: src/render/person.ts:31-32. `setSize` goes through pixi 8.21 `_setWidth`, which keeps the sign of `scale.x` (node_modules/pixi.js/lib/scene/container/container-mixins/measureMixin.mjs:12-19). The code only ever sets the sign negative (`if (isMirrored(frame)) scale.x = -|scale.x|`) and never puts it back to positive. Both callers hit this: the tower's sprites (renderer.ts:2226) and the curb's walkers (curb.ts:292).
- Input: any sprite-drawn walker for more than one 480 ms walk cycle (frames 0,1,0,2). The same happens to any waiter after its first `shiftRight`.
- Wrong outcome:
  - From the first mirrored stride on, frame 1 (stride) is drawn flipped, so the walk shows the same stride twice per cycle. D-16 (stand, stride, stand, mirrored stride) is lost.
  - `shiftLeft` is drawn as `shiftRight`, so a waiting person stops moving their weight from foot to foot.
  - Glance and browse are drawn mirrored.
  - `propPlacement` still places the prop for the frame asked for, not the flipped body. On every stride frame the briefcase sits about 2.1 px left of and 3.2 px above the flipped hand: frame 1 is placed at (5.6, 27.45), but the hand is where frame 2 puts it, at (7.7, 30.65), for look code 0. Codes 13 and 30 are off by the same amount. On the glance frame the prop covers the hand showing the watch, which is the impatience cue.
- Reproduce: probe scratchpad/audit-2026-09-28/f3/mirror.test.ts (`npx vitest run --root <that dir> mirror.test.ts` from the checkout).
  - Sequence stand, stride, stand, strideMirrored, stand, stride, shiftLeft, shiftRight, shiftLeft through `placePerson` gives signs `0:1 1:1 0:1 2:-1 0:-1 1:-1 3:-1 4:-1 3:-1`.
  - 50 commuters on the real `createCurb` for 5 s: 373 stride frames drawn, 362 of them flipped.
  - Prop offsets: scratchpad/audit-2026-09-28/f3/prop.out.
  - Fix sketch: set `scale.x = (isMirrored(frame) ? -1 : 1) * Math.abs(scale.x)` after `setSize`. Test: a non-mirrored frame after a mirrored one leaves `scale.x > 0`.

## Questions for the owner
- The earlier F3 questions have no ruling in DECISIONS.md, and the code has not changed on any of them:
  - Offices close all weekend (venue.ts:118) even though some workers have weekend schedules.
  - A fresh load just after rain shows a dry street.
  - The player-facing label "bookshop" (venue.ts:31) where US English more usually says "bookstore".
- In particle mode (crowd atlas), stride and mirrored stride share one unflipped cell (art.ts:2224). I take that as a deliberate simplification in F2 or F1 scope and have not reported it.

## What the tests do not prove
- anim.test.ts and curb.test.ts: the D-16 cycle is tested only as frame numbers (`walkFrameAt`, `curbWalkFrame`). Nothing checks the sprite's `scale.x` sign or the prop position against the drawn hand, which is why S1 passes.
- curb.test.ts: the fire test builds `curbFigures` directly with `fire` and drives `createCurb` with no umbrella or vehicle overlap check. Nothing covers a bomb. Nothing covers a `leaving` evacuee walking out while the others wait.
- weather.test.ts and rain.test.ts: the rain clip is proven as rectangles only. Whether the pixi Graphics mask clips on a GPU is not tested. Nothing tests `shownWeatherKind` together with `worldReplaced`, or lightning against rain at the float boundary (refuted above by arithmetic only).
- sky.test.ts: extra clouds and cloud darkening in `createSky` are not asserted (`extraCloudPlaces` and `cloudDarkening` have no test here).
- venue.test.ts: `venueOpen` is not tested against the sim's weekend workers or the restaurant gap between lunch and dinner.
- crowd.test.ts and portrait.test.ts: adequate for their claims. Neither tests the curb sample's overlap with the tower sample; curb.test.ts S4 covers that at the function level only.

## Coverage
- Read in full: src/render/figure.ts, person.ts, venue.ts, curb.ts, sky.ts, weather.ts, weatherfx.ts; tests/render/weather, rain, sky, curb, venue, crowd and portrait test files; DECISIONS.md with the MAP gotchas; LANES.md (F3 and the lane-independent rules); docs/reviews/audit-2026-09-25/lane-F3.md and verify-F.md.
- Supporting excerpts, not in scope: renderer.ts (drawn 929, floor strips 1380-1420, sim sprite pass 2170-2240, onFrame weather and curb 2640-2725, worldReplaced 2775-2870); anim.ts 40-110; art.ts sweep 2242-2266 and crowd atlas 2175-2235; people.ts fireBurning; game/weather.ts weatherAt; pixi measureMixin.
- Skipped: none in scope.
- Only a real browser can settle whether the rain's Graphics mask clips at the tower edge on a GPU and how visible S1 is at zoom 1. Closing step: run `npm run dev` in a scratch copy, open /play/?weather=storm&hour=13 in Chrome with `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`, and watch a walker with a briefcase at zoom 2.
- Probes run:
  - `npx vitest run` on the 7 lane test files: 76 of 76 pass.
  - f3/mirror.test.ts: shows S1 (signs stay negative; 362 of 373 stride frames flipped).
  - f3/prop.test.ts: prop offsets per frame.
  - A node check of the storm ease landing on 0.5: never, at 11 frame intervals.
