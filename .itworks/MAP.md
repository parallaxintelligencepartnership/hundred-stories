# Map

## Run
npm run dev (vite; landing on http://localhost:5173, the game on http://localhost:5173/play/); npm run build (tsc --noEmit && vite build) then npm run preview for the static bundle; no env vars needed

## Test
npm test (vitest run); one file: npx vitest run <path>; npm run typecheck (tsc --noEmit)

## Layout
| Path | What lives there |
|---|---|
| index.html | landing page at /: semantic markup, no framework, one module script (src/site/hero.ts) |
| how-to-play/index.html | the guide at /how-to-play/: rooms, elevators, stress, the quarter, stars, saving, controls |
| play/index.html | the game shell at /play/; the only script tag loads src/main.ts |
| src/site/ | landing site: site.css (same tokens as ui.css) and hero.ts, the demo tower drawn by the game's renderer |
| src/main.ts | entry point: reads the seed from the query string, boots game, renderer and UI, shows the WebGL message on failure; ?smoke boots the demo world instead |
| src/sim/ | the pure simulation, no DOM: rules.ts tables, types.ts and the clock, tick.ts tick order, build, economy, elevators, evaluation, events, people, routing, stars, rng |
| src/sim/save.ts | save format v1: serialize, deserialize with its refusal reasons, and the FNV-1a world hash |
| src/game/game.ts | game shell: owns the world, the timer loop, tools, pointer input, save/load/export/import wiring |
| src/game/api.ts | the contract the UI is allowed to use |
| src/game/storage.ts | the browser save slot: IndexedDB first, localStorage as the fallback |
| src/render/ | PixiJS scene: renderer.ts, camera.ts, art.ts procedural sprites, sky.ts, smoke.ts hand built demo world |
| src/ui/ | DOM overlay: ui.ts shell, input and notices, panels.ts HUD panels including save, export and import, format.ts, ui.css |
| public/icons/, scripts/make-icons.mjs | PWA icons and the script that draws them |
| public/og.png, scripts/make-og.mjs | the 1200x630 link preview card and the dependency free script that draws it |
| public/robots.txt, public/sitemap.xml | crawler files for the three pages |
| vite.config.ts | Vite build (three page inputs), the vitest include glob, and the vite-plugin-pwa manifest and service worker, scoped to /play/ |
| tests/ | vitest suite: sim/ unit tests, scenarios/ scripted tower runs plus helpers.ts, render/, ui/, site/, harness.test.ts |
| deploy/ | pi3 static stack: compose.yml, nginx.conf, deploy.sh with rollback, README runbook, .env.example |
| docs/ | BRIEF-AGENTS.md implementer brief, DESIGN.md rules and tick order, VISUAL.md art direction |
| dist/ | build output, gitignored; rebuilt by npm run build |

## Environment
- Dev machine: Matt's Mac, arm64 macOS 27, Node 26, npm 11
- Hosting target pi3: x86_64 Ubuntu 24.04 (not a Raspberry Pi), standalone docker compose, Traefik with letsencrypt, public sites are nginx static containers
- No backend, no database, no secrets

## Gotchas
- 2026-09-18 | pi1/pi2/pi3 are x86_64 servers named for Parallax Intelligence, not Raspberry Pis | run uname -m before any architecture decision
- 2026-09-19 | the entry point serves a fake demo tower at any URL carrying ?smoke, and that code is in the production bundle | never share a ?smoke link as the game, and strip or dev-gate the import before ship
- 2026-09-19 | the closeout published to itworks.build on the strength of a kickoff wish, with 3 IMPORTANT and 1 ADVISORY still open; Matt had not approved it | never publish to the wall without an explicit per-publish yes from Matt and an empty findings list
