# Lane H: Hosting, deploy, build, shells and pages at 7b4e60f

## Suspicions
### S1. The 404 page and the web manifest still show Steam and the source link (proposed: IMPORTANT)
- Where: 404.html:31, 404.html:37, 404.html:48; vite.config.ts:101 (manifest description)
- Input: any unknown URL, e.g. https://hundredstories.xyz/nope; installing the PWA from /play/.
- Wrong outcome: the 404 footer says "coming to the App Store, Google Play and Steam", links "Source on GitHub" and says "Source available to read." The manifest description says "App Store, Google Play and Steam". Two rulings from 2026-09-24 say otherwise: Steam leaves every public surface, and the source link and "Source available to read." leave every footer. The landing page, guide and privacy page were updated. The 404 page and the manifest were missed.
- Reproduce: `curl -s https://hundredstories.xyz/nope | grep -nE 'Steam|Source'` shows lines 31, 37 and 48 live. `curl -s https://hundredstories.xyz/manifest.webmanifest | grep -o 'Google Play and Steam'` matches. tests/site/stores.test.ts:29 checks only index.html for "Steam".

### S2. deploy.sh never applies nginx.conf changes on pi3 (proposed: ADVISORY)
- Where: deploy/deploy.sh:40,53; deploy/README.md:57; deploy/compose.yml:8
- Input: a release that changes deploy/nginx.conf (for example the CSP), deployed with deploy/deploy.sh while the container is already running.
- Wrong outcome: rsync replaces the file on pi3. `docker compose up -d` sees the same compose file and leaves the running container alone. nginx reads its config only at start or reload, so the old headers keep being served. The mount is a single file and rsync writes a new file (a new inode) by default, so the container still holds the old copy until it is recreated. README:57 says the step "picks up any compose/nginx changes", which is false.
- Reproduce: trace deploy.sh:40 (`rsync -avz ... nginx.conf`), then :53 (`docker compose up -d`, which does nothing when the config is unchanged). No `nginx -s reload`, `restart` or `--force-recreate` appears anywhere. To confirm in a throwaway: run compose with this file, edit the CSP line, rsync it, run `up -d`, then `curl -sI localhost:PORT` still shows the old CSP.

### S3. The pi3 fallback runbook's DNS step and verification point at the live Cloudflare host (proposed: ADVISORY)
- Where: deploy/README.md:11-13, :31, :78-79; deploy/deploy.sh:55-65; deploy/.env.example:1
- Input: follow deploy/README.md with SITE_HOST=hundredstories.xyz, the value .env.example ships with.
- Wrong outcome: in step 2, an A record for the apex conflicts with the Workers custom domain that wrangler.jsonc:13 attaches to the same name. The runbook never says to detach the custom domain first. The curl checks in deploy.sh (:64-65) and in the rollback section hit Cloudflare, not pi3. They print 200 whatever state pi3 is in, and `|| true` hides failures. With no deploy/.env, pi3 gets no .env and compose builds `Host(``)`, while the local check still reads .env.example and reports success.
- Reproduce: `curl -sI https://hundredstories.xyz/` returns Cloudflare headers today. Trace deploy.sh:56-61 for the .env.example fallback.

### S4. The service worker precaches the landing site, and every page registers it (proposed: ADVISORY)
- Where: vite.config.ts:92-123 (globPatterns `**/*.{js,css,html,png,svg,woff2}`, default injectRegister)
- Input: visit / (or /how-to-play/, /privacy/, any 404).
- Wrong outcome: every page includes `<script src="/registerSW.js">`, which registers /sw.js with scope /play/. The precache has 34 entries (1.51 MB). About 369 KB of that is landing-only: index.html, how-to-play, privacy, 404.html, og.png, six wordmark files, site CSS and main-*.js. A worker scoped to /play/ can never serve those files. A landing visitor who never plays also downloads the game's play-*.js and play CSS. The lane invariant is precache for /play/ only.
- Reproduce: `tr ',' '\n' < dist/sw.js | grep -o 'url:"[^"]*"'`, and `grep registerSW dist/index.html dist/404.html`.

### S5. `npm run store:shots` cannot make the store graphics, and manifest.json is never written (proposed: ADVISORY)
- Where: scripts/make-store-shots.mjs:54-61,353-355,432,441; vite.config.ts:18
- Input: `npm run store:shots` with default settings (preview of dist-app).
- Wrong outcome: GRAPHICS reads /og.png and /wordmark-dark.png from dist-app. The app build deletes both (APP_UNUSED_PUBLIC_FILES and the `wordmark` prefix), and /robots.txt too. Vite preview's SPA fallback answers /og.png with index.html, because fetch sends `Accept: */*` (node_modules/vite/dist/node/chunks/node.js:16556,16583). createImageBitmap then rejects on HTML, main() exits 1 at the first capsule, and the manifest write at :441 is skipped. The local store/shots/ matches this: 30 screenshots, no steam-*capsule or play-feature-graphic files, no manifest.json. The removal (67ffb00, 21:35) came 13 minutes before the script (95744e5, 21:48).
- Reproduce: `ls dist-app` (no og.png), `ls store/shots/steam` (screenshots only), `ls store/shots/manifest.json` (missing).

### S6. The store "closer" scene is the same zoom as "tower" (proposed: ADVISORY)
- Where: scripts/make-store-shots.mjs:323; src/render/camera.ts:24,36,468
- Input: scene `closer` = one zoom-in step from zoom 1.
- Wrong outcome: one step gives 1/0.77 ≈ 1.30. nearestSnap takes the log distance: 0.26 to stop 1 and 0.43 to stop 2, so it snaps back to 1. "Closer" is then the opening view, and less close than "close", which is 2 steps (1.69, snaps to 2). The Steam listing needs five distinct shots.
- Reproduce: `cmp store/shots/android/android-phone-1-tower.png store/shots/android/android-phone-4-closer.png` reports them identical. The other sizes differ only because the sims move between page loads.

### S7. The Tauri capability grants more of $APPDATA than the save slot uses (proposed: ADVISORY)
- Where: src-tauri/capabilities/default.json:7-15
- Input: the `fs:allow-appdata-read-recursive`, `-write-recursive` and `-meta-recursive` sets.
- Wrong outcome: these expand to read-all and write-all in tauri-plugin-fs 2.5.2 (permissions/write-all.toml, read-all.toml). The webview gets remove, truncate, copy_file, read_dir, watch, open and seek on everything under $APPDATA. storage.ts:262-297 uses only mkdir, write_text_file, read_text_file and rename (plus write_file for exports). The four explicit allow-* entries repeat what the sets already grant.
- Reproduce: `cat ~/.cargo/registry/src/*/tauri-plugin-fs-2.5.2/permissions/write-all.toml`.

### S8. Three _headers cache rules never match a page request (proposed: ADVISORY)
- Where: public/_headers:23-30
- Input: GET /play/ and GET /privacy/.
- Wrong outcome: the rules are keyed to /index.html paths. Workers static assets serve /play/ and send /play/index.html a 307, so the rule's no-cache lands only on the redirect. Pages fall back to Cloudflare's default `public, max-age=0, must-revalidate`, which is safe today but is not what the file declares. /privacy/ and /404.html have no rule at all.
- Reproduce: `curl -sI https://hundredstories.xyz/play/` gives the default header, and `curl -sI https://hundredstories.xyz/play/index.html` gives `307` with `no-cache, must-revalidate`.

### S9. A second deploy.sh run overwrites the only rollback copy (proposed: ADVISORY)
- Where: deploy/deploy.sh:28-34
- Input: run deploy.sh, it fails after rsync (for example at `compose up` or the curl step), then run it again.
- Wrong outcome: the second run copies the new release into html.prev, so the README rollback puts the same new release back. The previous release can then only come back from a git-tag rebuild.
- Reproduce: trace :30-32. The snapshot does not check whether html already matches the build being pushed.

## CSP and header diff: public/_headers against deploy/nginx.conf
- CSP: byte-identical (node compare: true). HSTS, nosniff, Referrer-Policy and Permissions-Policy values are identical.
- Cache-Control: nginx sends no-cache on everything outside /assets (fonts, icons, og.png, wordmarks, workbox-*.js, privacy, 404). Cloudflare sends its default on anything without a rule.
- 404: Cloudflare serves 404.html. nginx `=404` serves nginx's built-in page.
- www: Cloudflare routes www. The pi3 compose file routes only `${SITE_HOST}`.
- nginx serves dist/_headers publicly at /_headers. Cloudflare does not.
- On pi3, Traefik's entrypoint middleware may replace headers (nginx.conf:64-68). The live pi3 values are unverified.
- Origins: every page loads only self (theme.js, /assets, /fonts, /icons, the manifest, registerSW.js, sw.js). ld+json blocks do not execute. No inline script or style appears in the built HTML, and no data: font. The built JS has no `new Function`/`eval`. img blob: and data: are used by the share preview. Live: workers.dev returns 404 and www returns 200 with the policy.

## Questions for the owner
- `style-src 'unsafe-inline'` may be unneeded. No style attribute, `<style>` or setAttribute('style') appears in the source or the built output. Removing it needs a browser pass: serve dist with the nginx container using a CSP without it, load /play/ and /, and grep the console for "Refused to apply inline style".
- The Capacitor shells run with no CSP at all: dist-app/index.html has no meta policy and Capacitor sends no headers. Tauri has one. Is that intended?
- deploy/cloudflare-pages.md:35 names the account's workers.dev subdomain in a tracked file that goes to the public mirror. The 2026-09-20 gotcha allows deploy docs under deploy/. Please confirm this name is acceptable there.

## What the tests do not prove
- tests/site/app-build.test.ts: nothing asserts the precache excludes landing pages, or that registerSW is missing from landing pages or from dist-app. Line 11 hard-codes another session's scratchpad path and silently falls back to tmpdir.
- tests/site/fonts.test.ts: only font-src and style-src are compared across policies. No full CSP-equality test exists between _headers and nginx.conf.
- tests/site/stores.test.ts: the "Steam" check covers index.html only, not 404.html, the guide, privacy or the manifest. No test checks footers for "Source on GitHub".
- tests/store/shots.test.ts: checks sizes and tables only. The E2E run is opt-in, so S5 and S6 go unseen.
- tests/site/versions.test.ts: version stamps only. It proves nothing about the Tauri CSP or capabilities.
- Nothing tests deploy.sh, the rollback, or the wrangler routes.

## Coverage
- Read in full: public/_headers, deploy/{README.md, cloudflare-pages.md, compose.yml, deploy.sh, nginx.conf, .env.example}, wrangler.jsonc, vite.config.ts, package.json, tsconfig.json, .nvmrc, capacitor.config.ts, src-tauri/{tauri.conf.json, capabilities/default.json, Cargo.toml, build.rs, src/lib.rs, src/main.rs, src/achievements.rs, README.md}, index.html, play/index.html, how-to-play/index.html, privacy/index.html, 404.html, public/robots.txt, public/sitemap.xml, public/theme.js, scripts/{make-icons, make-og, make-store-shots, make-wordmark, render-audio-samples, analyze-audio-samples}.mjs, scripts/bench/{bench3, bench4, hash}.ts and README.md, tests/site/{app-build, versions}.test.ts, tests/store/{fixture, shots}.test.ts, .gitignore. Built artifacts inspected: dist/ (sw.js, registerSW.js, manifest, all HTML heads, CSS url()s), dist-app/index.html.
- Skipped: scripts/replay.ts (not a *.mjs or bench file, so outside this lane's glob). src-tauri/Cargo.lock (only the pins for tauri and tauri-plugin-fs were checked). Live pi3 state (no ssh; to close: `ssh pi3 'docker exec hundred-stories nginx -T | grep Content-Security; cat /opt/hundred-stories/.env'` and the Traefik dynamic config).
- Probes run: `npx vitest run tests/site/app-build.test.ts tests/site/versions.test.ts tests/store`: 14 passed, 1 skipped. `grep -E '"[\^~]' package.json`: no match. Lockfile check: every direct dependency is pinned and matches the installed version, and the uuid override resolves to 11.1.1. `npm audit`: 0 vulnerabilities. `npm ci --dry-run`: clean, only allowScripts warnings for esbuild, fsevents and workerd. Live curl of /play/, /play/index.html, /privacy/, /sw.js, /nope, www and workers.dev: results as cited above. `uname -m`: arm64 (this Mac). git status was unchanged before and after.
