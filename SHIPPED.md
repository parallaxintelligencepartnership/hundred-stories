# Hundred Stories - shipped 2026-09-19

## What this is
Hundred Stories is a browser game and installable PWA: a tower-building simulation with hand-drawn pixel art and a deterministic sim core. You run a skyscraper: build a lobby, offices, homes, shops and elevators, watch it fill with people over the years, and climb the star ladder from one star to TOWER. There is no backend and no account: the whole game runs in the browser, and saves live in the player's own browser storage plus files they export themselves. The site at https://hundredstories.xyz is a static landing page with search and share metadata; the game lives at `/play/`. Source is public under AGPL-3.0-only at https://github.com/parallaxintelligencepartnership/hundred-stories.

## How to run it
Requirements: Node 26 (pinned in `.nvmrc`). No environment variables.

```bash
npm ci
npm run dev       # landing on http://localhost:5173/, game on http://localhost:5173/play/
npm test          # vitest run: 420 tests, 24 files
npm run build     # tsc --noEmit then vite build, output in dist/ (landing, how-to-play, play, 404)
npm run preview   # serve the production build on http://localhost:4173 (does NOT send public/_headers)
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
Rehearsed on 2026-09-19 at this ship: tagged `ship-2026-09-19b`, checked out the previous ship tag `ship-2026-09-19` (commit `f734da8`), ran `npm run build` (green) and `npx vitest run` (382 passed, 18 files) from it, then returned to `main` at `2252a5c` with a clean worktree.

- Cloudflare: `npx wrangler rollback` returns the live site to the previous uploaded version; `npx wrangler versions list` shows the versions. Or check out the previous tag and `npm run deploy`.
- pi3: `deploy.sh` snapshots the live tree to `html.prev` before every sync; the swap is in `deploy/README.md` under Rollback.
- Return target for this ship: `git checkout ship-2026-09-19b`. Previous good state: `ship-2026-09-19`.

## Known limitations and accepted risks
No finding was accepted; the accepted risks list is empty. Every finding in `.itworks/REVIEWS.md` is closed with evidence.

- Touch: one finger moves the view, pinch zooms, a still press places, two fingers pan while sizing a lobby or elevator; the palette is a scrollable bottom sheet on phones. Proven with emulated touch events in Chrome at 390x844, not yet on a physical phone in Safari; that hands-on check is the owner's.
- The PWA install click in the browser's address bar is outside what the browser tools can drive; installability was verified from the page (controlling service worker, manifest with standalone display, maskable icons) and the offline reload was proven live, but the install button itself is the owner's to press.
- The two-line wordmark and the share image are procedural PNG/SVG from `scripts/make-wordmark.mjs` and `scripts/make-og.mjs`; regenerate after any palette change.
- Backups: there is no server-side data. The player's tower lives in their browser (IndexedDB, localStorage fallback) and their own exported JSON files; export and import are test-covered and were driven live in Chrome, and clearing browser data with no export loses the tower.

## What breaks first and how you'd know
A PixiJS upgrade that changes how it compiles shaders, first. The site's Content Security Policy forbids eval, and the renderer only starts because `src/render/renderer.ts` loads `pixi.js/unsafe-eval` before anything else; if an upgrade moves that requirement, `/play/` shows "The page's security policy blocked the tower renderer" and the browser console logs `unsafe-eval`. The pre-deploy nginx container check catches it before it is live. Second, elevator wait under load: sims leave when their wait passes the black threshold, visible as population and evaluation falling while rooms sit vacant, with event log lines naming the wait. Third, the display fonts come from Google Fonts under the CSP; a host change renders the game in system fonts with a CSP violation in the console.

## Where things live
- Code: `/Users/matthew/parallax-private/Projects/hundred-stories`. `src/sim` pure simulation, `src/render` PixiJS scene and input classification, `src/ui` DOM overlay, `src/game` the shell, `src/site` landing hero and stylesheet, `index.html`, `how-to-play/`, `play/`, `404.html` the pages, `tests/` the vitest suite, `docs/` DESIGN, VISUAL and LANDING-SPEC, `deploy/` runbooks and the pi3 package, `scripts/` icon, wordmark and share-image generators. Full layout in `.itworks/MAP.md`.
- Origin: self-hosted Gitea at `git.parallaxintelligence.xyz/ParallaxIntelligence/hundred-stories`. Public mirror: https://github.com/parallaxintelligencepartnership/hundred-stories.
- Hosting: Cloudflare Workers static assets, project `hundred-stories`, domains hundredstories.xyz and www from `wrangler.jsonc`; the workers.dev copy is switched off. DNS zone on Cloudflare, registrar Spaceship.
- Database: none. No server, no backend, no ports of its own.
- Secrets: none in the tree or in git history (swept at this closeout). Wrangler's own login lives in its config on the deploying Mac.
- Project state: `.itworks/` holds PROJECT.md, MAP.md, DECISIONS.md, REVIEWS.md and PROFILE.md; REVIEWS.md is the finding record this document is built from.

## Ship history
- 2026-09-19: first ship (closeout; deploy pending domain)
- 2026-09-19: post-ship checkpoint, people rescaled and interiors redrawn
- 2026-09-19: second ship, live at https://hundredstories.xyz: landing site with SEO and Parallax structured data, game at /play/, sprite wordmark, camera controls, AGPL licence, public GitHub mirror, Workers static assets hosting, CSP fix for PixiJS; tag ship-2026-09-19b
- 2026-09-19: post-ship fixes live the same day: stairs and elevators overlay rooms, shafts rise into empty air, https redirect, touch controls for phones and tablets, copy without the 1994 framing
