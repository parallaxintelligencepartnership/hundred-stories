# Verification of lanes F1, F2, F3 at 0f05723

Host arm64 (uname -m). Checkout scratchpad/audit-0f05723, clean after the run (git status empty). DECISIONS.md read in full (134 lines). Nothing in it settles any item below. Line 44 ("a tap can only select a drawn sim") is consistent with the F1 S1 fix. The reviewer probes I re-ran: f1-0928/f1.test.ts (P1 to P4), f2/degrade.test.ts, f2/probe.ts (4,772 textures, 0 problems), f3/mirror.test.ts. All of them print what the lane reports quote. My own probes are in audit-2026-09-28/verifyF/: vf.test.ts (the fix-proof tests, run in a throwaway overlay that has since been deleted), vf-car.ts and vf-open.ts.

# Lane F1

## Verdicts
### S1. A tap on a person picks the higher id anywhere in 1.5 tiles - CONFIRMED (final: IMPORTANT)
- Reproduction: f1.test.ts P1 goes through the real pointer handlers. Workers 4 and 8 are drawn at tiles 101 and 102. Taps at 100.6, 101.0 and 101.4 all return `{"simId":8}`. Pure rule: `pickSimAt([4@120, 8@121], 3, 120.0, drawn)` returns 8. Code: renderer.ts:783-784 keeps any sim within PICK_RADIUS_TILES = 1.5, and `sim.id > best.id` wins whatever the distance. A sprite is one tile wide (inRoomSlot comment, :812-814), so the two sprites do not overlap. Every point of sim 4's sprite is within 1.5 tiles of sim 8, so no tap can ever pick sim 4. Overlay check: tests/vf/vf.test.ts "tap on sim 4 picks 4" fails on 0f05723 with `expected 8 to be 4`.
- Severity: kept IMPORTANT. Tapping one visible person selects another. For walkers and queues there is no workaround while they stand within 1.5 tiles of a higher id. The room panel's occupant list is a workaround only for people inside a room.
- Fix spec: in pickSimAt, a sim whose drawn centre is within half a tile of the tap (the tap is on its sprite) beats any sim it is not on. Among sims the tap is on, the highest id still wins (crowd.test.ts "takes the newest drawn sim when two overlap" must stay green). With no sprite under the tap, the nearest within the radius wins. Test: two drawn sims one tile apart, a tap at the centre of the lower id picks the lower id. It fails before and passes after. My overlay version of this rule passed vf.test.ts plus crowd, anim and curb (47 tests). The sample, drawnAt and car exclusions must not change.

### S2. A chrome re-measure snaps the camera back after a minimap or gamepad move - CONFIRMED (final: ADVISORY)
- Reproduction: P4 prints opening x 1608 / y -96 / z 0.5, then x 4608 / y -896 after panBy, then x 1608 / y 204 / z 0.5 after setChrome(60,300). Trace: `userMoved` is set only at renderer.ts:2480, 2574, 2595, 2600 and 2608 (canvas pointer, wheel, keys). minimap.ts:287 and the gamepad (ui.ts:1661, 1666) call camera.panBy/zoomAt directly. setChrome (:2949) calls frameInitial when `!userMoved`. The re-measure paths are reachable: ui.ts:414 (build sheet changed), ui.ts:1781 (palette collapse), and watchChrome's callback into game.setChrome (ui.ts:726).
- Severity: ADVISORY. The view jumps, but one canvas pan makes it stick.
- Fix spec: a camera move from any source marks the view as taken. Either the camera gets an onUserMove hook, or the renderer exposes `markUserMoved()` and minimap moveTo and the pad pan and zoom call it. Test: a reconcile-harness case that does panBy and then setChrome, marks the move and expects x unchanged. Home (:2589) and the boot grace framing must not change.

### S3. Burning shop neon, restaurant steam and cinema marquee run while closed or on fire - CONFIRMED (final: ADVISORY)
- Reproduction: P2 prints `shop onFire = true | lit sign face visible = [ false ] | neon strip visible = [ true ] tint f0c419`. ambient.ts (read in full) never reads `room.onFire`. The strip is gated on `night && shopOpen` only (:196). The marquee (:199-200) and the steam (:201-208) have no gate at all. vf-open.ts: `venueOpen` gives restaurant 03:00 false and cinema 03:00 false, so both animate while closed. Compare renderer.ts:1754 and :1782-1783, where the renderer turns the lit sign off while a room burns.
- Fix spec: sync or update receives each room's onFire and its kind's open state, and each emitter's node.visible = !onFire && open (sign: && night). Test: a harness case with a burning shop at 20:00 expects the strip hidden, and a restaurant at 03:00 expects the puffs hidden. The phase, the timing and reduced motion (no emitters at all) must not change.

### S4. After the flat-rectangle fallback, stairs and escalators draw nothing - CONFIRMED (final: ADVISORY). Same defect as F2 S1, one verdict below.

### S5. The car's floor sign shows 1 until 75% of the way down to B1 - PARTIAL (final: ADVISORY)
- Holds: carFloorLabel(0) is "1" (led.ts:46-47: round(0)=0, max(1,0)), and the sim's car does sit at y = 0. vf-car.ts on a -1..3 shaft prints `down 2:2 1:1 0:1 -1:B1` and `up 0:1 1:1 2:2 3:3`.
- Does not hold: y is never fractional. stepToward (elevators.ts:430-434) moves whole floors per tick from integer floors, so the "until y = -0.5, 75% of the way" arithmetic never happens. The real behavior: the label names the tick's car.y, which the drawn car (interpolated from the last tick) trails by a tick. Above the ground the label shows the destination for the whole move. Going down to B1 it shows "1" for the first half (the tick at the nonexistent y = 0) and "B1" for the second half. Going up it shows "1" from the moment the car leaves B1.
- Fix spec: carFloorLabel treats y in (-1, 1) as a crossing, labelled by direction (the destination: "B1" going down, "1" going up), or the renderer labels from the next integer floor in car.dir. Test: car-indicator.test.ts at y = 0 with dir -1 expects "B1". Labels at integer floors must not change.

# Lane F2

## Verdicts
### S1 (with F1 S4). After any art failure, stairs and escalators become Texture.EMPTY - CONFIRMED (final: ADVISORY, lowered from IMPORTANT)
- Reproduction: degrade.test.ts. extras: `before interior|stairs|8|2|0 true`, then `after Texture.EMPTY` (warn "art.interior failed, the illustrated extras are off"). primary: `after Texture.EMPTY` (warn "art.room failed ..."). P3: the connector sprite is `{ empty: true, w: 128, h: 112 }`, and it is still pickable. Trace: guardArt always installs `guarded.interior` (renderer.ts:675), which returns Texture.EMPTY once `broken || extrasBroken` (:651-664). roomTexture (:1636) sends overlay kinds to `art.interior` whenever it exists, so fallbackArt's connector diagonal (:550-561) is never reached. thumbnail.ts:74 has the same pattern.
- Severity: lowered to ADVISORY. It breaks the "degrades to flat rectangles, never blank" invariant, but no reachable trigger exists. The re-run f2/probe.ts baked 4,772 textures with 0 problems. A missing 2D context returns EMPTY without throwing (art.ts:1983-1991), so it never sets `broken`. A WebGL-less boot uses fallbackArt directly, which has no `interior`, so its connectors draw.
- Fix spec: guardArt exposes whether the extras are live (for example `extrasOn()`), and roomTexture and thumbnailPlan use `art.room` for overlay kinds when they are not. Test: the degrade harness case expects the stairs sprite's texture to be the backup's `room|stairs|...` and not EMPTY after a throw in interior and after a throw in room. Normal art (interior present, no throw) must still draw the flight from `art.interior`.

### S2. After a canvas comes back, fixtures, signs, decor and light pools are never re-requested - CONFIRMED (final: ADVISORY)
- Reproduction: degrade.test.ts prints `asks before 41 asks after 41 shop interior sprites 0 sign sprites 0 EMPTY sprites 50`. Trace: art.ts paint returns EMPTY uncached (:1983-1991). syncVenue (renderer.ts:1650-1653) rebuilds only on a width, floors or variant change, and the layers are made only on `!entry` (:1654). The only other rebuild is worldReplaced. Whether iOS actually returns a null context is UNVERIFIABLE HERE: Safari Web Inspector on an iPhone at /play/, watching for "no 2D canvas context".
- Fix spec: a venue entry records whether any texture it asked for was Texture.EMPTY, and syncVenue drops and rebuilds such an entry on a later pass (throttled, for example on the venue clock), and the same for lobby tiles. Test: the scratch case above expects shop interior and sign sprites > 0 after `contextBack`. An entry with real textures must never be rebuilt.

### S3. A stairs and an escalator shell baked at boot and never shown - CONFIRMED (final: ADVISORY)
- Reproduction (trace): bakeRoomStates (renderer.ts:327-341) calls `art.room` for every room shape with no kind filter. The real art defines `interior` (art.ts:2090), so roomTexture (:1636) never asks `art.room` for an overlay kind. drawShell returns at once for overlay kinds (art.ts:535), so the bake is a blank target. At DPR 2 an 8×2 flight is 256×288×4 bytes, about 295 KB per kind.
- Fix spec: bakeRoomStates skips kinds with `INTERIORS[kind].overlay` when `art.interior` exists. That keeps it correct under the S1 fix, since the fallback bakes lazily. Test: bakeRoomStates with a stub art that counts calls, on a world with only stairs, expects 0 room calls. Every other kind's four states must still be baked.

# Lane F3

## Verdicts
### S1. A mirrored person sprite never flips back - CONFIRMED (final: ADVISORY)
- Reproduction: mirror.test.ts prints `PLACEPERSON 0:1 1:1 0:1 2:-1 0:-1 1:-1 3:-1 4:-1 3:-1` and `CURB stride frames drawn 373 of which flipped 362`. Trace: person.ts:31 `setSize` goes through pixi measureMixin `_setWidth`, which keeps `Math.sign(scale.x)` (measureMixin.mjs:12-19). person.ts:32 only ever sets the sign negative. Callers: renderer.ts:2226 and curb.ts:292. anim.ts:67-74 confirms that frames 2 and 4 rely on the sprite being flipped. The prop offsets in f3/prop.out match the report: frame 1 at (5.6, 27.45) against frame 2 at (7.7, 30.65) for look 0. Overlay check: vf.test.ts "a plain frame after a mirrored one is unflipped" fails on 0f05723 (`[1,1,1,-1,-1,-1,-1,-1,-1]`) and passes with `p.body.scale.x = (isMirrored(frame) ? -1 : 1) * Math.abs(p.body.scale.x)`. With that change anim, crowd and curb stay green.
- Severity: ADVISORY. The figures are symmetric and the prop is off by about 2 to 3 px on a 16×48 sprite. It is cosmetic, but it applies to every walker.
- Fix spec: as above. Add the vf.test.ts sign test to tests/render (person placement). propPlacement, canonicalFrame and texture sharing must not change.

## Duplicates
- F1 S4 and F2 S1 are one defect (roomTexture plus guardArt's always-present interior). One verdict: CONFIRMED ADVISORY, under F2 S1.

## Notes
- Checked and dropped: whether a pad or minimap move is also thrown away by the boot grace framing (renderer.ts:2657). It is not reachable. That call runs only on a viewport size change while `!framedOnce`, and framedOnce is set on the first frameInitial with a real screen size (:1199).
- No GPU was needed to settle any verdict. The only item left open that would need one is the S2 null-context premise on iOS, named above.
