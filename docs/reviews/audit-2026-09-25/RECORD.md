## Audit - 2026-09-25 - whole application at 7b4e60f, second audit, after the story, weather, security, daily, build log, audio and UI polish rounds

Scope: target sha 7b4e60f. Twelve lanes (A, B, C, D, E1, E2, F1, F2, F3, G, H, I, cut in .itworks/LANES.md) were each read in full by one Opus reviewer. An independent Opus verifier then checked every suspicion by probe, scratch test or traced code path. Not covered: anything that needs a real phone GPU, a real browser, iOS audio session behavior, Cmd-key release on a Mac, or the live pi3 fallback host.

### Findings
- [ ] CRITICAL | real-data | an office whose only elevator is set to hotel riders still leases, pays full rent and counts its workers toward population and stars, although no worker can ever reach it (src/sim/people.ts:128) | Evidence to close: a scenario test with the only car set to hotel expects the office vacant and populationOf 0 after one weekday morning, and a lease-then-flip case vacates it within EVAL.leaveAfterMinutes plus a day; both red today, green after
- [ ] CRITICAL | real-data | demolishing a condo or burning an office while its tenant sits in another room (a restaurant, or a hotel room being cleaned) leaves that room at occupancy 1 with nobody inside, for good, which inflates population and blocks its demolition (src/sim/events.ts:134) | Evidence to close: after demolish, fire and bomb, a test asserts every room's occupancy equals the count of sims whose inRoomId is that room (guards and collectors excluded); red today, green after
- [ ] CRITICAL | real-data | lanes C S1 and D S2: cockroach spread timing lives in an unsaved WeakMap, so a hotel tower saved and reloaded after an infestation diverges from the straight run (the first hash difference is at minute 7561) (src/sim/events.ts:61) | Evidence to close: the verifyC s1.ts scenario as a vitest, save and load at minute 6181, then hashWorld equal after 5 days of lockstep ticks; red today (first diff 7561), green after, and existing bench hashes unchanged
- [ ] CRITICAL | real-data | opening Today's tower on a device whose date moved back (a clock or time zone change) overwrites the stored later daily, finished or not, with a fresh run and keeps no copy (src/game/daily.ts:167) | Evidence to close: dailyOpening({date:'2026-09-25',finished:false},'2026-09-24') is not 'fresh', and the game-level test shows the daily slot bytes unchanged after openDaily; red today, green after
- [ ] CRITICAL | real-data | a tower switch sets the slot before the IndexedDB read finishes, so an autosave in that window writes the old tower under the new slot's key, and a reload before the next save boots a friend's tower as My tower (src/game/game.ts:414) | Evidence to close: the verifyD race2.ts scenario as a vitest (ordered fake IndexedDB, a frame during the read) asserts the autosave key still holds seed 11; red today, green after
- [ ] CRITICAL | real-data | after an IndexedDB write fails and falls back to localStorage, the next read still prefers the older IndexedDB copy, so the tower silently rolls back (src/game/storage.ts:96) | Evidence to close: the S3 case in verifyD/storage-verify.test.ts expects readSave to return minute 5000; red today, green after, with the private-window path unchanged
- [ ] CRITICAL | real-data | a save file with a valid outer shape but bad insides (shaft width, a stats key, tenants, schedule, route) loads, then hangs the tick loop or throws; a 1e9 room height is refused slowly with the wrong reason (src/sim/save.ts:226) | Evidence to close: one test per verifyD s5.ts mutation, each refused with "This save is damaged and was not loaded. (<field>)" and the 1e9 height refused fast; red today, green after, and v1 to v5 files still load
- [ ] CRITICAL | real-data | tapping My tower after a friend link or Today's tower turns a damaged My tower save into a fresh tower and autosaves over it, with no copy kept and no message, unlike the boot path which keeps a copy and warns (src/game/game.ts:419) | Evidence to close: the verifyNew s1 scenario as a game test, a refused My tower payload under the slot key is left untouched and the player sees the same damaged-save message as at boot; red today, green after
- [ ] CRITICAL | real-data | a housekeeper cleaning an empty hotel room raises the population count while inside (0 before, 5 during, 0 after with no guests), and that count decides stars, so a tower near 300 or 1,000 can gain a star for an hour (src/sim/stars.ts:12) | Evidence to close: a stars.test.ts case with housekeepers in empty hotel rooms expects populationOf unchanged; red today, green after
- [ ] IMPORTANT | real-data | lanes A S1 and C S3: demolishing a burning room is allowed and leaves a roomless fire that never ends, keeping every arrival outside (10 game days in the probe) until a security office or a $250,000 helicopter ends it (src/sim/build.ts:447) | Evidence to close: a test that starts a fire the way startFire does, demolishes the room and ticks one minute expects no fire event, fireBurning false and arrivals resuming (or the demolish refused); red today, green after
- [ ] IMPORTANT | real-data | lanes A S2 and C S4: demolishing the bomb room leaves the threat standing, and at 13:00 the bomb destroys the four oldest rooms (ground lobby tiles) and charges $2,000,000 when no security office is on duty (src/sim/events.ts:269) | Evidence to close: a test plants a bomb, demolishes its room and ticks past 13:00, expecting no room destroyed and no $2,000,000 charge (or the demolish refused); red today, green after
- [ ] IMPORTANT | real-data | recycling at B3 and a metro at B4 are refused with "Build a floor below this one first." under ramps on B1, because hasSupport tests the room's own top floor, not the floor above it (src/sim/build.ts:196) | Evidence to close: the verifyA v3 layout as a build.test.ts case, recycling at -3 and metro at -4 x100 both ok; red today, green after, with parking at -3 over an empty B2 still refused
- [ ] IMPORTANT | real-data | a basement refused for lack of support tells the player "Build a floor below this one first." when the support it needs is the floor above it (src/sim/build.ts:379) | Evidence to close: parking on B1 with no lobby and on B2 with B1 empty give a reason that names the floor above (or the lobby), with build.test.ts:283-286 and :898 updated; red today, green after
- [ ] IMPORTANT | real-data | refusal messages read "Not enough cash. Lobbys cost $5,000.", "Lobbys must go above ground.", "Housekeepings cost $50,000." and "Fast foods cost $100,000." (src/sim/build.ts:77) | Evidence to close: a test over every RoomKind and ShaftKind refusal string finds no "ys ", "Housekeepings" or "Fast foods"; red today, green after
- [ ] IMPORTANT | real-data | turning off a stop while a rider is aboard for that floor strands the rider in the car for good, and the shaft can then never be demolished ("Wait until the cars are empty.") (src/sim/elevators.ts:216) | Evidence to close: a cars.test.ts case with a rider aboard for floor 4 expects setStop 4 off to return ok:false with a plain reason; red today, green after
- [ ] IMPORTANT | real-data | a diner waiting to ride down waits forever at stress 1 with no reason once the stop is turned off and the floor has no other route, because an exiting sim never gives up (src/sim/people.ts:617) | Evidence to close: a long-waits or scenario test of the verifyB s3.ts case expects the sim gone within HALL_CALL_RETRY_MINUTES*RETRIES_BEFORE_REROUTE + 1 minutes; red today, green after
- [ ] IMPORTANT | real-data | a tenant riding a car when their home burns is set to leaving but stays in car.passengers on the wrong floor, and with no other traffic the car never lets it off and the shaft cannot be demolished (src/sim/events.ts:134) | Evidence to close: the verifyB s5.ts quiet setup as a test, the sim gone within 30 minutes and car.passengers never holding a sim that is not riding; red today, green after
- [ ] IMPORTANT | real-data | lanes B S6 and C S5: the VIP and a booked thief walk into the lobby while a fire burns, against the 2026-09-24 rule that no arrivals enter during a fire, and the VIP visit is marked an incident (src/sim/events.ts:486) | Evidence to close: an events.test.ts fire-hold case, a fire at arrivesAt or enterAt keeps the VIP and the thief outside until the fire ends; red today, green after
- [ ] IMPORTANT | real-data | the 6-star chronicle says "0 tenants moved out" and "0 caught, 0 got away" because it counts from the 256-beat recent list, and it counts hotel checkouts as move-outs (src/sim/chronicle.ts:175) | Evidence to close: a test with more than 256 later beats expects the chronicle counts to match running totals, and a hotel checkout is not counted as a move-out; red today, green after
- [ ] IMPORTANT | real-data | in Today's tower, the menu's Open a saved file and Go back to last save rewind or reset a finished run so it can be played again, breaking one try per date (src/ui/panels.ts:1372) | Evidence to close: the verifyC overlay cases (a) export, finish, import and (b) import a My tower file then leave, both ending with getDaily().finished === true; red today, green after
- [ ] IMPORTANT | real-data | an IndexedDB write that aborts without an error event never settles, which leaves autosaveInFlight true for the session and hangs any tower switch while the tower is dirty (src/game/storage.ts:66) | Evidence to close: the S4 case in verifyD/storage-verify.test.ts expects writeSave to reject on abort instead of staying pending; red today, green after
- [ ] IMPORTANT | real-data | Open a saved file while in Today's tower replaces the daily with the file, freezes its clock under the daily rules, and loses today's run (src/game/game.ts:902) | Evidence to close: the lane D importdaily scenario as a test, the daily slot still holds daily:2026-09-28 and the imported tower's clock moves; red today, green after
- [ ] IMPORTANT | real-data | when the browser refuses writes, autosaves fail with no message and switching towers drops the unsaved tower (11 lobby tiles back to 1) (src/game/game.ts:413) | Evidence to close: the verifyD s7.ts scenario as a test, the switch is refused, the slot stays mine with 11 tiles in hand, and one warn line is logged; red today, green after
- [ ] IMPORTANT | real-data | nothing saves while the game is paused or when the page is hidden or closed, so building done while paused is lost on close (src/game/game.ts:288) | Evidence to close: the verifyD s8.ts scenario as a test, after a visibilitychange to hidden the disk holds 11 rooms; red today, green after
- [ ] IMPORTANT | real-data | after an unreadable save the game says "We kept a copy of it" even when the copy failed, nothing can get the copy back, and the fresh tower's first autosave overwrites the slot (src/game/game.ts:888) | Evidence to close: a test where stashUnreadable fails shows a message that does not claim a copy, and no autosave writes over the unreadable slot before the player picks a new tower; red today, green after
- [ ] IMPORTANT | real-data | lanes E1 S1 and E2 S1: switching to or importing a tower with a longer log replays up to 200 old lines as live fire, bomb and VIP cards, and a live fire card flips to "Fire out" (src/ui/ui.ts:1145) | Evidence to close: verifyE s1.vt.ts cases A and B red today and green after, case C and tests/ui/alerts.test.ts stay green, and a save loaded mid fire still shows "Fire on floor N"
- [ ] IMPORTANT | real-data | with site storage blocked, the Larger text, Color-blind views and Haptics switches show as on but change nothing, because prefs drop a failed write and read back from storage (src/ui/prefs.ts:64) | Evidence to close: with a throwing store, setFlag largeText true gives getFlag true and toggles hs-large-text, and setHapticsEnabled(false) makes hapticsEnabled() false; red today, green after
- [ ] IMPORTANT | real-data | player text uses words a reader of 8 to 10 does not know ("Haptics", "Shaft", "Whole shaft", "Night x8, x16 in all"), and the touch help leaves out the Build confirm step (src/ui/panels.ts:1436) | Evidence to close: tests/site/us-english.test.ts (or a new plain-word test) rejects those words and requires the Build step in the controls.ts:68 and ui.ts:92 lines; red today, green after
- [ ] IMPORTANT | real-data | the VIP checklist item "An elevator stops at floor N" stays unticked when the VIP reaches the suite by stairs or a sky lobby transfer, and can never tick for a suite above floor 31 (src/ui/vip.ts:68) | Evidence to close: a stairs-only tower expects the item done=true, and a tower with no route to the suite keeps it unticked; red today, green after
- [ ] IMPORTANT | real-data | the Today's tower choice card reads "You did not finish the one from September 20, 2026 tower yet." when the saved daily is older than yesterday (src/ui/daily.ts:38) | Evidence to close: a daily.test.ts case with yesterday:false expects a whole sentence such as "the tower from September 20, 2026"; red today, green after
- [ ] IMPORTANT | real-data | the landing page's friend greeting says "with 1 people" when the shared tower has one person (src/site/challenge.ts:33) | Evidence to close: a challenge.test.ts case with people=1 expects "1 person"; red today, green after
- [ ] IMPORTANT | real-data | the Event log panel is a developer's log, not a player's: 200 timestamped rows that do not fit a phone screen and a name no player knows (src/ui/panels.ts:958) | Evidence to close: the panel renamed in plain words and cut to a short recent feed that fits at phone width, screenshot attached, Matt's yes on the wording
- [ ] IMPORTANT | production-readiness | after a tower switch, a room that reuses an id from another layer stays in the old layer, so an office is drawn in the connector layer or stairs in the room layer until reload (src/render/renderer.ts:1180) (tower-switch family) | Evidence to close: the lane F1 P1 probe as a reconcile.test.ts case expects the office sprite's parent to be rooms after the swap; red today, green after
- [ ] IMPORTANT | production-readiness | people in rooms are picked and ringed at the room center, not where they are drawn, and at far zoom a tap on an office selects a hidden person, against the 2026-09-20 rule that a tap selects only a drawn sim (src/render/renderer.ts:702) | Evidence to close: the verifyF render.test.ts harness, a tap on the in-room sprite gives the simId, on the empty center the roomId, and at far zoom the roomId; red today, green after
- [ ] IMPORTANT | production-readiness | dragging or extending an elevator bakes and keeps a full-height texture for every span, reaching 100 textures, 558 MB and 14,400 px tall, past the 8192 px limit, for a shaft of 57 floors or more (src/render/art.ts:1970) | Evidence to close: an art-classes-style test with a recording generateTexture, ghosts and shafts for 1..110 bake nothing over 8192/resolution px and keep only a few ghost keys; red today, green after, plus the phone step in Coverage gaps
- [ ] IMPORTANT | production-readiness | while a fire burns and the sim holds people outside, the curb draws them walking into the lobby door (23 of 23 street figures heading in) (src/render/curb.ts:51) | Evidence to close: a curb.test.ts case with a fire event expects no figure with heading 'in' and none reaching offset 0; red today, green after
- [ ] IMPORTANT | production-readiness | if a fire, bomb or theft ends while sound is off, or the tower is switched mid-incident, the music stays ducked with drums silent and all effect sounds muted until reload (src/audio/audio.ts:684) (tower-switch family) | Evidence to close: tests/audio/audio.test.ts (a) fire.started, sound off and on gives tension false and a car.arrive schedules 4 oscillators, (b) fire.started then world replaced gives gains[7] and gains[8] above 0; red today, green after
- [ ] IMPORTANT | production-readiness | after an in-session tower switch the new tower plays the old tower's chapter, tempo and key, so a 1-star tower opened after a 5-star one never climbs the chapter ladder (src/audio/audio.ts:555) (tower-switch family) | Evidence to close: an audio.test.ts case built on seed 1 at 5 stars, swapped to seed 2 at 1 star, gives chapter 1 and tempoFor(2), then chapter 2 at 2 stars; red today, green after
- [ ] IMPORTANT | production-readiness | the live 404 page still says the game is coming to Steam, links the GitHub source and says "Source available to read", and the PWA manifest names Steam, against two 2026-09-24 decisions (404.html:31) | Evidence to close: a new tests/site/stores.test.ts check that 404.html, how-to-play, privacy and the manifest description contain no "Steam", "Source on GitHub" or "Source available to read"; red today, green after
- [ ] ADVISORY | real-data | setCarRange with lo 0 and hi 1 on a B1-to-5 shaft is accepted, and the car serves floor 1 only; it is reachable only through a crafted build log or save (src/sim/build.ts:722) | Evidence to close: a test that range {0,1} is refused by doSetCarRange and the save validator while {-1,1} is still accepted; red today, green after
- [ ] ADVISORY | real-data | the quarter summary prints negative money as "profit $-30,000. Cash: $-20,000." (src/sim/economy.ts:62) | Evidence to close: a test through tick expects "-$30,000" in the summary line; red today, green after
- [ ] ADVISORY | real-data | ECONOMY.officeRentEvalScale is never read, the 5-minute long wait is defined twice, and the 06:00 start and rent 100 are literals outside rules.ts (src/sim/economy.ts:28) | Evidence to close: grep shows the flag read or removed, one long-wait constant, and RENT.default used at evaluation.ts:128 and :145, with every replay hash unchanged
- [ ] ADVISORY | real-data | a sim climbing stairs that are demolished mid-climb still arrives on the next floor with no connector there (src/sim/people.ts:484) | Evidence to close: the verifyB s78.ts stairs fixture as a test expects pos.floor to stay 1; red today, green after
- [ ] ADVISORY | real-data | changing a car's range while its doors are open boards a rider at a floor outside the new range (src/sim/elevators.ts:197) | Evidence to close: the verifyB s78.ts range fixture as a test expects rider b still waiting after one tick; red today, green after
- [ ] ADVISORY | real-data | once its room is demolished, the story line "I made it to floor 2" becomes "I made it out to the street", a place the sim never went (src/sim/story.ts:323) | Evidence to close: describeBeat on a trip.arrived beat after the room is deleted contains no "street" in any of the three voices; red today, green after
- [ ] ADVISORY | real-data | lanes D S10 and I S11: the rentDay event and its register sound fire at midnight, 301 game minutes before rent moves cash at 05:00 (src/game/events.ts:96) | Evidence to close: tests/game/events.test.ts:131 starts at 3*1440+299 and expects one rentDay after that step and none after a step from 3*1440-1; red today, green after
- [ ] ADVISORY | real-data | two desktop saves of one slot at the same time share one .tmp file, so the second reports "This device would not let the game save." although the data landed (src/game/storage.ts:270) | Evidence to close: the verifyD s11.ts fake Tauri fs as a test, two concurrent writeSave calls both resolve ok; red today, green after
- [ ] ADVISORY | real-data | the first refused Build or Add car shows its refusal twice, as a notice card and a news toast (src/ui/ui.ts:1104) | Evidence to close: the verifyE s3.vt.ts case, the first refused Add car shows exactly one card and no news toast; red today, green after
- [ ] ADVISORY | real-data | a parked outline survives Open a saved file and Go back to last save, and a parked shaft extension re-anchors to the loaded tower's same-id shaft, which Build then extends (src/game/game.ts:902) (tower-switch family) | Evidence to close: a test that parks an outline, calls importSave and expects getPlacement() to be null; red today, green after
- [ ] ADVISORY | real-data | Space on a focused button pauses the game, and number keys change the build tool behind the open modal Settings sheet (src/ui/ui.ts:1353) | Evidence to close: the verifyE s56.vt.ts cases, Space on a button target does not call togglePause and key 1 with an aria-modal sheet open does not call setTool; red today, green after
- [ ] ADVISORY | real-data | the controller's A button clicks the tower canvas behind an open sheet once focus has fallen to the page body (src/ui/ui.ts:1236) | Evidence to close: the verifyE s56.vt.ts S6 case, the canvas receives no pointer events and focus moves into the open menu; red today, green after
- [ ] ADVISORY | real-data | the text "You can follow eight people at a time." is written out by hand, not built from STORY_FOLLOWED_CAP, so changing the cap fails no test (src/ui/panels.ts:105) | Evidence to close: a test that ties the rendered sentence to STORY_FOLLOWED_CAP goes red when the cap changes without the text
- [ ] ADVISORY | real-data | finishing an older daily shows "Come back tomorrow" and "today" words while today's tower is still unplayed (src/ui/daily.ts:68) | Evidence to close: a copy test rendering a 2026-09-24 daily on the 25th expects date-aware words and a Start today's button on the result card; red today, green after
- [ ] ADVISORY | real-data | sharing a tower with nothing above ground makes a floors=0 link that the landing page rejects, so the friend loses the greeting and the Start the same tower button (src/share/share.ts:78) | Evidence to close: a share round-trip test at floors 0 keeps the tower button (challenge.test.ts:66 updated if floors 0 is allowed); red today, green after
- [ ] ADVISORY | production-readiness | after a tower switch, a shop or restaurant sign keeps the previous tower's brand and mirror, so the sign disagrees with the room panel (src/render/renderer.ts:1210) (tower-switch family) | Evidence to close: the lane F1 P2 probe as a reconcile test expects the sign to match the panel name after the swap; red today, green after
- [ ] ADVISORY | production-readiness | after switching to a tower with the same room and shaft counts, the floor strips, curb doors and weather boxes stay at the old tower's positions (src/render/renderer.ts:1111) (tower-switch family) | Evidence to close: the lane F1 P3 probe as a reconcile test expects the strip bounds to move to the new office at 4800 px; red today, green after
- [ ] ADVISORY | production-readiness | Cmd+A pans the camera because only plus and minus check for modifier keys, and it may keep drifting if macOS drops the keyup (src/render/renderer.ts:2120) | Evidence to close: a harness test dispatching keydown KeyA with metaKey leaves camera.x unchanged; red today, green after, plus the Mac step in Coverage gaps
- [ ] ADVISORY | production-readiness | the ring on a selected person riding an elevator stays at the hall floor while the car carries them away (src/render/renderer.ts:1866) | Evidence to close: the verifyF riding-sim probe expects the ring hidden or drawn on the car; red today, green after
- [ ] ADVISORY | production-readiness | with stairs on floor 2 at x104 and floor 3 at x100, a tap on the overlap picks the flight drawn underneath (src/render/renderer.ts:216) | Evidence to close: the verifyF overlap probe expects pickRoomAt(floor 3, tile 106) to return id 44; red today, green after
- [ ] ADVISORY | production-readiness | stairs from B1 to the ground draw no floor strip on the ground floor and are missing from the weather boxes (src/render/renderer.ts:662) | Evidence to close: builtFloorExtents on a world holding only those stairs returns keys -1 and 1; red today, green after
- [ ] ADVISORY | production-readiness | an elevator ghost that spans the ground floor is drawn one floor off, so a B1-to-1 drag shows floors 1 to B2 (src/game/game.ts:624) | Evidence to close: the verifyF probe expects y ranges -72..72 and -144..216 for the two spans, with room ghosts unchanged; red today, green after
- [ ] ADVISORY | production-readiness | a null 2D canvas context is cached for the session as a blank texture with no warning, so that art stays invisible (src/render/art.ts:1895) | Evidence to close: the verifyF f2s34.ts case, a second call tries getContext again and one warning is logged; red today, green after
- [ ] ADVISORY | production-readiness | the art.ts header says cars have five baked door positions, but the code bakes three (src/render/art.ts:19) | Evidence to close: the header comment matches the [0,2,2,2,4] map at art.ts:1954-1956 on reading
- [ ] ADVISORY | production-readiness | after switching from a rainy tower to a clear one, rain, umbrellas over the new tower's indoor people and a wet street for 42 seconds carry over (src/render/renderer.ts:925) (tower-switch family) | Evidence to close: the verifyF harness expects 0 street figures and 0 umbrellas on the first frame after the swap and a dry street; red today, green after
- [ ] ADVISORY | production-readiness | at 2x and 4x night speeds the HUD says Rain while no rain is drawn (1,133 ms of the label against 0 ms of rain at 4x) (src/ui/status.ts:388) | Evidence to close: a status test at 320 minutes per second where the weather label and rainFalling agree; red today, green after
- [ ] ADVISORY | production-readiness | a person on the way out is drawn both inside the tower and on the street in 45 of 60 frames (src/render/curb.ts:51) | Evidence to close: the verifyF leaving-sim probe expects 0 frames with the sim in both the people layer and the curb; red today, green after
- [ ] ADVISORY | production-readiness | stars gained while sound is off do not move the music chapter when sound comes back on (src/audio/audio.ts:613) | Evidence to close: an audio.test.ts case, sound on, off, stars set to 3, on, gives chapter 3; red today, green after
- [ ] ADVISORY | production-readiness | turning sound on and then off before the resume settles leaves the AudioContext running silently until the next toggle (src/audio/audio.ts:710) | Evidence to close: a deferred-resume stub test, on, off, resume settles, state is 'suspended'; red today, green after, plus the iPhone step in Coverage gaps
- [ ] ADVISORY | production-readiness | deploy.sh copies nginx.conf to pi3, but docker compose up -d does not recreate the container, so an nginx.conf change never takes effect on the fallback host (deploy/deploy.sh:53) | Evidence to close: deploy.sh passes --force-recreate (or restarts the service) after the copy, shown by grep, and deploy/README.md:57 says so
- [ ] ADVISORY | production-readiness | the pi3 fallback runbook adds an apex A record without first removing the Workers custom domain, and deploy.sh carries on without deploy/.env and never fails on a 404 or 502 (deploy/README.md:11) | Evidence to close: the README has a step to remove the custom domains first, and deploy.sh exits non-zero with no deploy/.env and on any non-200 check (curl -fsS, no swallowed failure)
- [ ] ADVISORY | production-readiness | the service worker precaches 14 landing-only files (369 KB of pages, wordmarks and og.png) outside its /play/ scope, and every page registers it (vite.config.ts:92) | Evidence to close: a tests/site/app-build.test.ts assertion that the dist/sw.js list has no index.html, 404.html, privacy/, how-to-play/, og.png, wordmark-* or assets/main-*; red today, green after
- [ ] ADVISORY | production-readiness | npm run store:shots loads og.png and the wordmark from dist-app, where the app build deletes them, so it exits at the first store graphic and never writes manifest.json (scripts/make-store-shots.mjs:54) | Evidence to close: a unit test that every GRAPHICS source exists on disk and is not loaded through the preview base; red today, green after
- [ ] ADVISORY | production-readiness | the store "closer" scene takes one zoom step, which snaps back to zoom 1, so it is the same picture as "tower" (scripts/make-store-shots.mjs:323) | Evidence to close: a tests/store test that applies each scene's steps through nearestSnap and requires distinct zooms; red today, green after
- [ ] ADVISORY | security-auth | the Tauri capability grants recursive read-all and write-all over $APPDATA (remove, copy, truncate, read_dir and more) where saving needs only mkdir, text read and write, rename and write_file (src-tauri/capabilities/default.json:7) | Evidence to close: a tests/site/versions.test.ts JSON check pins the minimum permission list including fs:allow-rename, and a Tauri run of save, reload, export and import passes
- [ ] ADVISORY | production-readiness | three _headers no-cache rules are keyed to /index.html paths, which only ever match the redirect, never the page served (public/_headers:23) | Evidence to close: a tests/site check that every rule path other than /assets/* and the named .js and .webmanifest files ends in /; red today, green after
- [ ] ADVISORY | production-readiness | running deploy.sh a second time for the same release, or after a failed run, overwrites html.prev with the live release and destroys the only rollback copy (deploy/deploy.sh:31) | Evidence to close: a shell check that a second run with html identical to dist leaves html.prev untouched, per the verify-H S9 trace
- [ ] ADVISORY | testing | charging an elevator shaft twice in doBuildShaft leaves every build, game, UI and scenario test green (src/sim/build.ts:488) | Evidence to close: a build.test.ts case, a standard shaft at x120 floors 1 to 3 lowers cash by exactly SHAFTS.standard.shaftCost; green on live code, red under mutation 1b
- [ ] ADVISORY | testing | no test proves that four refusals (a shaft over a shaft, a ninth car, an unaffordable ransom, an unaffordable helicopter) leave cash and the hash unchanged; the live code is correct (src/sim/build.ts:421) | Evidence to close: four tests that snapshot world.cash and hashWorld around each refused call; green on live code, red under mutations 2b, 2c, 2d and 2f
- [ ] ADVISORY | testing | a star falling two ranks at once passes the stars, story-beats and first-tower tests (src/sim/stars.ts:56) | Evidence to close: a stars.test.ts case, 4 stars with 167 leased offices gives population 1002 and stars 3; green on live code, red under mutation 4c
- [ ] ADVISORY | testing | dropping any one of the medical, recycling, suite or cathedral star requirements passes every test (src/sim/stars.ts:34) | Evidence to close: a table-driven stars.test.ts with a control and five one-missing cases; green on live code, red under mutations 11b to 11e
- [ ] ADVISORY | testing | no test checks that a vacant condo stays unsold while a different room burns; the live rule holds, but breaking it leaves every test green (src/sim/people.ts:114) | Evidence to close: an events.test.ts fire case with a second vacant condo that stays vacant from 07:30 to 09:00, plus a no-fire control that sells; green on live code, red under mutation 6c
- [ ] ADVISORY | testing | a save whose rooms array is reordered loads with an equal hash but diverges within 2 days ($84 cash gap), and dropping collector state or fire events from the hash passes save and replay tests (src/sim/save.ts:671) | Evidence to close: a save.test.ts reversed-rooms round trip equal after 2 days (with deserialize sorting by id), plus guard, collector and fire-event hash tests; red under 7a, 7b, 8e
- [ ] ADVISORY | testing | the security scenario's "nothing was lost" check still passes when a caught theft books its loss as negative shop income (tests/scenarios/security.test.ts:92) | Evidence to close: snapshot stats.incomeByKind before runTheft and expect no entry to fall; green on live code, red under mutation 12a
- [ ] ADVISORY | testing | the demo cap test never checks a two-floor room's top floor, so a cinema at floor 20 reaching floor 21 passes every test (src/sim/build.ts:358) | Evidence to close: a demo-cap.test.ts refused(...) case for a cinema at floor 20 x150; green on live code, red under mutation 9e
- [ ] ADVISORY | testing | no test covers refusing a range change on a car with passengers, or the log line when a visitor gives up waiting (src/sim/build.ts:734) | Evidence to close: the verifyI S9a case in cars.test.ts and log-count expectations at people.test.ts:632 and :723; green on live code, red under mutations 11a and 11f
- [ ] ADVISORY | testing | the story-worker test builds its expected text with minutesText, the function it checks, so that test cannot catch a wording break (tests/scenarios/story-worker.test.ts:112) | Evidence to close: a literal-form expectation at story-worker.test.ts:112 that goes red under mutation 13a
- [ ] ADVISORY | real-data | demolishing the burning room also skips the $20,000 fire damage charge ($0 against $20,000 in the control run); folds into the fire-demolition IMPORTANT above (src/sim/build.ts:447) | Evidence to close: the fire-demolition fix's test also asserts the damage charge or the refusal
- [ ] ADVISORY | production-readiness | a normally built express shaft from 1 to 100 bakes a 14,400 px texture (15,840 px for B10 to 100), the same over-8192 texture as the drag case above, so the phone check covers both (src/render/art.ts:1970) | Evidence to close: the same art-classes test as the drag finding, built shafts included
- [ ] ADVISORY | production-readiness | a person picked from a room's occupant list who is not one of the drawn quarter gets a selection ring drawn around empty floor (src/render/renderer.ts:1866) | Evidence to close: a render test picks an undrawn occupant and expects no ring; red today, green after
- [ ] ADVISORY | production-readiness | turning sound off and on during a still-burning fire drops the fire drone for the rest of that fire; folds into the stuck-tension IMPORTANT above (src/audio/audio.ts:684) | Evidence to close: the stuck-tension fix's test also toggles sound mid-fire and expects the drone back
- [ ] ADVISORY | production-readiness | deploy.sh's header comment says compose reads --env-file, but the command at line 53 passes no such flag; behavior is fine, the comment is wrong (deploy/deploy.sh:9) | Evidence to close: the comment matches the command

### Refuted
- Lane I S5, condo sale during a fire: the live rule holds, only the test is missing. people.ts:114 gates sellVacantCondos on no fire, and the verifyI s5.test.ts fire run left the condo vacant with no sale log while the no-fire control sold it. Filed above as a testing ADVISORY instead.
- No other suspicion was REFUTED outright. These claims inside PARTIAL verdicts did not hold:
  - D S1: "gone from memory too" did not hold. Only the disk copy is at risk, and only on the IndexedDB path (race.ts ran a tick synchronously, which a browser cannot do).
  - E1 S3: "alternates between once and twice" did not hold. Only the first refusal, or the first after a different notice, is doubled.
  - F1 S7: the reviewer's input did not overlap. The verifier's corrected input reproduces the defect.
  - H S3: the curl checks do not always hit Cloudflare. They reach pi3 once DNS moves.
  - I S6: the sims-order divergence did not reproduce at three save points. Only the rooms order diverges.
  - Also: C S3's "shut for good" claim was corrected, since a $100,000 security office ends the fire at 2 stars. A S1 was lowered from CRITICAL for the same reason.

### Questions for the owner
- A shaft counting as structure: may a free-standing elevator shaft, in the sky or underground, hold up rooms, or must a shaft start from something built? (lane A S5, PARTIAL, filed here and not as a finding.)
- Chapter after a lost star: should the in-session "chapter never drops" hold survive a reload (store the high-water mark), or should the chapter follow world.stars? (lane G S5, PARTIAL, filed here.)
- Dirt and cockroaches are not drawn: should a dirty, backlogged or infested room get an in-world mark, or is the panel enough? VISUAL.md:37 names only the night housekeeping state. (lane F2 S4, PARTIAL, filed here.)
- Hotel population swings: population counts hotel rooms only while guests are inside, so a hotel-heavy tower near a threshold can fall and regain a star every day. Is that intended? (lane A)
- Fire demolition as a firebreak: should a burning room be demolishable, with the fire ending when its last room is gone, or refused outright? Today it also skips the $20,000 per-room damage. (lanes A S1 and C S3; fix direction)
- Web saves when the web build flips to demo: existing web saves carry edition 'web' logs, so verifySave reports "unavailable" and building outside the box is refused. Is that the plan? (lane A)
- Riders whose room is demolished mid-ride keep a dead id in car.passengers and a stale call until the next door opening. Should doDemolish unseat them? (lane A)
- Should leasing and booking use the rider-class-aware route check instead of the class-blind one DESIGN.md section 6 describes? (lane B S1 assumes yes)
- Is the VIP and thief fire exemption in the people.ts:72-75 comment intended? If so it needs a DECISIONS line. The verifiers read line 79 as covering both. (lanes B S6 and C S5)
- Should a failed autosave tell the player once per session, given that autosave is silent by design? (lane D S7 assumes yes)
- Should a ?daily=DATE share link open that date's tower rather than today's? (lanes D and E2)
- Should bootTarget apply share.ts validStart, so that ?seed=4294967296 (which gives the same rng as 0) and similar values are refused? (lane E2)
- The bomb card's Pay ransom stays enabled when cash is short, while the fire card disables its button. Is that difference intended? (lane E2)

### Coverage gaps
- UNVERIFIABLE HERE, lane F2 S1 (and the built express shaft texture): on a phone with Safari Web Inspector or Chrome remote debugging, open https://hundredstories.xyz/play/ and run `(()=>{const g=document.createElement('canvas').getContext('webgl2');return g.getParameter(g.MAX_TEXTURE_SIZE)})()`. Then in a 3-star tower drag an Express up from floor 1 and press ▲ past floor 60. Watch for the outline vanishing past floor 56, "WebGL: context lost", or a blank canvas.
- UNVERIFIABLE HERE, lane F1 S5: in Safari or Chrome on macOS at /play/, press Cmd+A, release A, then Cmd, and watch whether the view keeps drifting left.
- UNVERIFIABLE HERE, lane G S4: on an iPhone in Safari, toggle Sound on and off within about 100 ms while a Music app track plays, then check whether the track stays ducked.
- Needs a browser, lane D S4: fill the storage quota in Chrome and Safari and log tx.onerror and tx.onabort. This checks whether a quota failure at commit arrives as abort only. The code defect stands either way.
- Needs a browser, lane E2: the real Popover toggle timing and the hero WebGL on /play/ and / (for example an agent-browser run).
- Needs a browser, lane H question: serve dist behind a CSP without style-src 'unsafe-inline', load /play/ and /, and grep the console for "Refused to apply inline style".
- Live pi3 host, lane H: `ssh pi3 'docker exec hundred-stories nginx -T'` (check Content-Security-Policy), `cat /opt/hundred-stories/.env`, and the Traefik dynamic config.
- Rust side, lane G: read only. Closing it needs `cargo test --features steam` on a machine with the Steam SDK.
- Files skipped or read in part:
  - lane B: tests/sim/routing.test.ts, long-waits.test.ts and tests/scenarios/growth.test.ts were read by case list and helpers, not line by line.
  - lane C: tests/scenarios/security.test.ts, recycling.test.ts, vip-journey.test.ts and story-worker.test.ts were read by test names and fixtures only.
  - lane D: tests/game/pointer.test.ts was skimmed.
  - lane E2: only the case lists of tests/ui/hover.test.ts and minimap.test.ts were read. tests/site landing, platforms, stores, app-build, fonts, versions and wordmark were not read (they ran green).
  - lane F3: src/sim/types.ts was read in part (reference only).
  - lane H: scripts/replay.ts is outside the lane glob. For src-tauri/Cargo.lock, only the tauri and tauri-plugin-fs pins were checked.
  - lane I: the bodies of people.ts, events.ts, rules.ts, story.ts and game/events.ts were read only around each mutation site. growth.test.ts was not run.
  - The F verifier read art.ts, game.ts, camera.ts and hierarchy.ts in part, around the cited sites.
  - Lanes A, E1, F1, F2 and G skipped nothing in scope.
- Not in scope (LANES.md): node_modules/ (npm audit); dist/ and dist-app/ (audited as artifacts in lane H); ios/ and android/ generated shells; generated icons, fonts, og.png and wordmarks; docs/, README.md, LICENSE, HANDOFF.md, SHIPPED.md and store/*.md (read as contract); ui.css, site.css and fonts.css (need a browser pass); audio-preview/index.html; the tests/ui, render, audio, site, share and store folders (read only by their lane's reviewer).

----

| Lane | Suspicion id(s) | Final severity | Label |
|---|---|---|---|
| B | S1 | CRITICAL | unreachable offices still pay rent |
| B | S4 | CRITICAL | phantom occupancy after eviction |
| C, D | C S1, D S2 | CRITICAL | roach spread lost on reload |
| C | S2 | CRITICAL | backwards date overwrites daily |
| D | S1 (PARTIAL) | CRITICAL | slot switch autosave race |
| D | S3 | CRITICAL | stale IndexedDB read after fallback |
| D | S5 | CRITICAL | bad save insides hang loop |
| A, C | A S1, C S3 | IMPORTANT | burning room demolition fire |
| A, C | A S2, C S4 | IMPORTANT | bomb room demolition blast |
| A | S3 | IMPORTANT | multi-floor basements refused |
| A | S4 | IMPORTANT | basement refusal says below |
| A | S7 | IMPORTANT | Lobbys plurals in refusals |
| B | S2 | IMPORTANT | stop off strands riders |
| B | S3 | IMPORTANT | exiting sim waits forever |
| B | S5 | IMPORTANT | evicted rider stuck in car |
| B, C | B S6, C S5 | IMPORTANT | VIP and thief enter fire |
| C | S6 | IMPORTANT | chronicle tallies from capped list |
| C | S8 | IMPORTANT | daily rewind through saving menu |
| D | S4 | IMPORTANT | aborted IndexedDB write hangs |
| D | S6 | IMPORTANT | import in daily freezes |
| D | S7 | IMPORTANT | failed slot writes silent |
| D | S8 | IMPORTANT | no save paused or closing |
| D | S9 | IMPORTANT | kept-a-copy promise unusable |
| E1, E2 | E1 S1, E2 S1 | IMPORTANT | stale alert cards replay |
| E1 | S2 | IMPORTANT | blocked storage prefs inert |
| E1 | S7 (PARTIAL) | IMPORTANT | player words not plain |
| E2 | S2 | IMPORTANT | VIP elevator item unticked |
| E2 | S3 | IMPORTANT | broken daily choice sentence |
| E2 | S5 | IMPORTANT | 1 people greeting |
| Owner | owner-reported Event log | IMPORTANT | Event log too technical |
| F1 | S1 | IMPORTANT | reused id wrong layer |
| F1 | S2 | IMPORTANT | person pick at room center |
| F2 | S1 | IMPORTANT | elevator ghost texture growth |
| F3 | S1 | IMPORTANT | curb walkers enter fire |
| G | S1 | IMPORTANT | tension stuck after incident |
| G | S2 | IMPORTANT | old chapter after switch |
| H | S1 | IMPORTANT | 404 and manifest Steam text |
| A | S6 | ADVISORY | car range includes floor 0 |
| A | S8 | ADVISORY | negative money formatting |
| A | S9 | ADVISORY | numbers outside rules.ts |
| B | S7 | ADVISORY | climb demolished stairs |
| B | S8 | ADVISORY | range change doors open |
| C | S7 | ADVISORY | invented out to street |
| D, I | D S10, I S11 | ADVISORY | rentDay fires at midnight |
| D | S11 | ADVISORY | shared desktop tmp file |
| E1 | S3 (PARTIAL) | ADVISORY | refusal shown twice |
| E1 | S4 | ADVISORY | parked outline survives import |
| E1 | S5 | ADVISORY | Space and keys behind sheet |
| E1 | S6 | ADVISORY | controller A behind sheet |
| E1 | S8 | ADVISORY | follow limit literal |
| E2 | S4 | ADVISORY | older daily today wording |
| E2 | S6 | ADVISORY | floors 0 share rejected |
| F1 | S3 | ADVISORY | stale shop sign brand |
| F1 | S4 | ADVISORY | stale floor strips signature |
| F1 | S5 (PARTIAL) | ADVISORY | Cmd+A camera pan |
| F1 | S6 | ADVISORY | ring stays at hall |
| F1 | S7 (PARTIAL) | ADVISORY | overlapping flights pick order |
| F1 | S8 | ADVISORY | B1 stairs no strip |
| F2 | S2 | ADVISORY | ghost one floor off |
| F2 | S3 | ADVISORY | null context cached blank |
| F2 | S5 | ADVISORY | door positions comment stale |
| F3 | S2 | ADVISORY | old rain after switch |
| F3 | S3 | ADVISORY | HUD rain not drawn |
| F3 | S4 | ADVISORY | leaving person drawn twice |
| G | S3 | ADVISORY | stars while sound off |
| G | S4 | ADVISORY | AudioContext left running |
| H | S2 | ADVISORY | nginx.conf never applied |
| H | S3 (PARTIAL) | ADVISORY | pi3 runbook DNS collision |
| H | S4 | ADVISORY | precache landing pages |
| H | S5 | ADVISORY | store shots script fails |
| H | S6 | ADVISORY | closer scene same zoom |
| H | S7 | ADVISORY | Tauri capability too broad |
| H | S8 | ADVISORY | headers rules never match |
| H | S9 | ADVISORY | rerun destroys rollback copy |
| I | S1 | ADVISORY | double shaft charge unguarded |
| I | S2 | ADVISORY | refusal state unguarded |
| I | S3 | ADVISORY | two-rank star fall unguarded |
| I | S4 | ADVISORY | star requirements unguarded |
| I | S5 | ADVISORY | condo fire sale unguarded |
| I | S6 (PARTIAL) | ADVISORY | hash blind to order |
| I | S7 | ADVISORY | theft loss via ledger |
| I | S8 | ADVISORY | demo cap top floor |
| I | S9 | ADVISORY | two verification behaviors untested |
| I | S10 | ADVISORY | story-worker self-referential text |

Routed to Questions, not finding lines: A S5 (PARTIAL), F2 S4 (PARTIAL), G S5 (PARTIAL).

Counts:
- Finding lines: 84 in all (CRITICAL 7, IMPORTANT 30, ADVISORY 47).
- Confirmed by severity (verifier verdict CONFIRMED, one line per deduped defect): CRITICAL 6, IMPORTANT 28, ADVISORY 42, total 76. Of these, lane I S1 to S5 and S7 to S10 are test gaps; the live code is correct.
- Partial: 10 verdicts. 7 are filed as findings (D S1 CRITICAL; E1 S7 IMPORTANT; E1 S3, F1 S5, F1 S7, H S3 and I S6 ADVISORY). 3 are routed to Questions (A S5, F2 S4, G S5).
- Owner-reported: 1 (the Event log, IMPORTANT, not verifier-checked).
- Refuted: 0 outright verdicts. Lane I S5's live-defect claim was refuted, and it is filed as a testing gap.
- Unverifiable: 0 whole verdicts. 3 UNVERIFIABLE HERE sub-parts (F2 S1 phone GPU, F1 S5 Mac keyup, G S4 iOS ducking) are listed under Coverage gaps.
- Raw suspicions: 92 across 12 lanes. Duplicate verdicts folded into shared lines: C S3, C S4, C S5, D S2, E2 S1, I S11. That gives 82 CONFIRMED and 10 PARTIAL.
