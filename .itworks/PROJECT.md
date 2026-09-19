# Project: Hundred Stories

## What it is
A downtown skyscraper of sorts, simulated internally: the comings and goings of running and operating a tower. Precisely: a browser and PWA recreation of the 1994 SimTower ruleset (rooms, elevators, tenant stress, quarterly economy, star ladder to TOWER) with original art and a deterministic seeded simulation core.

## Who uses it
the user plus anyone with the link (public) - auth needed: no; roles needed: no

## Terminology map
| Your words | Real term |
|---|---|
| "the comings and goings" | agent simulation: each person is a sim with a schedule, a route through elevators, and a stress value |
| "running and operating a tower" | the economy loop: build cost, quarterly rent and upkeep, evaluation, star rating |
| "save your content" | save game: serialized sim state in browser storage plus JSON export/import |
| "downloadable to play offline" | Progressive Web App: installable, service worker caches the build |
| "leaderboards" | deferred: anonymous signed score post, no accounts (not in v1) |

## Stack
TypeScript 5, Vite 7 build, strict mode, no framework
Simulation: pure TypeScript module, fixed tick, seeded PRNG, no DOM access, fully unit tested
Rendering: PixiJS 8 (WebGL) for the tower view; DOM overlay for HUD and build palette
Tests: Vitest for the sim core and save format
PWA: web manifest plus service worker (vite-plugin-pwa)
Hosting target: static files on Cloudflare Pages (primary); pi3 (x86_64 Ubuntu 24.04) behind Traefik as the fallback; domain hundredstories.xyz, not bought yet

## Data
Real data: none server side | Sample data: scripted tower builds under tests/scenarios (helpers.ts plus the scripted runs) used by the headless simulation tests | Sensitive: no; save games live only in the player's browser (IndexedDB) and in files they export themselves

## Where it will live
internet - exposure notes: static site on Cloudflare Pages with the security headers from public/_headers (pi3 behind Traefik is the fallback, same headers via deploy/nginx.conf); no backend, no ports of its own; also installable offline as a PWA; not live yet, the domain hundredstories.xyz is not bought - paid services: none (no LLM calls, no payments, no maps)

## Definition of done
1. Playable from a bare lot with a single ground-floor lobby, exactly like the original opening, to TOWER status.
2. Full room set: lobby, sky lobby, stairs, escalator, office, condo, hotel single/twin/suite, fast food, restaurant, shop, cinema, party hall, medical, security, housekeeping, parking, recycling, metro, cathedral.
3. Standard, express and service elevators with per-shaft car scheduling and visible queues.
4. Tenant stress (pink, red, black) driven by wait time and noise, with tenants leaving and giving a reason.
5. Clock: quarters of two weekdays and a weekend day, rent and upkeep at quarter start, star ladder 1 to 5 and TOWER with the original thresholds.
6. Events: VIP visit, bomb threat, fire, cockroaches, year-end Santa.
7. Save and load in browser storage, export and import as a file, works offline as an installed PWA.
8. Showcase visual quality: original art, depth and lighting, day cycle, reduced-motion honored, US spelling and no dashes in UI copy.
9. Vitest suite green, npm audit clean, deployed on pi3 and verified in a real browser.

## Verification expectations
| Feature | Success proof | Failure behavior |
|---|---|---|
| Simulation core | seeded headless run of a scripted build for N days asserts population, cash and stars; same seed gives identical state hash | an impossible action (overlap, no lobby, unaffordable) is rejected with a reason string and state is unchanged |
| Elevators | unit test: a shaft with 8 cars serves a queue; average wait under threshold; express skips non-lobby floors | a sim waiting past the black threshold leaves the tower and the event log says why |
| Economy and stars | test: rent lands on quarter start; star thresholds and extra conditions (VIP, suites, metro, cathedral, wedding) each covered | bankrupt tower shows a clear game-over state, not a frozen screen |
| Save and load | round trip test: state to JSON to state produces equal hash; export file re-imports | corrupt or foreign file is refused with a message and the current game is untouched |
| PWA offline | build served, installed, network cut, game still loads and plays | with no cache yet, the page says it needs one online load first |
| Rendering | real browser check via claude-in-chrome: tower, sims, HUD legible at 1x and 2x, reduced-motion mode verified | WebGL unavailable shows a plain message, no blank page |
