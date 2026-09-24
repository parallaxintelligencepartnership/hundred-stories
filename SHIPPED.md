# Hundred Stories - shipped 2026-09-19

## What this is
Hundred Stories is a browser game and installable PWA (paid store editions planned, the web build is the full game): a tower-building sim with pixel art drawn in code, a from-scratch homage to SimTower. The code and art are original and the game design is not; there is a deterministic sim core underneath. You run a skyscraper: build a lobby, offices, homes, shops and elevators, watch it fill with people over the years, and climb the star ladder from one star to TOWER. There is no backend and no account: the whole game runs in the browser, and saves live in the player's own browser storage plus files they export themselves. The site at https://hundredstories.xyz is a static landing page with search and share metadata; the game lives at `/play/`. One code base builds three editions from `VITE_EDITION`: `web` (the site, uncapped, what hundredstories.xyz serves), `demo` (floors 1 to 20, basements to 2, the middle 150 tiles, with a card pointing at the stores) and `full` (the store game). The same game page is wrapped for the stores: Capacitor shells for iOS and Android and a Tauri desktop shell for Steam with star achievements behind the `steam` cargo feature; they are built to submission ready (store/SUBMISSION.md) and nothing is submitted. Since the look and UX rounds the game has 16 px tiles, an hour-tinted light layer, animation and synthesized sound (off by default), a first-run intro and guide, goals, information views, hover cards, keyboard groups and a minimap. Source is public to read under PolyForm Strict 1.0.0 (personal, noncommercial use, no redistribution or derived products; releases tagged before 2026-09-20 remain AGPL-3.0) at https://github.com/parallaxintelligencepartnership/hundred-stories.

## How to run it
Requirements: Node 26 (pinned in `.nvmrc`). No environment variables.

```bash
npm ci
npm run dev       # landing on http://localhost:5173/, game on http://localhost:5173/play/
npm test          # vitest run: 1274 tests in 100 files (1273 pass, 1 opt-in store screenshot run skipped)
npm run audio:samples && node scripts/analyze-audio-samples.mjs docs/reviews/audio-samples-2026-09-23/*.wav  # the score gate, every line PASS or SKIP
npm run build     # tsc --noEmit then vite build, output in dist/ (landing, how-to-play, play, 404)
npm run preview   # serve the production build on http://localhost:4173 (does NOT send public/_headers)
npm run build:demo # the demo edition (size cap on) into dist/; build:full is the uncapped store edition
npm run build:app  # the game page alone into dist-app/ for the Capacitor and Tauri shells (cap:sync, npx tauri build)
```

`?seed=<number>` on the game URL sets the starting seed; `?new` skips the autosave. To test the security headers locally, run the nginx container from `deploy/cloudflare-pages.md` (Verification section); the Vite servers do not enforce them.

## How to deploy an update
Hosting is Cloudflare Workers static assets (the successor to Pages): no Worker code, asset requests are free and unlimited, headers from `public/_headers`, custom domains declared in `wrangler.jsonc`. Runbook: `deploy/cloudflare-pages.md`.

```bash
npm run deploy    # npm run build && npx wrangler deploy (wrangler 4.135.0, pinned)
```

Before deploying, load `/play/` from the nginx container in headless Chrome and check the console for `Refused` or `unsafe-eval`; that is the check that would have caught the first live defect. Verify after: `curl -sI https://hundredstories.xyz/` shows the five headers, `/nope` is 404, `http://` redirects to https.

Fallback, pi3 (`deploy/README.md`): copy `deploy/.env.example` to `deploy/.env`, set `SITE_HOST`, run `deploy/deploy.sh`.

## How to roll back
Rehearsed on 2026-09-24 at the 0.4.9 ship: checked out `ship-2026-09-22b` (0.4.7) in a scratch worktree, ran `npm ci`, `npm run build` (green, dist/_headers present) and `npx vitest run` (985 passed, 74 files), then removed the worktree.

- Cloudflare: `npx wrangler rollback` returns the live site to the previous uploaded version; `npx wrangler versions list` shows the versions. Or check out the previous tag and `npm run deploy`.
- pi3: `deploy.sh` snapshots the live tree to `html.prev` before every sync; the swap is in `deploy/README.md` under Rollback.
- Return target for this ship: `git checkout ship-2026-09-24`. Previous good state: `ship-2026-09-22c` (0.4.8, live from 2026-09-22 22:53 until this deploy), three commits after the rehearsed `ship-2026-09-22b`.

## Known limitations and accepted risks
No finding was accepted; the accepted risks list is empty. The findings still open in `.itworks/REVIEWS.md` are listed as OUTSTANDING at the end of this section.

- Touch: one finger moves the view, pinch zooms, a still press places, two fingers pan while sizing a lobby or elevator; the palette is a scrollable bottom sheet on phones. Proven with emulated touch events in Chrome at 390x844, not yet on a physical phone in Safari; that hands-on check is the owner's.
- The PWA install click in the browser's address bar is outside what the browser tools can drive; installability was verified from the page (controlling service worker, manifest with standalone display, maskable icons) and the offline reload was proven live, but the install button itself is the owner's to press.
- The two-line wordmark and the share image are procedural PNG/SVG from `scripts/make-wordmark.mjs` and `scripts/make-og.mjs`; regenerate after any palette change.
- Backups: there is no server-side data. The player's tower lives in their browser (IndexedDB, localStorage fallback) and their own exported JSON files; export and import are test-covered and were driven live in Chrome, and clearing browser data with no export loses the tower.
- Phone framing: the camera now measures the top strip, the palette sheet and the ticker and keeps the street and floor 1 in the free band; proven in headless Chrome at 390x844 and in the unit tests, not yet on a physical phone. The palette collapses on every screen and auto-collapses on a phone after a pick.
- No GPU: with neither WebGL nor WebGPU the game shows "This browser cannot draw the tower. WebGL is required." (proven over CDP at this closeout with both contexts stubbed out); a software WebGL still plays, slowly.
- Touch placement: a tap parks an outline with the name and price and a bar nudges it; proven with emulated touch at 390x844 over CDP, not yet under a thumb on a physical phone.
- Share: the share sheet with the image attached needs a real phone browser; headless Chrome proved the panel, the 1200 px preview, the message and the link. The link preview image is the static og.png; a per-share image would need a server.
- Unreadable save: a save the deserializer refuses (damaged bytes, or a newer format read by an older cached build) is kept under localStorage hs.save.unreadable and the log says so; the lot starts fresh. Recovery of that copy is manual (paste it into Import) and is not surfaced in the UI yet.
- Licence: PolyForm Strict 1.0.0 from this ship. The AGPL copies of the three earlier tags cannot be recalled; GitHub counted 327 clones from 52 sources in the repo's first day against zero page views, so scrapers.
- Theme: the choice is per browser under localStorage hs.theme; a browser that blocks storage falls back to the system setting every load.
- Performance: measured on three towers built to scale (scripts/bench/README.md, morning and evening rows). The evening rush on the 4,920-person tower went from 33 ms to 0.4 ms per tick (route searches keyed by floor and connector for the life of the routing graph, per-floor goal index, binary heap). The sim ticks from the frame loop while the tab is visible and a 50 ms timer keeps it going hidden; people and cars interpolate from a snapshot taken before the last tick, so the 4x stalls and lurches are gone (docs/reviews/2026-09-22-engine-round-results.md). The static tower redraws only when world.structureVersion moves. Six bench hashes unchanged through the round.
- Rent: offices, condos and hotel rooms take a rent setting from 50% to 150%; the office figure in the panel is the amount the next quarter credits at the current evaluation. Save format is 4 since the story round (v1 to v3 load; the story and chronicle start empty on older saves; rent defaults to 100% and the status bar baselines to empty on older saves). The room panel is built and refreshed in tests against a node DOM stand-in (tests/ui/fake-dom.ts, tests/ui/panels.test.ts) that lays nothing out; the rent row's phone-width fit was proven in headless Chrome at 390x844.
- The world log keeps the last 2,000 lines; the ticker, toasts and log panel follow a running count so they keep updating past the cap (fixed this ship).
- The renderer's sim draw loop and particle count are covered by a stub-renderer harness (tests/render/reconcile.test.ts): one visible sim in four is drawn, red when the crowd sample is removed.
- Not verified: the Android shell was never built (no JDK or Android SDK on the build Mac; the command is in store/SUBMISSION.md); the Tauri .app was built but not launched; hidden-tab timer throttling was not measured in a browser (the loop tests cover the hidden timer path only). The iOS shell was built for the simulator (xcodebuild, generic iOS Simulator destination).
- The demo edition is not deployed anywhere; the web build is uncapped, and the store links on the landing page read coming soon until a listing exists.
- Stories, weather, VIP visits, guards, collectors and the chronicle (2026-09-23 packages): every person can tell a true story from recorded beats and never an invented one; weather is derived from the seed and the minute outside the sim and the hash; the VIP walks in, rides, stays and checks out and is rated from the real visit; guards patrol and one shop theft is caught or escapes; two named collectors empty the waste and a backlog turns rooms dirty; each star writes a milestone recap and Tower status writes the chronicle. The failure paths (no suite, no ride, no guard, unreachable room, pre-chronicle save) are covered by the scenario tests, not yet driven in a browser.
- The score is generated in code (six star chapters under a live mood of energy, warmth and tension). Matt's first listen found the vinyl hiss too loud and a 5-star alert-like tone; the hiss is gone, only sparse crackle at -52.8 dBFS remains, the register bell is lower and shorter, and he judged the in-game result "Sounded much better". The six rendered samples under docs/reviews/audio-samples-2026-09-23 are the listening reference and the analyser is the gate.
- OUTSTANDING: no whole-application audit since 2026-09-19 @047d32b; more than five ships and eight packages of new sim logic since, and closeout sweeps never read the logic. Open as IMPORTANT in .itworks/REVIEWS.md until a project-audit section dated after 42351af exists.
- OUTSTANDING: the new features' failure paths were not driven in a real browser (ADVISORY); the game mounts under the live policy in the nginx container with no console errors, checked at this closeout, and the scenarios are test-covered.

## What breaks first and how you'd know
A PixiJS upgrade that changes how it compiles shaders, first. The site's Content Security Policy forbids eval, and the renderer only starts because `src/render/renderer.ts` loads `pixi.js/unsafe-eval` before anything else; if an upgrade moves that requirement, `/play/` shows "The page's security policy blocked the tower renderer" and the browser console logs `unsafe-eval`. The pre-deploy nginx container check catches it before it is live. Second, elevator wait under load: sims leave when their wait passes the black threshold, visible as population and evaluation falling while rooms sit vacant, with event log lines naming the wait. Third, the display fonts come from Google Fonts under the CSP; a host change renders the game in system fonts with a CSP violation in the console.

## Where things live
- Code: `/Users/matthew/parallax-private/Projects/hundred-stories`. `src/sim` pure simulation, `src/render` PixiJS scene and input classification, `src/ui` DOM overlay, `src/game` the shell, `src/site` landing hero, store links and stylesheet, `src/audio` the Web Audio synth and the generative score, `src/steam` the achievement reports, `index.html`, `how-to-play/`, `play/`, `privacy/`, `404.html` the pages, `capacitor.config.ts` with `ios/` and `android/` the phone shells, `src-tauri/` the desktop shell (Rust, Cargo.lock), `store/` listing copy, per-store notes and the submission runbook, `tests/` the vitest suite, `docs/` DESIGN, VISUAL and LANDING-SPEC, `deploy/` runbooks and the pi3 package, `scripts/` icon, wordmark, share-image and store screenshot generators. Full layout in `.itworks/MAP.md`.
- Origin: self-hosted Gitea at `git.parallaxintelligence.xyz/ParallaxIntelligence/hundred-stories`. Public mirror: https://github.com/parallaxintelligencepartnership/hundred-stories.
- Hosting: Cloudflare Workers static assets, project `hundred-stories`, domains hundredstories.xyz and www from `wrangler.jsonc`; the workers.dev copy is switched off. DNS zone on Cloudflare, registrar Spaceship.
- Database: none. No server, no backend, no ports of its own.
- Secrets: none in the tree or in git history (swept at this closeout). Wrangler's own login lives in its config on the deploying Mac.
- Reviews and samples: `docs/reviews/` holds the 2026-09-23 direction review, execution plan, before and after screenshots per package, and the six audio samples with analysis.txt.
- Project state: `.itworks/` holds PROJECT.md, MAP.md, DECISIONS.md, REVIEWS.md and PROFILE.md; REVIEWS.md is the finding record this document is built from.

## Ship history
- 2026-09-19: first ship (closeout; deploy pending domain)
- 2026-09-19: post-ship checkpoint, people rescaled and interiors redrawn
- 2026-09-19: second ship, live at https://hundredstories.xyz: landing site with SEO and Parallax structured data, game at /play/, sprite wordmark, camera controls, AGPL licence, public GitHub mirror, Workers static assets hosting, CSP fix for PixiJS; tag ship-2026-09-19b
- 2026-09-19: post-ship fixes live the same day: stairs and elevators overlay rooms, shafts rise into empty air, https redirect, touch controls for phones and tablets, copy without the 1994 framing
- Published: entry hzyq7fm6mpye | https://github.com/parallaxintelligencepartnership/itworks-site/pull/3 | 2026-09-19
- 2026-09-19: third ship, 0.2.0: landing page and guide rebuilt as the building's cross section, phone camera clears the palette sheet, collapsible palette, honest copy (pixel art drawn in code, from-scratch homage), renderer refuses to boot without a GPU context, icon link on /play/; tag ship-2026-09-19c
- 2026-09-19: fourth ship, 0.2.1: two-step touch placement with a nudge bar, shaft extension by drag and panel, see-through shafts, stairs stack in a column, elevator ride cost 5 so people ride, share with screenshot and challenge link, theme toggle, the name section; tag ship-2026-09-19d
- Published: entry twaatuch26bb | https://github.com/parallaxintelligencepartnership/itworks-site/pull/4 | 2026-09-19 (supersedes hzyq7fm6mpye, whose summary said hand-drawn)
- 2026-09-20: fifth ship, 0.2.2: site footer, per-car elevator floor range and rider setting with leftover pickup (save format 2, v1 loads), Requests link to GitHub issues replaces Source in the nav, the name blurb in the README and guide, relicensed AGPL-3.0 to PolyForm Strict 1.0.0, unreadable saves kept and reported; tag ship-2026-09-20
- 2026-09-20: sixth ship, 0.2.3: rush-hour freeze fixed (route search cache, tick loop time box, autosave off the step, renderer housekeeping), log ticker past 2,000 lines, per-room rent 50% to 150%; tag ship-2026-09-20b
- 2026-09-20: 0.2.4, tag ship-2026-09-20c; one sim in four drawn, modern stairs, rent row holds on phones, route cache invariant and test, tap picker test
- 2026-09-22: 0.3.0, tag ship-2026-09-22; engine round: frame-driven ticks with pre-tick snapshot interpolation (the 4x stalls and lurches), evening rush routing (33 ms to 0.4 ms per tick on the large tower), static tower reconcile on a structure version, one HUD refresh per notify and cached chip measurements, sky gradient leak; sweep found five, five fixed; 672 tests
- 2026-09-22: 0.4.7, tag ship-2026-09-22b; look round (16 px tiles and 72 px floors, hour-tinted light layer and window states, low horizon, sliding doors, walk cycle and outfits, every room re-authored, palette tiles with thumbnails, status bar with deltas and a clock dial, synthesised sound off by default), UX round (intro, guided first tower, tips, goals card, information views, hover cards, refusal explainers, keyboard groups and speed keys, minimap), store round (edition flag and demo cap off on the web, Capacitor iOS and Android shells, Tauri desktop shell with Steam achievements behind a feature, native export and import, listings and a submission runbook), fonts bundled, privacy page; sweep found eleven, eleven fixed; 985 tests
- 2026-09-22: 0.4.8, tag ship-2026-09-22c; hotfix, a click picks stairs and escalators first, then shafts, then rooms; deployed 22:53 the same night, recorded here on 2026-09-24
- 2026-09-24: 0.4.9, tag ship-2026-09-24; the story round (packages 0 to 8: true stories per person, weather outside, the VIP journey, guards and one theft, collectors and waste, the generative lofi score, the illustrated look for every room kind, milestone recaps and the tower chronicle, save format 4), the fire alert fix, the audio fix after Matt's listen (hiss out, register bell lower), share capture failure test, serde pinned
