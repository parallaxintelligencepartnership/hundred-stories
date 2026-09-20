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
| src/site/ | landing site: site.css (same tokens as ui.css), hero.ts (the demo tower drawn by the game renderer, imports challenge.ts), challenge.ts (the friend greeting from a shared link), theme.ts and theme-init.ts (the system, light or dark choice under localStorage hs.theme) |
| src/share/share.ts | share feature, pure: stats from the world, message, link with floors, people and stars in the query, parseChallenge, and the PNG composer |
| public/theme.js | plain script every page loads first: applies a stored theme before paint (inline scripts are blocked by the CSP) |
| src/main.ts | entry point: reads the seed from the query string, boots game, renderer and UI, shows the WebGL message on failure; ?smoke boots the demo world instead |
| src/sim/ | the pure simulation, no DOM: rules.ts tables, types.ts and the clock, tick.ts tick order, build, economy, elevators, evaluation, events, people, routing, stars, rng |
| src/sim/save.ts | save format v2 (v1 still loads with default car settings): serialize, deserialize with its refusal reasons, and the FNV-1a world hash |
| src/game/game.ts | game shell: owns the world, the timer loop, tools, pointer input, save/load/export/import wiring |
| src/game/api.ts | the contract the UI is allowed to use |
| src/game/storage.ts | the browser save slot: IndexedDB first, localStorage as the fallback |
| src/render/ | PixiJS scene: renderer.ts (rooms, shafts, then a connector layer on top), camera.ts, input.ts press, tap, wheel and pinch classification, art.ts procedural sprites, sky.ts, smoke.ts hand built demo world (also drives the landing hero) |
| src/ui/ | DOM overlay: ui.ts shell, input and notices, panels.ts HUD panels including save, export and import, format.ts, ui.css |
| public/icons/, scripts/make-icons.mjs | PWA icons and the script that draws them |
| public/og.png, scripts/make-og.mjs | the 1200x630 link preview card and the dependency free script that draws it |
| public/robots.txt, public/sitemap.xml | crawler files for the three pages |
| vite.config.ts | Vite build (three page inputs), the vitest include glob, and the vite-plugin-pwa manifest and service worker, scoped to /play/ |
| 404.html | the custom 404 page, built as a Vite input; served by Workers static assets via not_found_handling in wrangler.jsonc |
| wrangler.jsonc | Cloudflare Workers static-assets config: dist as the asset directory, the 404 page, custom domain routes for hundredstories.xyz and www, workers_dev and preview_urls disabled |
| tests/ | vitest suite: sim/ unit tests, scenarios/ scripted tower runs plus helpers.ts, render/, ui/, site/, harness.test.ts |
| deploy/ | pi3 static stack: compose.yml, nginx.conf, deploy.sh with rollback, README runbook, .env.example |
| docs/ | BRIEF-AGENTS.md implementer brief, DESIGN.md rules and tick order, VISUAL.md art direction |
| dist/ | build output, gitignored; rebuilt by npm run build |

## Environment
- Dev machine: Matt's Mac, arm64 macOS 27, Node 26, npm 11
- Primary hosting: Cloudflare Workers static assets (successor to Pages; no Worker code, asset requests free and unlimited), custom domains hundredstories.xyz and www attached via wrangler.jsonc routes, workers_dev and preview_urls disabled
- Fallback hosting target pi3: x86_64 Ubuntu 24.04 (not a Raspberry Pi), standalone docker compose, Traefik with letsencrypt, public sites are nginx static containers
- No backend, no database, no secrets

## Gotchas
- 2026-09-18 | pi1/pi2/pi3 are x86_64 servers named for Parallax Intelligence, not Raspberry Pis | run uname -m before any architecture decision
- 2026-09-19 | the entry point serves a fake demo tower at ?smoke in dev only (gated on import.meta.env.DEV); the same demo world is deliberately in the landing bundle as the hero | never share a ?smoke link as the game, never remove the DEV gate in src/main.ts
- 2026-09-19 | headless Chrome with --disable-gpu still renders WebGL through the software path | to test the no-WebGL message use --disable-3d-apis
- 2026-09-19 | the closeout published to itworks.build on the strength of a kickoff wish, with 3 IMPORTANT and 1 ADVISORY still open; Matt had not approved it | never publish to the wall without an explicit per-publish yes from Matt and an empty findings list
- 2026-09-19 | vite preview and the dev server do not send public/_headers, so the Content Security Policy is only enforced live or in the nginx container; the first live deploy blocked PixiJS (needs pixi.js/unsafe-eval under a no-eval CSP) and the game showed the WebGL message | before any deploy, load /play/ from the nginx container in headless Chrome and grep the console for Refused or unsafe-eval
- 2026-09-19 | headless Chrome on macOS clamps --window-size widths below about 500 CSS px and serves disk-cached pages between runs | for phone-width shots emulate the viewport over CDP (Emulation.setDeviceMetricsOverride) and cache-bust the URL
- 2026-09-19 | localhost:4173 is shared with other projects in Matt's Chrome: a stale service worker (scope /) and precache from an earlier build served an old bundle at /play/ and even at /, and the Claude in Chrome extension captures the WebGL canvas as a flat dark block (the landing hero showed as navy with no tower, the game sky as slate at 11 AM) while CDP screenshots from a fresh headless profile at device scale 1 and 2 show the correct light blue | never judge the world colours from an extension screenshot; before probing in Matt.s Chrome unregister every service worker and delete every cache on the origin, and for colours use a fresh headless profile over CDP (scratchpad visual.mjs pattern)| before probing the game in Matt's Chrome, unregister every service worker and delete every cache on the origin, or use a fresh headless profile over CDP (scratchpad visual.mjs pattern)
- 2026-09-19 | since 2bd3c91 the renderer refuses to boot without a GPU context, so plain headless Chrome shows the WebGL message and the game never mounts | for game probes launch Chrome with --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist
- 2026-09-19 | a Claude in Chrome tab reports document.hidden true, so requestAnimationFrame never fires and a freshly mounted game panel stays in its is-entering slide-out state; extension screenshots of the panel also clip rows the DOM shows fitting | when probing panels through the extension, strip is-entering with JS and judge layout by getBoundingClientRect, or use headless CDP
