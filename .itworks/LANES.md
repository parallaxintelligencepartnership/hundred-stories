# Review lanes: Hundred Stories

A lane is one reviewer's full read: a slice of the tree small enough to read end to end in one
pass, cut along the boundaries that matter here (stored records, game time, cash, the save file,
determinism, what the browser is allowed to load) rather than along the directory tree. Lanes are
re-derived whenever MAP.md's Layout table moves; a lane whose listed files no longer exist is
stale. Re-cut 2026-09-25 for the second audit, after the story, weather, security, daily, build
log, audio and UI polish rounds.

## Lane A: Simulation core and the build log
Lens id: real-data
Files in scope:
- src/sim/types.ts, rules.ts, rng.ts, world.ts, tick.ts, build.ts, economy.ts, evaluation.ts, stars.ts
- src/sim/buildlog.ts, replay.ts, scripts/replay.ts
Invariants to attack:
- The same starting number plus the same command list always yields the same world hash, and replay from the build log lands on the saved hash.
- Nothing in src/sim reads Date, Math.random, performance.now, the DOM, or pixi.js.
- Cash is charged exactly once per accepted command and never for a refused one; a refused command leaves the world unchanged.
- Support rules: a room needs structure directly under it (above for basements); stairs and escalators live between B1 and the ground; demolition that removes the only support is refused; older towers are grandfathered.
- The demo cap refuses exactly outside the box and never inside it.
- A star rises one rank at a time only when population and every extra condition hold, and never falls incorrectly.
- Every number the logic uses comes from rules.ts.
Probe recipes:
- npx vitest run tests/sim/build.test.ts tests/sim/economy.test.ts tests/sim/stars.test.ts tests/sim/replay.test.ts tests/sim/replay-start.test.ts tests/sim/demo-cap.test.ts tests/sim/baselines.test.ts
- grep -rn "Date\.\|Math\.random\|performance\.\|window\.\|document\." src/sim/
Never re-flag:
- Extending a shaft is free (2026-09-18); the v1 room set is the original set (2026-09-18); one-room overhangs stay legal (2026-09-24); stairs overlay rooms and count the room under them as support (2026-09-24); the demo cap figures (2026-09-22).

## Lane B: People and transport
Lens id: real-data
Files in scope:
- src/sim/people.ts, elevators.ts, routing.ts
Invariants to attack:
- A person is counted in exactly one place: a room's occupancy, a car's passenger list, or neither; occupancy never goes negative.
- Every rng draw happens in an order that does not depend on Map or Set insertion order.
- A destroyed or demolished room leaves no person pointing at it.
- A car never carries more than its capacity and never serves a floor outside its range; the leftover pickup rule never strands a rider.
- A route always ends at its destination or the person leaves with a logged reason; no infinite wait.
Probe recipes:
- npx vitest run tests/sim/people.test.ts tests/sim/elevators.test.ts tests/sim/routing.test.ts tests/sim/cars.test.ts tests/sim/long-waits.test.ts tests/scenarios/growth.test.ts
Never re-flag:
- Elevator boarding cost 5, stairs 4 per floor (2026-09-19); per-car floor range and rider setting (2026-09-19h); one sim in four drawn is a renderer choice (2026-09-20).

## Lane C: Events, story, security, recycling, weather, daily
Lens id: real-data
Files in scope:
- src/sim/events.ts, story.ts, chronicle.ts, identity.ts, security.ts, recycling.ts
- src/game/weather.ts, src/game/daily.ts
Invariants to attack:
- Every event that starts has a path to ending, and a fire admits no arrivals while it burns.
- A story beat is only ever recorded from something that happened; prose never invents.
- Exactly one theft per tower; a guard on patrol catches or misses by a seeded draw, never by iteration order.
- Waste and dirt: the backlog never goes negative, a collected room returns clean, and nothing is charged twice.
- Weather derives from starting number and minute only, never from world.rng, and never enters the hash.
- Today's tower: the local date maps to one starting number and twist, the run ends at exactly eight days, the score is population, and one try per date holds across reload and midnight.
Probe recipes:
- npx vitest run tests/sim/events.test.ts tests/sim/story.test.ts tests/sim/story-beats.test.ts tests/sim/identity.test.ts tests/scenarios/security.test.ts tests/scenarios/recycling.test.ts tests/scenarios/vip-journey.test.ts tests/scenarios/story-worker.test.ts tests/game/weather.test.ts tests/game/daily.test.ts
Never re-flag:
- No arrivals during a fire (2026-09-24); Today's tower design: two twists, eight days, one try per date, own slot (2026-09-24); Narrow lot left out (2026-09-24).

## Lane D: Save, storage, and the game shell
Lens id: real-data
Files in scope:
- src/sim/save.ts, src/game/storage.ts, src/game/game.ts, src/game/api.ts, src/game/events.ts, src/main.ts
Invariants to attack:
- Everything that decides a future outcome is inside the save file; hashWorld cannot be satisfied by a field the serializer drops.
- v1 to v5 files all load; a corrupt, foreign or truncated file is refused with a plain reason and the running game is untouched.
- The three slots never bleed: a daily or friend link never overwrites My tower, and a slot write that fails surfaces one plain message.
- The loop ticks once per sim minute at every speed, drains correctly after the tab was hidden, and autosave fires once per boundary.
- Boot routing: ?daily, ?seed, ?new and the plain address each land in the right slot; ?smoke never boots in production.
Probe recipes:
- npx vitest run tests/sim/save.test.ts tests/game
Never re-flag:
- Saves live in the browser plus export and import, no server (2026-09-18); the number stays reachable in the address for testing (2026-09-24).

## Lane E1: UI shell, panels, build tools and controls
Lens id: real-data
Files in scope:
- src/ui/ui.ts, panels.ts, status.ts, sheet.ts, build.ts, palette.ts, layout.ts, display.ts, controls.ts, keys.ts, gamepad.ts, haptics.ts, prefs.ts, toast.ts, icons.ts, format.ts
Invariants to attack:
- Every number on screen traces to world state, never a literal.
- Replacing the world (import, new game, daily, friend link) leaves no panel or listener reading the old one.
- A refused command reaches the player as its reason string, verbatim and plain.
- Touch placement: a tap parks an outline and builds nothing; Build applies the command exactly once.
- Settings and prefs survive reload and a storage that throws.
- Player-facing text is plain US English for a reader of about 8 to 10 and never shows a code or "seed".
Probe recipes:
- npx vitest run tests/ui/shell.test.ts tests/ui/panels.test.ts tests/ui/build.test.ts tests/ui/placement.test.ts tests/ui/settings.test.ts tests/ui/status.test.ts tests/ui/sheet.test.ts tests/ui/keys.test.ts tests/ui/gamepad.test.ts tests/ui/prefs.test.ts tests/ui/format.test.ts tests/site/us-english.test.ts
- grep -rn "innerHTML\|insertAdjacentHTML" src/ui/
Never re-flag:
- The Look tool on L (2026-09-24); saving wording (2026-09-24); the UI polish spec as approved (2026-09-24).

## Lane E2: Cards, alerts, onboarding, share and the site
Lens id: real-data
Files in scope:
- src/ui/alerts.ts, vip.ts, cards.ts, onboarding.ts, daily.ts, demo.ts, explain.ts, hover.ts, minimap.ts, overlays.ts
- src/share/share.ts, src/site/*.ts, public/theme.js
Invariants to attack:
- One alert card per fire or bomb; Pay ransom only while the threat stands; a dismissed card never returns for the same event.
- The VIP card reflects the real visit.
- A share link round-trips floors, people and stars, and a foreign or malformed link starts a sane tower, never a crash.
- Onboarding never blocks a returning player and never fires twice.
- Theme storage that throws falls back to system.
Probe recipes:
- npx vitest run tests/ui/alerts.test.ts tests/ui/vip.test.ts tests/ui/onboarding.test.ts tests/ui/first-run.test.ts tests/ui/daily.test.ts tests/ui/hover.test.ts tests/ui/minimap.test.ts tests/ui/overlays.test.ts tests/share tests/site
Never re-flag:
- Sharing is client side only (2026-09-19); store links empty until a listing exists; Steam off public surfaces (2026-09-24).

## Lane F1: Renderer core
Lens id: production-readiness
Files in scope:
- src/render/renderer.ts, camera.ts, input.ts, interpolate.ts, grid.ts, palette.ts, light.ts, anim.ts, ambient.ts, buildfx.ts, overlays.ts, thumbnail.ts, hierarchy.ts, smoke.ts
Invariants to attack:
- The renderer never mutates the world and never draws from world.rng.
- The static tower is reconciled only when structureVersion or the lit state moves, and a demolished room leaves no sprite behind.
- Picking returns the thing the player sees on top.
- Reduced motion removes inertia, particles and interpolation.
- The demo world never reaches a production bundle.
Probe recipes:
- npx vitest run tests/render/reconcile.test.ts tests/render/camera.test.ts tests/render/input.test.ts tests/render/structure-version.test.ts tests/render/overlays.test.ts tests/render/overlays-color-blind.test.ts
Never re-flag:
- Rendering has no unit tests by design (docs/DESIGN.md 11); one sim in four drawn (2026-09-20); bright flat art (2026-09-19).

## Lane F2: Art, interiors, and the illustrated look
Lens id: production-readiness
Files in scope:
- src/render/art.ts, interiors.ts, illustrated.ts
Invariants to attack:
- A failure inside the art module degrades to flat rectangles, never a blank page.
- Every room kind has an interior for every state it can be in (empty, occupied, dirty, on fire, closed).
- Textures are baked once per DPR and never leak per frame.
Probe recipes:
- npx vitest run tests/render/interiors.test.ts tests/render/art-classes.test.ts tests/render/sim-art.test.ts tests/render/variety.test.ts
Never re-flag:
- Art direction is docs/VISUAL.md; taste is not a finding.

## Lane F3: People, venues, curb, sky and weather rendering
Lens id: production-readiness
Files in scope:
- src/render/figure.ts, person.ts, venue.ts, curb.ts, sky.ts, weather.ts, weatherfx.ts
Invariants to attack:
- What is drawn outside matches the weather snapshot: umbrellas only in rain, wet street only after rain, lightning only in a storm.
- Sky and cloud easing never read world.rng or Date.
- Figures drawn during a fire are not walking into the entrance.
Probe recipes:
- npx vitest run tests/render/weather.test.ts tests/render/rain.test.ts tests/render/sky.test.ts tests/render/curb.test.ts tests/render/venue.test.ts tests/render/crowd.test.ts tests/render/portrait.test.ts
Never re-flag:
- Art direction is docs/VISUAL.md.

## Lane G: Audio and Steam
Lens id: production-readiness
Files in scope:
- src/audio/*.ts, src/steam/steam.ts, src-tauri/src/*.rs
Invariants to attack:
- No AudioContext exists until the player turns sound on; turning it off releases everything.
- The score never reads world.rng and never changes the hash; a save and reload picks up the same chapter.
- Mood axes stay in range at every boundary; a cue during a chapter change never throws.
- Steam reporting is inert outside Tauri and never blocks the game.
Probe recipes:
- npx vitest run tests/audio tests/game/steam.test.ts
Never re-flag:
- The score design (2026-09-23, 2026-09-24); the star rating never lowers quality (2026-09-24).

## Lane H: Hosting, deploy, build, shells and pages
Lens id: security-auth
Files in scope:
- public/_headers, deploy/*, wrangler.jsonc, vite.config.ts, package.json, tsconfig.json, .nvmrc, capacitor.config.ts, src-tauri/tauri.conf.json, src-tauri/capabilities/default.json, src-tauri/Cargo.toml
- index.html, play/index.html, how-to-play/index.html, privacy/index.html, 404.html, public/robots.txt, public/sitemap.xml, public/theme.js
- scripts/*.mjs, scripts/bench/*.ts
Invariants to attack:
- Every resource the running page loads is permitted by the policy and nothing more; both hosting paths carry the same policy.
- The service worker scope, precache and revalidation are right for /play/ only.
- Every runbook step can be carried out against the repo as it stands; rollback is reversible.
- Direct dependencies are pinned exactly, lockfiles committed; hosts named by ssh alias, never address or root.
- No public page names hosting, deploy targets or internal hosts.
Probe recipes:
- diff the CSP in public/_headers and deploy/nginx.conf; npm audit; grep -E '"[\^~]' package.json
- npx vitest run tests/site/app-build.test.ts tests/site/versions.test.ts tests/store
Never re-flag:
- Deploy hostname carried as one variable (2026-09-18); the README says nothing about hosting (gotcha 2026-09-20); the beacon (declined).

## Lane I: Tests as guards
Lens id: testing
Files in scope:
- tests/sim/*.test.ts, tests/scenarios/*, tests/game/*.test.ts, tests/harness.test.ts, tests/rng.test.ts
Invariants to attack:
- A test that guards money, the save file, the star ladder, support rules, the fire rule, or determinism goes red when that logic is broken.
- Every failure behavior in PROJECT.md's Verification expectations table has a test or a named gap.
- No scenario asserts a number it computed from the same code path it is checking.
Probe recipes:
- copy src/ to a scratch overlay, break one rule, run the guarding test file against the overlay, confirm red
Never re-flag:
- Rendering has no unit tests by design (docs/DESIGN.md 11).

## Not in scope
- node_modules/ - vendored; covered by npm audit.
- dist/, dist-app/ - build output; audited as an artifact in lane H.
- ios/, android/ - generated Capacitor shells; signing is not in the repo; only capacitor.config.ts is read (lane H).
- src-tauri/icons, public/icons, public/fonts, public/og.png, wordmarks - generated assets; their scripts are read in lane H.
- docs/, README.md, LICENSE, HANDOFF.md, SHIPPED.md, store/*.md - read as the contract, not reviewed for defects.
- src/ui/ui.css, src/site/site.css, src/fonts.css - style; a real browser pass judges them, not a reader.
- audio-preview/index.html - dev listening page, not shipped.
- tests/ui, tests/render, tests/audio, tests/site, tests/share, tests/store - read by their lane's reviewer for what they prove, not as a lane of their own.

## Lane-independent rules
- A suspicion becomes a finding only after it has been reproduced: a failing test, a probe transcript, or a traced code path with the exact values. "Looks wrong" is not a finding, and "looks fine" refutes nothing.
- Reviewers read, probe and report. They never edit the repository. Verification that needs a mutation happens in a throwaway copy outside the tree.
- A settled decision from DECISIONS.md is never re-flagged as a finding. If it looks wrong it goes to the owner as a question, separately.
- Anything that needs a real browser, a live domain, or hardware is a coverage gap with the exact command that would close it, never a silent omission.
- At most five reviewers run at once (Matt, 2026-09-24); no reviewer runs the full test suite.
