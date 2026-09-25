# Verification of lane H at 7b4e60f

Setup: `uname -m` arm64 (this Mac; pi3 is x86_64 per MAP.md). HEAD 7b4e60f (tag ship-2026-09-24b). dist/ and dist-app/ are the 0.4.10 build from Sep 24 23:55; live /sw.js is byte-identical to dist/sw.js (`cmp` clean). Nothing was built, installed or written in the repo. No reviewer probe folder exists for lane H.

## Verdicts

### S1. The 404 page and the web manifest still show Steam and the source link - CONFIRMED (final: IMPORTANT)
- Reproduction. Repo lines:
  - 404.html:31 `<p>A tower-building game for the browser, coming to the App Store, Google Play and Steam. Plays offline, saves on your device, nothing uploaded.</p>`
  - 404.html:37 `<a href="https://github.com/parallaxintelligencepartnership/hundred-stories">Source on GitHub</a>`
  - 404.html:48 `<span>Play in the browser. Source available to read.</span>`
  - vite.config.ts:101 `'Hundred Stories is a tower-building simulation for the browser, coming to the App Store, Google Play and Steam. ...'`
  - Live: `curl -s https://hundredstories.xyz/this-page-does-not-exist` returns HTTP 404, and grep prints the same three lines at 31, 37 and 48. `curl -s https://hundredstories.xyz/manifest.webmanifest` and dist/manifest.webmanifest both carry `"description":"... coming to the App Store, Google Play and Steam. ..."`.
  - Rulings it goes against: DECISIONS.md:76 `2026-09-24 | Steam leaves every public surface (landing, guide, privacy, demo card); the Steam build code and Tauri steam feature stay`. DECISIONS.md:77 `2026-09-24 | the GitHub source link and "Source available to read." leave every footer; the Requests link stays`.
  - index.html, how-to-play and privacy have no Steam, Source or GitHub text (grep is empty). The landing footer (index.html:286, 299-302) is the corrected form. `git diff ship-2026-09-24..HEAD -- 404.html` shows the 0.4.10 wording pass edited lines 31 and 46 of this footer and left Steam and the source text in place. tests/site/stores.test.ts:29 checks only `landing`.
- Severity: IMPORTANT. A live public page and the PWA install text go against two explicit owner rulings from the day before, and no test guards either one.
- Fix spec: 404.html footer brand line becomes the index.html:286 sentence. Remove 404.html:37 and :48. Remove "and Steam" from the vite.config.ts:101 description (it reads "the App Store and Google Play"). Add a test in tests/site/stores.test.ts that reads 404.html, how-to-play/index.html, privacy/index.html and the VitePWA manifest description and checks none contains "Steam", "Source on GitHub" or "Source available to read". That test fails now and passes after the fix. Must not change: the "Requests" nav link, the Tauri/Steam build code, and the rest of the manifest (scope, id, start_url, icons).

### S2. deploy.sh never applies nginx.conf changes on pi3 - CONFIRMED (final: ADVISORY)
- Reproduction (traced; running a container would change host state):
  - deploy/deploy.sh:40 `rsync -avz ".../deploy/compose.yml" ".../deploy/nginx.conf" pi3:/opt/hundred-stories/`. There is no `--inplace`, so GNU rsync on pi3 writes a temp file and renames it into place: a new inode.
  - deploy/compose.yml:3 `image: nginx:1.29.4-alpine` (pinned, so the image never changes) and :8 `- /opt/hundred-stories/nginx.conf:/etc/nginx/nginx.conf:ro`, a single-file bind mount.
  - deploy/deploy.sh:53 `ssh pi3 "cd /opt/hundred-stories && docker compose up -d"`. Compose recreates a container only when the service definition (its config hash) or the image changed. The contents of a bind-mount source are not part of that hash. With compose.yml unchanged, `up -d` leaves the container running. `docker compose up --help` (Compose 5.2.0 here) offers `--force-recreate` as the only override, and deploy.sh does not pass it. No `restart`, `nginx -s reload` or `--force-recreate` appears anywhere in deploy/.
  - A reload would not help either: the single-file mount holds the old inode, so the container keeps seeing the old nginx.conf until it is restarted or recreated.
  - deploy/README.md:57 says the step "picks up any compose/nginx changes". That is true for compose.yml edits and false for nginx.conf alone.
- Severity: ADVISORY. pi3 is the fallback host (PROJECT.md:24); production is Cloudflare.
- Fix spec: after the rsync, deploy.sh:53 must run `docker compose up -d --force-recreate` (or `docker compose restart hundred-stories` after `up -d`), and README:57 must say so. Another fix: mount the deploy directory and point at the conf inside it. Must not change: the html directory mount, which rsync --delete updates in place, and the rollback section's "no restart needed" for html. No test exists. A shell check could grep deploy.sh for `--force-recreate|restart`.

### S3. The pi3 fallback runbook's DNS step and verification point at the live Cloudflare host - PARTIAL (final: ADVISORY)
- What holds:
  - wrangler.jsonc:13-14 attaches hundredstories.xyz and www as Workers custom domains. `curl -sI https://hundredstories.xyz/` returns `server: cloudflare`, and dig gives Cloudflare anycast IPs.
  - deploy/README.md:11-13 tells you to add an apex A record and never says to detach the custom domain. Cloudflare holds a record for a custom-domain hostname, so the step collides.
  - deploy.sh:42-45 skips .env when deploy/.env is missing, and :59-61 then reads SITE_HOST from .env.example. The local check reports a host, while compose on pi3 interpolates `${SITE_HOST}` to empty at compose.yml:14/:17 (``Host(``)``) unless a .env was left there by an earlier run.
- What does not hold as stated: the curl checks at deploy.sh:64-65 hit Cloudflare only while DNS still points there. Once the runbook's DNS step is done, they reach pi3. `|| true` swallows only transport failures. A 404 or 502 still prints its code, but nothing fails on it.
- Fix spec: the README gets a step 0 ("remove the Workers custom domains in wrangler.jsonc routes / dashboard before adding the A record"). deploy.sh exits non-zero when deploy/.env is missing and `--no-up` is not given, and fails when the codes are not 200 (use `curl -fsS` and drop `|| true`). Must not change: the `--no-up` staging path.

### S4. The service worker precaches the landing site, and every page registers it - CONFIRMED (final: ADVISORY)
- Reproduction (config read; built artifact inspected, no build run). vite.config.ts:92-123: `scope: '/play/'`, `includeAssets: ['icons/*.png']`, `globPatterns: ['**/*.{js,css,html,png,svg,woff2}']`, `globIgnores: ['**/node_modules/**', 'assets/native-*']`, and no `injectRegister` (default 'auto', which injects into every HTML entry). The glob over dist/ therefore takes:
  - every HTML page (index, 404, privacy, how-to-play, play)
  - every public png/svg (og.png, six wordmark files, icons)
  - theme.js, registerSW.js and both fonts
  - every non-native asset chunk
  - plus the manifest and the icons a second time from includeAssets.
- dist/sw.js has 35 entries (33 unique, because icon-192/512 appear twice with the same revision), 1,511,287 bytes.
- The play page references only icons, theme.js, the manifest, registerSW.js and the play/theme/stores/Pixi/preload chunks. Its JS and CSS contain no wordmark or og.png reference.
- Landing-only entries: index.html, 404.html, privacy/index.html, how-to-play/index.html, og.png, wordmark-{dark,light}.{png,svg}, wordmark-line-{dark,light}.svg, assets/site-*.css, assets/main-*.js and assets/theme-init-*.js. That is 14 files, 369,347 bytes.
- A worker with scope /play/ gets fetch events only from clients under /play/, and none of those clients request these files, so they are never served from the cache.
- dist/registerSW.js registers `/sw.js` with `{ scope: '/play/' }`, and `grep -l registerSW` matches all five pages, so a landing or 404 visitor downloads the full 1.5 MB.
- Do landing pages belong in the precache? No. They are outside the worker's scope. Registering from the landing page to warm the game for offline play is a defensible choice, so this is ADVISORY: wasted bandwidth, no wrong behavior.
- Fix spec: add the landing-only names above to `globIgnores`, or narrow `globPatterns` to `play/index.html`, `assets/**`, `fonts/**`, `icons/**` and `theme.js`. Optionally set `injectRegister: null` and register from the play entry only. Add an assertion to tests/site/app-build.test.ts (or a new web-build test) that the dist/sw.js URL list contains none of index.html, 404.html, privacy/, how-to-play/, og.png, wordmark-* or assets/main-*. It fails now. Must not change: `navigateFallback: '/play/index.html'`, the native-* exclusion, or the preload-helper chunk staying precached.

### S5. `npm run store:shots` cannot make the store graphics, and manifest.json is never written - CONFIRMED (final: ADVISORY)
- Reproduction (traced).
  - scripts/make-store-shots.mjs:54-61 sources og.png and wordmark-dark.png. vite.config.ts:18 and :76 delete og.png, robots.txt and every `wordmark*` from dist-app. `ls dist-app` shows assets, fonts, icons, index.html and theme.js only.
  - In preview, node_modules/vite (8.3.0) dist/node/chunks/node.js:35084 installs htmlFallbackMiddleware with spaFallback for appType spa. At :16556 it accepts any request whose Accept includes `*/*`, and at :16583 it rewrites a missing path to /index.html. A page `fetch()` sends `Accept: */*`.
  - So :355 `createImageBitmap(blob)` gets HTML and rejects, `evaluate` throws, main's catch (:453-456) exits 1 at the first graphic (steam-header-capsule), and :441 never runs.
  - Artifacts agree: store/shots/ holds 30 screenshots and no capsule, feature-graphic or play-icon file, and `ls store/shots/manifest.json` gives "No such file".
  - Commit order: 67ffb00 21:35:11, 95744e5 21:48:56 on 2026-09-22.
- Fix spec: resolve GRAPHICS sources from the repo's public/ (read the file in Node and pass a data URL to the page), not from the preview origin. A check that `(await fetch(url)).headers.get('content-type')` starts with `image/` then gives a clear error. Test: a unit test that every GRAPHICS source exists on disk and that the script does not load it through `${base}`. Must not change: the screenshot table and the sizes checked in tests/store/shots.test.ts.

### S6. The store "closer" scene is the same zoom as "tower" - CONFIRMED (final: ADVISORY)
- Reproduction.
  - One key step: renderer.ts:2121-2123 calls camera.zoomStep(1), which calls wheel(-120). The factor is exp(120*0.0022) = 1.3021 (camera.ts:307, KEY_ZOOM_DELTA 120).
  - Snap stops are [0.175, 0.5, 1, 2, 3] (camera.ts:24-26). nearestSnap (:468) uses log distance.
  - Node probe: `1 step 1.3021 -> 1`, `2 steps 1.6955 -> 2`, `-2 steps 0.5898 -> 0.5`.
  - `cmp` shows android-phone-1-tower.png and -4-closer.png identical. For other sizes, decoded pixel bytes differ by 3,916 of 6.2 M (steam) and 3,753 of 17 M (iPad) for tower vs closer, against 78,060 and 100,252 for tower vs close. Those small differences are moving sims only.
- Fix spec: make "closer" 4 steps (1.30^4 = 2.87, which snaps to 3), or drop the step count and set the zoom directly. Add a unit test in tests/store that, for each scene, applies `steps` to nearestSnap and requires five distinct zooms (or four plus the build scene). It fails now. Must not change: tower = zoom 1, wide = 0.5, close = 2.

### S7. The Tauri capability grants more of $APPDATA than the save slot uses - CONFIRMED (final: ADVISORY)
- Reproduction. src-tauri/capabilities/default.json:6-17 lists: `core:default`, `fs:allow-appdata-read-recursive`, `fs:allow-appdata-write-recursive`, `fs:allow-appdata-meta-recursive`, `fs:allow-mkdir`, `fs:allow-read-text-file`, `fs:allow-write-text-file`, `fs:allow-write-file`, `dialog:allow-save`, `dialog:allow-open`.
- In tauri-plugin-fs 2.5.2 (Cargo.toml:27 pins =2.5.2), permissions/autogenerated/base-directories/appdata.toml:37-50 makes the read and write sets `read-all` and `write-all` plus `scope-appdata-recursive` ($APPDATA, $APPDATA/**).
  - read-all adds read_dir, read_file, read, open, read_text_file_lines*, seek, stat, lstat, fstat, exists, watch and unwatch.
  - write-all adds mkdir, create, copy_file, remove, rename, truncate, ftruncate, write, write_file and write_text_file.
- The only calls in src/ are in src/game/storage.ts:
  - :298 mkdir
  - :299 and :361 write_text_file
  - :300 and :361 read_text_file
  - :301 rename
  - :405 write_file
  - dialog save and open at :373, :385 and :413
- Minimum set: `core:default`, `fs:scope-appdata-recursive`, `fs:allow-mkdir`, `fs:allow-read-text-file`, `fs:allow-write-text-file`, `fs:allow-rename`, `fs:allow-write-file`, `dialog:allow-save`, `dialog:allow-open`. `fs:allow-rename` is not in the list today, so removing the sets without adding it would break every desktop save.
- Fix spec: replace the three sets with the minimum set above. Proof has to come from a Tauri run (save, reload, export, import). No vitest can check capabilities. A JSON test in tests/site/versions.test.ts can pin the exact permission list. Must not change: the atomic tmp+rename save and the dialog-scoped export/import.

### S8. Three _headers cache rules never match a page request - CONFIRMED (final: ADVISORY)
- Reproduction. public/_headers:
  - :23-24 `/index.html` / `Cache-Control: no-cache, must-revalidate`
  - :26-27 `/play/index.html` / `Cache-Control: no-cache, must-revalidate`
  - :29-30 `/how-to-play/index.html` / `Cache-Control: no-cache, must-revalidate`
- Workers static assets use auto trailing-slash HTML handling. A request for /x/index.html gets a 307 to /x/, and _headers rules match the request path, not the file served. So each rule fires only on the redirect.
- Live:
  - `/play/`, `/`, `/privacy/` and `/how-to-play/` each return 200 with `public, max-age=0, must-revalidate`
  - `/play/index.html` returns 307 to /play/ with `no-cache, must-revalidate`
  - `/index.html` returns 307 to / with `no-cache, must-revalidate`
  - `/404.html` returns 307 to /404
- The effect today is equivalent to what the file intends (max-age=0 plus must-revalidate), which is why this is ADVISORY.
- Fix spec: key the rules to `/`, `/play/`, `/how-to-play/`, `/privacy/` (or a `/*` default with `/assets/*` overriding). A tests/site check that every rule path other than /assets/* and the named .js/.webmanifest files ends in `/`. It fails now. Must not change: the /* security headers or the /assets/* immutable rule.

### S9. A second deploy.sh run overwrites the only rollback copy - CONFIRMED (final: ADVISORY)
- Reproduction (trace, deploy.sh:28-37). Say release A is live.
  - Run 1: html=A exists, so :31 removes html.prev and :32 sets html.prev=A. :37 sets html=B. Then :53 fails (set -e exits).
  - Run 2: html=B exists, so :31 deletes html.prev (A is gone) and :32 sets html.prev=B. :37 sets html=B.
  - The README rollback (README:65-72) now swaps B with B. A can come back only from a tag rebuild (README:81-82).
  - The same happens on any rerun of an already-deployed release, for example rerunning to push an nginx.conf fix (see S2).
- Fix spec: snapshot only when html differs from dist (for example compare html/index.html to dist/index.html, or `rsync -n --delete` reports changes). Or keep timestamped snapshots and point html.prev at the last distinct one. Must not change: the first-deploy path when html is missing, and the README swap procedure.

## Duplicates
- None named by the task. S1 may overlap any lane covering player-facing copy (Steam/footers); the orchestrator should check lane I or the copy lane.

## Notes
- New suspicion N1 (ADVISORY). deploy/deploy.sh:8-10 says the compose stack reads deploy/.env "via `docker compose --env-file` on pi3", but :53 passes no `--env-file`. It works only because :44 copies the file to the project directory's `.env`. The comment is wrong. Fix: correct the comment. No behavior change.
- The reviewer's precache count of 34 is 35 raw / 33 unique. The byte figures (1.51 MB, 369 KB) reproduce exactly.
- Nothing here re-flags a settled decision. DECISIONS.md:18 (Workers hosting) and PROJECT.md:24 (pi3 as fallback) keep S2, S3 and S9 in scope as fallback-kit defects.
