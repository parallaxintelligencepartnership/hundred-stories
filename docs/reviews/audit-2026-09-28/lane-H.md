# Lane H: Hosting, deploy, build, shells and pages at 0f05723

## Suspicions
### S1. ship.sh treats a failed deploy as a success, then pushes the tag to both remotes (proposed: IMPORTANT)
- Where: scripts/ship.sh:5, :60, :64-68 (commit and tag at :55-56 happen before the deploy)
- Input: any failure inside `npm run deploy`: tsc error, predeploy-check exit 1, a wrangler auth or upload error.
- Wrong outcome: the script runs under `sh -eu` with no pipefail. `npm run deploy 2>&1 | tee log` takes tee's exit status (0), so the script goes on. It runs `git push origin main --tags` and `git push github main --tags`, which publishes the release commit and ship tag on the public mirror, and prints "shipped X as TAG". The live site still serves the previous version. The ship record (DECISIONS/SHIPPED) is written from that output. Separately, the script never checks the current branch: run from a branch, it tags that commit but pushes local `main`.
- Reproduce: `/bin/sh -eu -c 'sh -c "exit 1" 2>&1 | tee /dev/null; echo continued'` prints `continued` and exits 0 (run here). Trace ship.sh:60 to :68.

### S2. ship.sh rewrites every Cargo.lock crate whose version equals the old app version; the committed lockfile is already corrupt (proposed: IMPORTANT)
- Where: scripts/ship.sh:37 (`s/^version = "OLD"/version = "NEW"/` over all of src-tauri/Cargo.lock)
- Input: any ship where a dependency crate has the same version number as the app. This has happened on every 0.6.x ship since 0.6.1.
- Wrong outcome: at 0f05723, ten dependency entries claim version 0.6.6 but carry another release's checksum: block2 (0.6.2), cssparser-macros (0.6.1), jsonptr (0.6.3), objc2 (0.6.4), raw-window-handle (0.6.2), socket2 (0.6.5), string_cache_codegen (0.6.1), toml_datetime (0.6.3), window-vibrancy (0.6.0), writeable (0.6.4). The count grows from ship to ship: `git show <ship> -- src-tauri/Cargo.lock | grep -c '^+version'` gives 1, 2, 4, 6, 8, 10 for 0.6.0 to 0.6.5. The next ship (0.6.8 to 0.6.9) also rewrites zlib-rs 0.6.8. The pinned-lockfile invariant is broken, and a `--locked` desktop build cannot resolve. tests/site/versions.test.ts:42-44 checks only the app's own entry, so the suite stays green.
- Reproduce: copy src-tauri to a scratch dir and run `~/.cargo/bin/cargo metadata --locked --offline --format-version 1`. It exits 101 with "failed to select a version for `objc2 = ^0.6` (locked to 0.6.6)". Put the ten versions back and the same command exits 0 (both run here). For the next ship: `sed "s/^version = \"0\.6\.8\"/version = \"0.6.9\"/"` on a copy changes lines 1280 (the app) and 4674 (zlib-rs).

### S3. The pi3 fallback has drifted from the live site: its CSP blocks the beacon, it has no feedback route, and the Cloudflare doc says there is no Worker (proposed: ADVISORY)
- Where: deploy/nginx.conf:60; deploy/cloudflare-pages.md:6-7, :77-78; deploy/README.md (no mention of /api/feedback)
- Input: serve dist/ with deploy/nginx.conf. This is the fallback host, and it is also the MAP gotcha's pre-deploy CSP check ("load /play/ from the nginx container ... grep the console for Refused").
- Wrong outcome:
  - Script and connect policy. The nginx policy lacks `https://static.cloudflareinsights.com` in script-src and `https://cloudflareinsights.com` in connect-src. public/_headers:6 has both, and the live headers match _headers. cfBeacon puts the beacon tag in all seven built pages, /play/ included (grep of the build). So every page under nginx logs "Refused to load the script", and the gotcha's grep-for-Refused check is red on every run. A real CSP regression would be hidden in that noise.
  - Feedback. On pi3, POST /api/feedback reaches nginx's `try_files ... =404`, so every feedback send shows the failure message.
  - Docs. cloudflare-pages.md still says "there is no Worker code involved (wrangler.jsonc has no main entry)" and "no server config or Worker code applies them". wrangler.jsonc:6 now names src/worker/index.ts.
- Reproduce: node diff of the two policies (run here). It prints only `script-src` and `connect-src` as different. For the refusal: `docker run ... nginx:1.29.4-alpine` per cloudflare-pages.md:55, load /play/ headless, grep the console for "Refused".

### S4. Regenerating the landing still (or the design sheet's home shots) captures the intro trailer, not the tower (proposed: ADVISORY)
- Where: scripts/make-hero-still.mjs:141-163; scripts/make-design-sheet.mjs:1166-1171, :1194
- Input: `node scripts/make-hero-still.mjs`, or the design sheet's site-home-* shots, at any commit since f04c745.
- Wrong outcome: both scripts wait for data-hero-settled="drawn", then capture within about 0.3 s. hero-trailer.ts starts a 15 s muted video at the page load event. site.css:323-342 puts `.hero-trailer` at z-index 1, above #hero-view, with opacity 1 while it plays. Neither script emulates reduced motion or hides #hero-trailer. So the captured `#hero-view` box is a trailer frame, which is centre-cropped and framed differently from the live canvas. The still's purpose (make-hero-still.mjs:4-5) is that the swap to the live canvas is "near invisible", and that breaks. The committed public/hero-still.webp (33f56cf) predates the trailer, so live is unaffected until the next run.
- Reproduce: code trace as above (not run: it needs vite preview and Chrome). Close it by running `node scripts/make-hero-still.mjs` in a scratch copy and viewing public/hero-still.webp; the fix direction is to hide #hero-trailer (or set it hidden) before the capture.

## Questions for the owner
- The lane invariant says no public page names hosting. privacy/index.html:73 and :106 name Cloudflare (Web Analytics, and feedback "stored at Cloudflare"). This reads as a deliberate processor disclosure. Please confirm it is exempt.
- The landing's Web tab (index.html:186) says "the game tracks nothing, and nothing leaves your device unless you send us feedback". The beacon is injected into /play/ too. The privacy page does disclose that the site counts "how many open the game". Is that wording acceptable for the game page?
- Do Workers apply the public/_headers security headers (CSP, nosniff, HSTS) to /trailers/* responses built by src/worker/range.ts? This was not checked: the task limited live curl to / and /play/. To close it: `curl -sI -H 'Range: bytes=0-1' https://hundredstories.xyz/trailers/the-wait.mp4`.
- The ship path runs neither tests nor the Worker type check: `npm run build` runs tsc with src/worker excluded (tsconfig.json:15), and wrangler bundles without type checks. Is `npm run typecheck` meant to be part of ship.sh?

## What the tests do not prove
- tests/site/versions.test.ts: checks only the app crate's entry in Cargo.lock. No `cargo metadata --locked` guard, so S2 passes green.
- tests/site/fonts.test.ts:74-90: compares only font-src and style-src across _headers, nginx.conf and Tauri. The beacon hosts are asserted for _headers only. No full-policy equality between the two hosting paths (S3).
- Nothing tests scripts/ship.sh (exit status on a failed deploy, branch, lockfile edits) or deploy/deploy.sh.
- tests/site/app-build.test.ts:11 still hard-codes another session's scratchpad path, with a silent tmpdir fallback.
- tests/site/hero-trailer.test.ts and clips.test.ts prove the trailer's own behavior, not that the capture scripts avoid it (S4).
- scripts/predeploy-check.mjs checks the CSP's script-src 'self', the absence of unsafe-eval, the play page and the Pixi shim. It does not check that the beacon origin the pages load is allowed.

## Coverage
- Previous findings re-checked and closed: S1 (404/manifest Steam text gone, vite.config.ts:121), S2/S9 (deploy.sh force-recreate, snapshot only on change), S3 (README step 0, curl -fsS pinned to pi3, .env required), S4 (landing pages out of the precache: 27 entries, none landing-only), S5 (graphics read from disk), S6 (closer = 4 steps), S7 (capability list pinned), S8 (page-path rules; the live / and /play/ send no-cache, must-revalidate).
- Read in full: public/_headers, deploy/{README.md, cloudflare-pages.md, compose.yml, deploy.sh, nginx.conf, .env.example, n8n-feedback-mailer.json (its meta note line cut at 400 chars)}, wrangler.jsonc, vite.config.ts, package.json, tsconfig.json, .nvmrc, capacitor.config.ts, src-tauri/{tauri.conf.json, capabilities/default.json, Cargo.toml}, index.html, play/index.html, how-to-play/index.html, privacy/index.html, clips/index.html, 404.html, public/{robots.txt, sitemap.xml, theme.js, notify-sw.js}, scripts/{ship.sh, predeploy-check.mjs, make-hero-still.mjs, make-store-shots.mjs, make-design-sheet.mjs, make-icons.mjs, make-og.mjs, make-wordmark.mjs, render-audio-samples.mjs, analyze-audio-samples.mjs}, scripts/bench/{bench3.ts, bench4.ts, hash.ts, README.md}, tests/site/{beacon, fonts, versions}.test.ts, src/site/{hero-trailer.ts, hero-ready.ts}, plus the relevant parts of hero.ts, site.css, notify.ts and feedback.ts.
- Skipped: terms/index.html was read only for its body and headers; it is not in the lane list. src-tauri/Cargo.lock was checked only for version and checksum pairs. Live pi3 and its Traefik config: no ssh beyond `ssh -G`. Worker logic belongs to lane J.
- Probes run:
  - `uname -m`: arm64.
  - `npx vite build --outDir <scratch>/dist`: ok, 27 precache entries, notify-sw.js precached and imported, and the SW registers with scope /play/.
  - `npx vitest run tests/site/{app-build,versions,beacon,fonts,clips}.test.ts tests/store`: 11 files, 68 passed, 1 skipped.
  - `grep -E '"[\^~]' package.json`: no match.
  - `npm audit`: 0 vulnerabilities.
  - CSP diff: two directives differ.
  - Live curl -I of / and /play/: 200, and the headers match public/_headers.
  - `cargo metadata --locked --offline` on a scratch copy: exit 101, then 0 after the ten versions were restored.
  - The sh/tee pipeline probe.
  - `ssh -G pi3`: the hostname is numeric.
  - git status in the checkout was clean before and after.
