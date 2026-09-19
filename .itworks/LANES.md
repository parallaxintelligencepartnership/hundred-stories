# Review lanes: Hundred Stories

A lane is one reviewer's full read: a slice of the tree small enough to read end to end in one
pass, cut along the boundaries that matter here (stored records, game time, cash, the save file,
what the browser is allowed to load) rather than along the directory tree. Lanes are re-derived
whenever MAP.md's Layout table moves; a lane whose listed files no longer exist is stale.

## Lane A: Simulation core
Lens id: real-data
Files in scope:
- src/sim/types.ts (entity shapes, clockOf, the derived calendar)
- src/sim/rules.ts (every number: costs, thresholds, schedules)
- src/sim/rng.ts (mulberry32, the only entropy source)
- src/sim/world.ts (createWorld, id allocation, floor index, log)
- src/sim/build.ts (applyCommand validation, cash, placement, refusal strings)
- src/sim/economy.ts (quarter income, upkeep, condo sale, bankruptcy)
- src/sim/evaluation.ts (room eval, noise, the leave decision)
- src/sim/stars.ts (population count, star ladder)
- src/sim/tick.ts (the fixed tick order)
Invariants to attack:
- The same seed plus the same command list always yields the same world hash.
- Nothing in src/sim reads Date, Math.random, the DOM, or pixi.js.
- Cash is charged exactly once per accepted command and never for a refused one.
- A refused command leaves the world byte for byte unchanged.
- A star can only rise one rank at a time and only when population and every extra condition hold.
- Every number the logic uses comes from rules.ts.
Probe recipes:
- npx vitest run tests/sim
- grep -rn "Date\.\|Math\.random\|window\.\|document\." src/sim/
- build the same tower twice from one seed and compare hashWorld
Never re-flag:
- Extending an elevator shaft is free; the shaft price covers any span within its limit (2026-09-18).
- The v1 room set is exactly the original 1994 set, no additions (2026-09-18).

## Lane B: Agents and transport
Lens id: real-data
Files in scope:
- src/sim/people.ts (intake, schedules, walking, stress, leaving, housekeeping)
- src/sim/elevators.ts (SCAN dispatch, door cycle, boarding, hall calls)
- src/sim/routing.ts (floor graph, findRoute, entrances)
- src/sim/events.ts (fire, bomb, VIP, cockroaches, Santa, wedding)
Invariants to attack:
- A sim is counted in exactly one place: a room's occupancy, a car's passenger list, or neither.
- Room occupancy returns to zero when the last occupant leaves, and never goes negative.
- Every rng draw happens in an order that does not depend on Map insertion order.
- A destroyed or demolished room leaves no sim pointing at it.
- A car never carries more than its rule capacity and never serves a floor it does not stop at.
- An event that starts always has a path to ending.
Probe recipes:
- npx vitest run tests/sim/people.test.ts tests/sim/elevators.test.ts tests/sim/routing.test.ts tests/sim/events.test.ts
- npx vitest run tests/scenarios
Never re-flag:
- The v1 room set is exactly the original 1994 set (2026-09-18).

## Lane C: Save, load and the browser slot
Lens id: real-data
Files in scope:
- src/sim/save.ts (serialize, deep validation, deserialize, hashWorld)
- src/game/storage.ts (IndexedDB first, localStorage fallback)
Invariants to attack:
- Everything that decides a future game outcome is inside the save file.
- A corrupt, foreign or truncated file is refused with a reason and the running game is untouched.
- serialize then deserialize reproduces the same hash, and the reloaded world keeps ticking identically.
- hashWorld cannot be satisfied by a field the serializer drops.
- A blocked or full browser store surfaces one plain message, never an unhandled throw.
Probe recipes:
- npx vitest run tests/sim/save.test.ts tests/game/storage.test.ts
- serialize a live world, deserialize it, tick both on and compare hashWorld
Never re-flag:
- No accounts and no server saves; saves live in the browser plus JSON export and import (2026-09-18).

## Lane D: Game shell and UI
Lens id: real-data
Files in scope:
- src/main.ts (boot, seed, offline first-load message, WebGL failure message)
- src/game/game.ts (world ownership, tick loop, tools, pointer input, autosave)
- src/game/api.ts (the contract the UI may use)
- src/ui/ui.ts (shell, readouts, palette, toasts, keyboard)
- src/ui/panels.ts (query, finances, log, settings, export and import)
- src/ui/format.ts (display formatting)
- src/ui/ui.css
Invariants to attack:
- Every number on screen traces to world state, never to a literal in the markup.
- Replacing the world by import or new game leaves no panel reading the old one.
- A refused command reaches the player as its reason string, verbatim.
- Autosave fires once per boundary crossed, never twice at once.
Probe recipes:
- npx vitest run tests/game tests/ui
- grep -rn "innerHTML\|insertAdjacentHTML\|eval(" src/
Never re-flag:
- No auth and no login wall (2026-09-18).
- US spelling and no dashes in UI copy (docs/DESIGN.md section 10).

## Lane E: Renderer
Lens id: production-readiness
Files in scope:
- src/render/renderer.ts (application, layers, sprite reconciliation, input, picking)
- src/render/camera.ts (world to screen, pan, zoom, inertia, snapping)
- src/render/art.ts (procedural textures)
- src/render/sky.ts (sky keyframes, horizon, ground)
- src/render/smoke.ts (hand built demo world; dev only)
Invariants to attack:
- The renderer never mutates the world and never draws from world.rng.
- Reduced motion removes inertia, particles and interpolation.
- A failure inside the art module degrades to flat rectangles instead of a blank page.
- The demo world never reaches a production bundle.
Probe recipes:
- npx vitest run tests/render
- npm run build && grep -rl "bootSmoke\|buildDemoWorld" dist/
Never re-flag:
- Rendering has no unit tests; verification is a real browser pass (docs/DESIGN.md section 11).
- Bright flat world art like the original, not the dusk palette of the first build (2026-09-19).

## Lane F: Hosting headers
Lens id: security-auth
Files in scope:
- public/_headers (Cloudflare Pages headers, primary hosting)
- deploy/nginx.conf (pi3 fallback headers and caching)
- deploy/compose.yml (Traefik labels, TLS, network)
- index.html (the only page shell)
Invariants to attack:
- Every resource the running page actually loads is permitted by the policy, and nothing more is.
- The two hosting paths carry the same policy, so a fallback deploy does not quietly loosen it.
- The service worker, its registration script and the manifest always revalidate.
Probe recipes:
- diff the CSP strings in public/_headers and deploy/nginx.conf
- grep the built bundle for every cross origin URL and check it against the policy
- curl -sI https://<live host>/ once a domain exists
Never re-flag:
- No backend, no ports of its own, static files only (2026-09-18).

## Lane G: Deploy path, build and PWA
Lens id: production-readiness
Files in scope:
- deploy/deploy.sh (build, snapshot, rsync, compose up, verify)
- deploy/README.md (pi3 runbook and rollback)
- deploy/cloudflare-pages.md (primary hosting runbook)
- deploy/.env.example
- vite.config.ts (build, vitest include, PWA manifest and workbox)
- scripts/make-icons.mjs
- package.json, package-lock.json, .nvmrc
Invariants to attack:
- Every step in the runbook can actually be carried out against this repository as it stands.
- Rollback restores the previous release and is reversible.
- Direct dependencies are pinned exactly and the lockfile is committed.
- Everything the installed app needs offline is in the precache list.
- Remote hosts are named by their ssh alias, never by address, and never as root.
Probe recipes:
- npm audit; grep -E '"[\^~]' package.json; git ls-files | grep package-lock
- npm run build; read dist/sw.js precache list against what the page loads
- grep -rnE "ssh |rsync |root@|[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+" deploy/
Never re-flag:
- Deploy hostname is hundredstories.xyz, carried as one variable (2026-09-18).
- pi1, pi2 and pi3 are x86_64 servers, not Raspberry Pis (MAP.md gotcha 2026-09-18).

## Lane H: Tests
Lens id: testing
Files in scope:
- tests/sim/*.test.ts, tests/scenarios/*.test.ts, tests/scenarios/helpers.ts
- tests/game/*.test.ts, tests/ui/*.test.ts, tests/render/*.test.ts, tests/rng.test.ts
- tests/harness.test.ts
Invariants to attack:
- A test that guards money, the save file or the star ladder goes red when that logic is broken.
- Every failure behavior in PROJECT.md's Verification expectations table has a test or a named gap.
- No scenario asserts a number it computed from the same code path it is checking.
Probe recipes:
- npx vitest run
- copy the tree to a scratch overlay, break one rule, confirm red, restore, confirm green
Never re-flag:
- Rendering has no unit tests by design (docs/DESIGN.md section 11).

## Not in scope
- node_modules/ - vendored third party; covered by npm audit and dependency vetting, not read.
- dist/ - build output, gitignored; audited as an artifact in lanes F and G, not reviewed as source.
- docs/ (BRIEF-AGENTS.md, DESIGN.md, VISUAL.md) - read as the contract the lanes are judged against,
  not reviewed for defects of their own.
- LICENSE, .gitignore, README.md - read for claims to check, no logic.
- public/icons/*.png - generated by scripts/make-icons.mjs, reviewed there.

## Lane-independent rules
- A suspicion becomes a finding only after it has been reproduced: a failing test, a probe
  transcript, or a traced code path with the exact values. "Looks wrong" is not a finding, and
  "looks fine" refutes nothing.
- Reviewers read, probe and report. They never edit the repository. Verification that needs a
  mutation happens in a throwaway copy outside the tree.
- A settled decision from DECISIONS.md is never re-flagged as a finding. If it looks wrong it
  goes to the owner as a question, separately.
- Anything that needs a real browser, a live domain, or hardware is a coverage gap with the exact
  command that would close it, never a silent omission.
