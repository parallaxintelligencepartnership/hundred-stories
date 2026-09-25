# Verification of the six side suspicions at 7b4e60f

Host: arm64 (uname -m). HEAD 7b4e60f. I read .itworks/DECISIONS.md in full; none of the six re-flags a settled decision. I did not touch the repo. My probes are in audit/verifyNew/ (n1.ts, n2.ts, n3.ts, n6.ts run with `npx vite-node <file>` from the repo; n4.test.ts and n5.test.ts run with `node_modules/.bin/vitest run --root <scratchpad>/audit/verifyNew <file>`, and they write their output to n4.out and n5.out because vitest hides console output here). I re-ran or re-derived each reviewer probe (verifyD/n1.ts, verifyB/s4h.ts via common.ts, verifyF render N2, verifyG/n1.ts).

Files read in full: src/main.ts, src/game/storage.ts, src/game/game.ts, src/sim/stars.ts, src/sim/people.ts, src/sim/events.ts, src/sim/tick.ts, src/audio/audio.ts, deploy/deploy.sh. Read in part, with the reason: src/render/renderer.ts (640-770, 1495-1580, 1825-1890: the visibility rules, shaft reconcile and overlay; the other 2,000 lines draw nothing these items touch), src/render/art.ts (1925-1965, the shaft bake), src/ui/panels.ts (390-420, 495-510, the occupant list), src/ui/ui.ts (270-290, 640-665, the My tower button), src/sim/build.ts (430-480, demolish), src/sim/rules.ts (grep of the fire, housekeeping and STARS lines).

## Verdicts

### S1. (verify-D N1) openMyTower silently overwrites an unreadable My tower save - CONFIRMED (final: CRITICAL)
- Path: ui.ts:280/661 (the "My tower" pill, shown outside My tower) -> game.ts:965 `openMyTower` -> 966 `enterSlot('mine')` -> 967 `readWorld('mine')`: 420 `readFrom` returns the corrupt text, 422 `deserialize` refuses it, 423 returns null with no stash and no log -> 969-971 `freshTower(time.freshSeed())` then `saveWorld(true)` -> 363 `writeTo('mine', ...)` -> storage.ts:458 `writeSave` -> 79 `setItem('hundred-stories:autosave', ...)`, overwriting the original bytes. Compare boot `load()` at game.ts:884-892, which calls `stashUnreadable` and warns.
- Reproduction (n1.ts; the slot holds the first half of a real save, 458 bytes of damaged JSON):
  - `[truncated] after openMyTower: slot=mine autosave bytes=603 seed=77 sameAsCorrupt=false stash=false warns=[]` (entered from a friend link)
  - `[daily] after openMyTower: slot=mine autosave bytes=603 seed=77 sameAsCorrupt=false stash=false warns=[]` (entered from ?daily)
  - Control: `[boot load()] ok= false stash= true warn= 1`
  - I also re-ran verifyD/n1.ts (a newer version number) and got the same result.
- Severity: the rubric puts "changes the save file / loses a player's tower" at CRITICAL. A save from a newer build is the realistic trigger: after a rollback, or a stale service-worker build on a second device. That save is recoverable until this write, which destroys it with no copy and no message. The trigger needs a boot through ?seed or ?daily, which is a normal path.
- Fix spec: in `readWorld` (or in `openMyTower`, `openFriend` and `openDaily`), when the text exists but `deserialize` refuses it, call `stashUnreadable(text)`, log the same warning as load(), and write no fresh tower over that slot until the player chooses to. Test (game.test.ts style, with a fake localStorage and real storage): put a truncated save in `hundred-stories:autosave`, call `openFriend(1)` then `openMyTower()`. Expect the stash to equal the original text and a warn line to be logged. This fails today. Must not change: a good save still resumes, and an empty slot still starts a fresh tower.

### S2. (verify-B N1) A housekeeper cleaning an empty hotel room counts toward population - CONFIRMED (final: CRITICAL, raised from IMPORTANT)
- Cause: people.ts:509 `setOccupancy(room.occupancy + 1)` runs for staff too. stars.ts:18-22 counts a hotel room at full capacity when `occupancy > 0`. recomputeStars runs at every :00 (tick.ts:19). Cleaning runs from 10:00 to 20:00, 20 minutes a room (rules.ts:163), so every clean that spans an hour mark is counted.
- Reproduction (n2.ts: 20 hotel singles, one housekeeping office, one standard shaft, seed 11):
  - `[d1 12:00] BEFORE recompute tick: keeper 126 in hotel room 112 occ=1 tenants=0 dirty=true ...; world.population=0 populationOf=4 guestCount=0`
  - `[d1 12:00] DURING (after hourly recompute): world.population=5 populationOf=5 guestCount=0`
  - `[d1 14:01] AFTER (next recompute, keeper gone): world.population=0 populationOf=0 guestCount=0`
- Severity: `world.population` is stored and serialized (save.ts:149). The same value gates the star ladder (stars.ts:56-66), so a tower a few people short of 300 or 1,000 can gain a star for an hour and then log "Fell to" at the next hour mark. The rubric names stored population and stars as CRITICAL. The outcome is deterministic, so this is not a load divergence.
- Fix spec: count a hotel room from its guests (tenants of kind guest, or occupancy that excludes staff), not from raw occupancy. BRIEF-AGENTS.md:70 says "occupied hotel rooms by capacity". Whether "occupied" means booked or physically present is the owner's call, but staff must not count either way. Test: a keeper in a dirty room with 0 tenants gives `populationOf === 0`. This fails today. Must not change: office and condo counts, and a guest-occupied room still counts at capacity.

### S3. (verify-C N1) Demolish plus a security office clears a fire for $0 damage - CONFIRMED (final: ADVISORY; same defect as C S3 / A S1)
- Cause: demolish is free and allowed on a burning room with occupancy 0 (build.ts:447-452). endFire (events.ts:204-210) charges only for rooms that still exist.
- Reproduction (n3.ts: an office on floor 2 set on fire in the same shape startFire pushes, then security on floor 2 at x 150):
  - A, demolish then security: `0 rooms burned down and clearing the damage cost $0`, cash change after the build `0`.
  - B, control with no demolish: `1 room burned down and clearing the damage cost $20,000`.
- The saving is $20,000 per room (rules.ts:184). Demolishing also stops the spread, and the room is lost either way. It is a player-chosen exploit, and it does not diverge.
- Fix spec: the C S3 fix (refuse demolish on a burning room, "The room is on fire.") closes it. Test: in the same setup, demolish returns ok:false. Must not change: demolish of rooms that are not burning.

### S4. (verify-F N1) A built (not dragged) express spanning many floors bakes a texture over 8,192 px - CONFIRMED as stated; phone impact UNVERIFIABLE HERE (final: ADVISORY, rides on F2 S1)
- Path: renderer.ts:1553-1556 bakes `art.shaft(kind, shaftFloorSpan(shaft))`. art.ts:1946-1949 bakes the whole span as one texture.
- Reproduction (n4.test.ts: real createArt at resolution 2, real applyCommand, no drag or ghost involved):
  - `build express 1..100: {"ok":true} span 100 floors -> texture 192 x 14400 device px; over 8192: true`
  - `-10..100 -> 192 x 15840`, `1..56 -> 192 x 8064 (false)`, `1..57 -> 192 x 8208 (true)`
- UNVERIFIABLE HERE: what a phone does with a texture past MAX_TEXTURE_SIZE. Use the F2 S1 phone step (query `MAX_TEXTURE_SIZE`, then build an express from 1 to 60 or more and look for a blank shaft or a lost context). 15,840 px is under the usual 16,384 desktop limit.
- Fix spec: the F2 S1 fix must cover `shaft:` as well: a tiled per-floor body, or split the bake at 8192/resolution logical px. Test: art.shaft('express', 110) at resolution 2 bakes no frame over 4,096 logical px. Must not change: the look at 1 to 30 floors.

### S5. (verify-F N2) A selection ring drawn around a person who is not drawn - CONFIRMED (final: ADVISORY)
- Path: panels.ts:405 occupant row -> `ctx.select({simId})` -> renderer.setSelection. occupantIds (panels.ts:495-510) does not filter by the crowd sample. drawOverlay (renderer.ts:1866-1875) checks neither `inCrowd` nor `simIsVisible`.
- Reproduction (n5.test.ts, the verifyF stub harness, the office at x 100, the person in the room):
  - `sim 401: inCrowd=false pickSimAt(tap on it)=null | ring visible=true ring x=1648 | people sprites drawn=0`
  - control `sim 400: inCrowd=true ... ring visible=true ring x=1648 | people sprites drawn=1 at x 1616` (the 32 px offset is F1 S2)
- The 2026-09-20 decision ("a tap can only select a drawn sim") covers taps. The panel list is a separate door, and the ring on empty floor is the defect.
- Fix spec: in drawOverlay, draw the sim ring only when `drawn(sim)` (simIsVisible and the sample). Otherwise ring the sim's room, or nothing. Test: this harness expects `ring.visible === false` (or the room box) for sim 401. Must not change: the ring on sampled, visible sims.

### S6. (verify-G N1) Sound off then on during a still-burning fire drops the tension drone - CONFIRMED (final: ADVISORY)
- Cause: sleep (audio.ts:700-701) stops `tensionOsc` and nulls it but leaves `threat='fire'`. wake (613-674) never recreates the drone. A repeated fire.started returns early at 774 (`threat === next`).
- Reproduction (n6.ts, the verifyG fake context with start and stop recorded):
  - `control, fire burning, sound on: live 110 Hz drones = 1 | tensionLevel = 1`
  - `sound off: live drones = 0`
  - `sound on again, fire still burning, 30 s later: live drones = 0 | tension = true | tensionLevel = 1 | hatBus 0 drumsBus 0`
  - `a second fire.started beat for the same fire: live drones = 0`
- Fix spec: on wake, re-derive the threat from `game.world.events` (G S1's fix), and if a fire or bomb is active, start the drone. Test: the sequence above expects 1 live 110 Hz oscillator after wake. Must not change: no drone when there is no threat, and none when music is 0.

### S7. (verify-H N1) The deploy.sh comment says compose uses --env-file, but the command passes none - CONFIRMED (final: ADVISORY)
- deploy/deploy.sh:9-10: `# final curl checks; the compose stack itself reads deploy/.env via` / `` # `docker compose --env-file` on pi3. ``
- deploy/deploy.sh:53: `ssh pi3 "cd /opt/hundred-stories && docker compose up -d"`
- It works only because :44 copies the file to `/opt/hundred-stories/.env`, which compose reads by default from the project directory.
- Fix spec: reword the comment to say the file is copied to the project directory's .env, which compose reads by default. No behavior change.

## Duplicates
- S3 is the same defect as verify-C S3 and lane A S1 (a burning room can be demolished). It closes with that fix.
- S4 is the built-shaft half of F2 S1. Its severity follows the F2 S1 phone step.
- S6 folds into verify-G S1 (re-derive the threat on wake).
- S1 is related to verify-D's stash finding (verify-D.md:93-96, "do not autosave over an unreadable slot"), but it is a separate path: no stash and no warning, and the write is immediate rather than at the next autosave.

## Notes
- None new.
