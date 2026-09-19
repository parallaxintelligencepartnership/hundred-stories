# Hundred Stories - shipped 2026-09-19

## What this is
Hundred Stories is a browser game and installable PWA that recreates the ruleset of the 1994 tower simulation, with original art and a deterministic sim core. You run a skyscraper: build a lobby, offices, homes, shops and elevators, watch it fill with people over the years, and climb the star ladder from one star to TOWER. There is no backend and no account: the whole game runs in the browser, and saves live in the player's own browser storage plus files they export themselves.

## How to run it
Requirements: Node 26 (pinned in `.nvmrc`). No environment variables.

```bash
npm ci
npm run dev       # dev server on http://localhost:5173
npm test          # vitest run: 382 tests, 18 files
npm run build     # tsc --noEmit then vite build, output in dist/
npm run preview   # serve the production build on http://localhost:4173
```

`?seed=<number>` on the page URL sets the starting seed; the same seed and the same commands always produce the same world hash.

## How to deploy an update
Primary, Cloudflare Pages (`deploy/cloudflare-pages.md`):

```bash
npm run build
npx wrangler@latest pages deploy dist --project-name hundred-stories
```

`npm run deploy:pages` does both in one step. The dashboard path that connects a git repo needs the public GitHub mirror, which does not exist yet, so direct upload is the path that works today. Verify with `curl -sI https://hundredstories.xyz/` for the headers from `public/_headers`, then install the site as a PWA from the browser prompt.

Fallback, pi3 (`deploy/README.md`): copy `deploy/.env.example` to `deploy/.env`, set `SITE_HOST`, run `deploy/deploy.sh` (build, rsync to pi3, compose up, curl checks). Use `deploy/deploy.sh --no-up` to stage files before DNS and TLS exist.

## How to roll back
Rehearsed on 2026-09-19 at this ship: checked out the previous known-good commit `df9d853`, ran `npm run build` (green) and `npx vitest run` (382 passed, 18 files) from it, then returned to `main` at `98f2899` with a clean worktree. The ship is tagged `ship-2026-09-19`.

- Cloudflare Pages: open the project's Deployments list and promote a previous deployment to production. Or check out the previous tag, `npm run build`, and `npx wrangler@latest pages deploy dist --project-name hundred-stories`.
- pi3: `deploy.sh` snapshots the live tree to `/opt/hundred-stories/html.prev` before every sync; the swap command that restores it is in `deploy/README.md` under Rollback. No container restart is needed; nginx serves off the bind mount.
- Return target for this ship: `git checkout ship-2026-09-19`. The next ship inherits this tag as a real rollback target; before it there was none.

## Known limitations and accepted risks
No finding was accepted; nothing is on the accepted risks list. Everything below is OUTSTANDING work, tracked by an open finding in `.itworks/REVIEWS.md`.

- OUTSTANDING: the public GitHub mirror does not exist yet (it is in Matt's queue). Until it does, the Cloudflare Pages dashboard path in `deploy/cloudflare-pages.md` cannot be used and direct upload is the only deploy path.
- OUTSTANDING: the domain `hundredstories.xyz` is not bought and the site is not live. Nothing is deployed anywhere yet; this ship is the closeout, not the go-live.
- OUTSTANDING: the security headers in `public/_headers` have never been checked as actually served, because there is no domain to curl. The pi3 fallback headers are unchecked for the same reason (Traefik's security-headers middleware replaces rather than appends).
- OUTSTANDING: offline PWA install and offline play are unverified. The service worker precaches 17 entries at build time and the fonts have a runtime caching rule, but no one has installed the app and cut the network.
- OUTSTANDING: the deploy path pulls `npx wrangler@latest`, an unpinned publisher tool, so two deploys of the same commit can run different code.
- OUTSTANDING: audit coverage gaps carried from the 2026-09-19 audit, all browser-only: WebGL-unavailable fallback, the file picker import path, the renderer itself (no unit tests by the decision in `docs/DESIGN.md` section 11), and persistence across a real browser restart beyond the one live Chrome reload already recorded.
- Verified: a Chrome extension pass drove the real game in a real browser (tower, sims, HUD, save and reload). The simulation, save format, economy, elevators and stars are covered headlessly by 382 tests, and the sweep's mutation probe confirmed the suite bites.
- Backups: there is no server-side data to back up. The player's tower lives in their browser (IndexedDB, localStorage fallback) and their own exported JSON files; the export and import round trip is test-covered, and clearing browser data with no export loses the tower.

## What breaks first and how you'd know
Elevator wait under load, first. Sims give up and leave when their wait passes the black stress threshold, so a tall tower with too few shafts sheds tenants; the signal is the evaluation and population numbers in the HUD falling while rooms sit vacant, and event log lines naming the wait as the reason. Two slower failures to watch: a save format version bump orphans saved towers, and the browser refuses the file with its reason rather than corrupting the current game (`src/sim/save.ts`); and the display fonts come from Google Fonts under a CSP that names `fonts.googleapis.com` and `fonts.gstatic.com`, so if the font host ever changes the stylesheet is blocked and the game renders in system fonts, visible as a sudden plain-text look and a CSP violation in the browser console.

## Where things live
- Code: `/Users/matthew/parallax-private/Projects/hundred-stories`. `src/sim` pure deterministic simulation, `src/render` PixiJS scene, `src/ui` DOM overlay, `src/game` the shell that wires them, `tests/` the vitest suite, `docs/` DESIGN and VISUAL, `deploy/` the pi3 package. Full layout in `.itworks/MAP.md`.
- Origin: self-hosted Gitea at `git.parallaxintelligence.xyz/ParallaxIntelligence/hundred-stories`. No public mirror yet.
- Deploy docs: `deploy/cloudflare-pages.md` (primary) and `deploy/README.md` (pi3 fallback). Headers in `public/_headers` and `deploy/nginx.conf`, kept byte-identical.
- Database: none. No server, no backend, no ports of its own. Player saves are in the browser (IndexedDB, localStorage fallback) and exported files.
- Secrets: none. There is no `.env` in this project, no key anywhere in the tree or in git history, and no paid service.
- Project state: `.itworks/` holds PROJECT.md, MAP.md, DECISIONS.md, REVIEWS.md, LANES.md and PROFILE.md; REVIEWS.md is the finding record this document is built from.

## Ship history
- 2026-09-19: first ship (closeout; deploy pending domain)
- Published: entry dluwwu4f2vop | https://github.com/parallaxintelligencepartnership/itworks-site/pull/2 | 2026-09-19
- 2026-09-19: post-ship checkpoint, people rescaled and interiors redrawn
