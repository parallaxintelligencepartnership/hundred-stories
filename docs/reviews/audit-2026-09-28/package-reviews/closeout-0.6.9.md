Scope: closeout sweep, 1ce91ab, five lens runbooks + history audit. Not covered: application logic (audit tier). Last audit: 2026-09-28 @0f05723.

# Closeout sweep 2026-09-28 - 0.6.9 at 1ce91ab - lenses: security-auth, llm-security, real-data, testing, production-readiness, dependency vetting, history audit

Reviewer: one Opus pass, read-only. The repo stayed clean: `git status --porcelain` gave 0 lines before and after, HEAD 1ce91ab. Builds, mutations, the rollback save probe and the wrangler dry-run all ran in `git archive` scratch copies (scratchpad/h069 = HEAD, scratchpad/r068 = ship-2026-09-28 src) with node_modules symlinked. Nothing ran inside the repo. Host: `uname -m` = arm64 (the dev Mac). Live site: only read-only `curl -I` against / and /play/, plus the http to https redirect check. No POST was sent.

Diff under review: `ship-2026-09-28..1ce91ab` = 24 commits, 166 files, +8081/-828. Code changes: the audit fix wave (sim, UI, renderer, storage, Worker, ops), the landing splash (which replaces the hero trailer), the rush windows, the playtest fixes, ship.sh/predeploy hardening and the Cargo.lock repair. No npm manifest or lockfile changed.

## Lens: security-auth (applicable, closeout always)

- gitleaks 8.30.1: `gitleaks detect --source . --no-banner --log-opts="--all"` gave "479 commits scanned ... no leaks found" (`git rev-list --all` = 515; the difference is merge commits with no patch). The plain `gitleaks detect --source . --no-banner` also gave no leaks.
- Step 1: `grep -rEn -f secret-patterns.grep public src index.html clips play how-to-play privacy terms 404.html dist dist-app` = 0 lines. A fresh scratch `dist/` built at 1ce91ab also gave 0 lines. The Web Analytics site token in vite.config.ts:18 (`CF_BEACON_TOKEN`) matches no pattern. It is public by design and sits in every page (DECISIONS 2026-09-26).
- Step 1b: whole tree (excluding .git, node_modules, dist, build) = 85 lines. All 14 distinct strings are screenshot names caught by `sk-[A-Za-z0-9_-]{8,}` (`sk-z1-1300-person`, `sk-zfar-2200`, `sk-light-specimens` and the like, from `desk-...` shot names). None is a secret. `gitleaks dir .` also reads ignored files. It found 1 hit: `algolia-api-key` at trailer/out/verify-bundle/251.bundle.js:119114. That is Remotion Studio's public DocSearch key in gitignored build output (`git check-ignore -v`: trailer/.gitignore:2 `out/`). The 0.6.8 sweep recorded the same hit. It is not the project's key and was never committed, so it is not a finding.
- Step 2 (history, actually run): `git log --all -p | grep -En -f "$PAT" | head -20` printed 20 lines. The full count is 100 lines, and I read them all by pattern. All 100 match only pattern 1 (`sk-...`). The 14 distinct strings are the screenshot-name family listed above. Every other pattern in the file (Stripe, AWS, GitHub, JWT, DSN, PEM, Telegram, Discord, generic key=value) matched 0 lines of history.
- Step 3: `git ls-files | grep -E "(^|/)\.env|\.pem$|credentials"` returned only `deploy/.env.example`, whose content is `SITE_HOST=hundredstories.xyz`. .gitignore:4,5,14 has `.env`, `.env.*` and `!.env.example`. No keystore, p12, jks, mobileprovision or .dev.vars file is tracked. deploy/.env and .dev.vars do not exist on disk.
- Step 4: no protected routes (PROJECT.md "Who uses it": auth no, roles no). Live read-only check: `curl -sI https://hundredstories.xyz/` and `/play/` both gave `HTTP/2 200` with HSTS `max-age=31536000; includeSubDomains`, nosniff, strict-origin-when-cross-origin, Permissions-Policy, and a CSP byte-identical to public/_headers:6. `curl -sI http://hundredstories.xyz/` gave `301`. The live site is still 0.6.8, so this must be re-run after the deploy (commands in the ship checklist).
- Step 5: no roles, not applicable.
- Step 6: `grep -rEn -f injection-patterns.grep ...` hits: CSS selector strings and `delete d.x` lines in tests, one UI cache key template at src/ui/ui.ts:1351, and minified Pixi bundles under the gitignored ios/App/App/public and android/.../assets/public (`git check-ignore`: ios/.gitignore:4, android/.gitignore:96). There is no SQL and no database, so none of these is a finding.
- Step 7: the innerHTML sinks are unchanged from 0.6.8: src/main.ts:113 (`''`), src/ui/icons.ts:130 and src/ui/controls.ts:119,130 (constant SVG tables). None is fed by user data. The new splash.ts sets attributes only.
- Step 8: no login. `grep -rn "bcrypt|argon2|scrypt" src` is empty.
- I read src/worker/index.ts, feedback.ts and range.ts in full. The audit fix df53601/dd6909b changed feedback so that it validates before either limiter counts (feedback.ts:238-241), 2/60 s per IP, 3/60 s shared, and a 507 "full for today" on a KV failure (feedback.ts:243-250). Foreign-origin POST is 403 (:199). Body is capped at 8 KiB while streaming (:167-189). The record is built field by field with no IP (:102-111).

Findings: none CRITICAL or IMPORTANT.

## Lens: llm-security (not applicable)

- The runbook grep from the root hit only scratch paths containing "claude-501" in docs/reviews/audit-2026-09-25/probes/*, Pixi `generateTexture` at src/render/art.ts:1952, and minified Pixi in the gitignored shell bundles.
- Manifest grep for openai|anthropic|gemini|ollama|mistral|langchain|groq|replicate|together|@ai-sdk over package.json, trailer/package.json and src-tauri/Cargo.toml: exit 1 (no match). The n8n mailer (deploy/n8n-feedback-mailer.json, unchanged since 0.6.8) has only scheduleTrigger, httpRequest x3, splitOut, if and emailSend nodes, with no AI node. PROJECT.md: "no LLM calls". There is no AI feature, so the lens does not fire.

## Lens: real-data (applicable, closeout always; post-ship steps 6-8 apply, SHIPPED.md exists)

- Step 1: the marker grep from the root (with `grep -v test`) returned only the package-lock.json `7.21.0-placeholder-for-preset-env.2` (a real Babel version name) and minified Pixi in gitignored shell bundles. Re-run over src, the seven pages and public without the test filter: 0 lines.
- Step 2: `grep -rnE "from ['\"][^'\"]*(mocks|fixtures|__mocks__)/" src` = 0 lines.
- Steps 3-4 (restart / round trip): no server-side store is read back. Saves live in the player's IndexedDB/localStorage or the shells' app data file, and feedback KV is write-only from the Worker and drained by the mailer. For this ship, the round-trip concern is save compatibility across the rollback line. Probe (scratchpad/h069/rollback-probe.ts, vite-node 6.0.0): I loaded store/fixtures/store-tower.json with the 0.6.9 loader and ran 600 minutes. The resulting save had `stats.waitsCounted` 6490 and `firstWaitStart` on 75 sims. I serialized it with 0.6.9 and fed it to the 0.6.8 loader (`git archive ship-2026-09-28`): "0.6.8 reads 0.6.9 natural save: ok". A second copy also had a forced `firstWaitStart` and a bomb event carrying the new `floor`/`x`: "ok". SAVE_VERSION is 5 at both tags (src/sim/save.ts:47). The rollback rule in SHIPPED.md:41 therefore holds.
- Step 5: not re-traced. The audit tier did this at 0f05723, and the 0.6.9 stats change (avgWaitMinutes as a real running average) is DECISIONS 2026-09-28 line 137.
- Step 6: dev does not point at production. src/ui/feedback.ts:96-109 posts to the page's own origin whenever it is http(s). Only the shells, or a non-http origin, use the absolute production URL. `npm run dev` has no /api route, and `preview:worker` is wrangler dev (local KV by default).
- Step 7: no seed or reset scripts. The destructive commands found are deploy/deploy.sh:59-60 (pi3 snapshot pruning), deploy/README.md:95,98 (rollback swap) and scripts/* `rmSync` of temp Chrome profiles and the gitignored store/shots. None touches player data or KV. The n8n delete runs only after the "Email sent" IF node (unchanged).
- Step 8: no database schema. The save format is versioned, and the 0.6.9 loader tightening (room occupancy/booleans, car dir/passengers/calls, gameOver shape, firstWaitStart, waitsCounted) is guarded by tests (mutations SV1 and SV2 below go red).

Findings: none.

## Lens: testing (applicable, closeout always)

- Step 1: not run here by instruction; the orchestrator runs the full suite once after this sweep. Targeted baseline in the HEAD scratch copy: `npx vitest run tests/worker/feedback.test.ts tests/worker/range.test.ts tests/site/splash.test.ts tests/site/csp-parity.test.ts tests/site/versions.test.ts tests/site/ship-script.test.ts tests/sim/save-loader-fields.test.ts tests/ui/feedback.test.ts` gave 8 files, 145 passed, 3 skipped. The 3 skips are in versions.test.ts and ship-script.test.ts, which need git history or a git repo. The scratch copy is a `git archive`, so they skip themselves ("git or commit 0f05723 is not available here"). They run in the repo.
- Step 2: I checked the failure paths in PROJECT.md's Verification table rows that this diff touches. Feedback route: bad, oversized, 429 and 507 are in tests/worker/feedback.test.ts. Byte ranges: HEAD Content-Length is in range.test.ts. Clips/splash: reduced motion, data saver, a seen session, the 30 s cap, error, stall and play() rejection are in tests/site/splash.test.ts. Save and load: the new loader refusals are in save-loader-fields.test.ts. Watch keeping typed text (DECISIONS 2026-09-28 line 140) is in tests/ui/watch-keeps-work.test.ts.
- Step 3 mutations (scratch copy, restored after each; the harness asserts the find string occurs exactly once): 21 run, 19 killed, 2 survived.
  - Killed: F1 limiter before validation (2 red / 53), F2 KV failure answers 503 not 507 (2), F3 global limiter skipped (5), F4 foreign-origin POST allowed (1), F5 wrangler.jsonc shared limit 3 changed to 30 (tests/ui/feedback.test.ts, 1 red / 25), R1 HEAD loses Content-Length (3), S1 splash ignores video error (1), S2 no 30 s cap (1), S3 play() rejection ignored (1), S4 splash-init ignores reduced motion (1), S5 seen flag never set (1), W1 Watch discards typed feedback (1), W2 Watch keeps every panel (4), W3 late share blob not guarded (1), ST1 local copy dropped even when newer (1 / 220), SV1 firstWaitStart unvalidated (1), SV2 waitsCounted default dropped (1), P1 predeploy Cargo checksum mismatch not reported (1), V1 splash-init.js precached by the service worker (1).
  - Survived: ST2 (see the IMPORTANT below) and H1, the removal of the `/splash-init.js` no-cache rule from public/_headers. H1 is believed equivalent: every page under / already revalidates, and Workers static assets revalidate a file with no rule. That is not verified here. After the deploy, check with `curl -sI https://hundredstories.xyz/splash-init.js | grep -i cache-control`.
- Step 4 live failure probes: not run. The live site is 0.6.8, and this task allows only curl -I on / and /play/. The Worker failure paths are unit-tested above. Post-deploy commands are in the ship checklist.

Findings:

- [ ] IMPORTANT | testing | The clock floor for a save slot this page never read (src/game/storage.ts:204-208, `found = Math.max(found, Date.now())`) can be deleted and every test in tests/game still passes (220 passed). This branch exists for the 0.6.8 to 0.6.9 upgrade, where the IndexedDB copy was numbered in ones by the old build and there is no `:seq-high` device record yet. tests/game/storage-seq.test.ts:98 ("a link boot, then Open a saved file, then IndexedDB lost") seeds its saves through the 0.6.9 writer, which records `:seq-high`. So it never reaches this line. The code is correct today. What is unguarded is a data-loss path: without the line, a player on their first 0.6.9 session who opens the game by a Today's or friend link, then uses Open a saved file while IndexedDB is failing, gets the file saved to localStorage as seq 1. On the next healthy boot, the old IndexedDB tower (seq 57) wins and the opened file is dropped | Evidence: mutation ST2 survived (`npx vitest run tests/game` = 220 passed). A scratch probe seeded IndexedDB as 0.6.8 leaves it (`autosave` + `autosave:seq` 57, `hs.save.present`, no `:seq-high`), then did link boot, `txThrows`, `writeSave('{"imported":1}')`, healthy reload, `readSave()`. It passes on 1ce91ab and fails under ST2 with `expected '{"minute":9000}' to be '{"imported":1}'` | Evidence to close: a storage-seq test with that 0.6.8-shaped seed (no `:seq-high`), red with line 208 removed and green restored.

## Lens: production-readiness (applicable, closeout always)

- Step 1 forced-failure UX: every splash failure mode ends the overlay (mutations S1-S3 red), and the site stays usable underneath. A 30 s CSS failsafe covers the case where the module never runs (PROJECT.md Clips row, tests/site/splash.test.ts). A KV write failure gives the plain sentence "Feedback is full for today. Try again tomorrow." (src/ui/feedback.ts:36, status 507). The pi3 fallback has no /api route and the card shows its plain failure line (deploy/README.md:7-11).
- Step 2: wrangler.jsonc:10 `observability.enabled: true`. feedback.ts:248 has `console.error('feedback: KV write failed', err)`, and :143/:150 warn when a limiter is missing or fails. Player browsers report nothing (a choice in the privacy promise). Web Analytics counts visits only.
- Step 3 backup and restore: the only server-side data is feedback in KV. It is write-only from the Worker, read hourly by n8n, emailed to requests@hundredstories.xyz, then deleted. The mailbox is the durable copy, and there is nothing in KV worth restoring. Saves are on players' devices. No restore test applies (see the ship checklist).
- Step 4: `git ls-files` gives package-lock.json, src-tauri/Cargo.lock and trailer/package-lock.json. `grep -nE '"[\^~]' package.json trailer/package.json` exit 1. Every Cargo.toml dependency is `=x.y.z`. No lockfile is modified or unstaged.
- Step 5 exposure: HTTPS only, HSTS, http to 301. No ports of its own on Cloudflare. The pi3 fallback CSP now matches public/_headers (deploy/nginx.conf:60, tests/site/csp-parity.test.ts). Matches PROJECT.md "Where it will live".
- Step 6 deploy story: scripts/ship.sh (branch guard; app-only Cargo bump with a 1-line diff check; `cargo metadata --locked --offline` before the commit; deploy exit status captured through a temp file; tag and push only after a good deploy; recovery commands printed on failure; tested by tests/site/ship-script.test.ts in the repo), deploy/cloudflare-pages.md (updated for the Worker and the Cargo gate) and deploy/README.md (pi3).
- Step 7: no paid services. The public write /api/feedback has a honeypot, validate-before-count, 2/60 s per IP, 3/60 s shared, and an 8 KiB cap. Not verified live: the hammer test (POST forbidden to this sweep). The unit tests assert both 429s and the 507.
- Scratch build at 1ce91ab: `npm run build` gave "precache 27 entries (1206.55 KiB)". `grep -o` in dist/sw.js for trailers, clips, splash, .mp4 and .webp: all 0. dist/splash-init.js was emitted (922 bytes) and is referenced once in dist/index.html. dist/trailers holds site-splash.mp4 and no site-intro-hero.mp4. `node scripts/predeploy-check.mjs` gave "predeploy check: ok", exit 0. The secret-pattern grep over this dist gave 0. `npx wrangler deploy --dry-run` (4.135.0) read 75 assets and shows the bindings FEEDBACK KV, FEEDBACK_LIMIT (2 requests/60s), FEEDBACK_GLOBAL (3 requests/60s) and ASSETS, then "--dry-run: exiting now."
- Cargo.lock repair (d0a7da1): I checked all ten crates restored from the bad 0.6.6 global replace against the crates.io API. block2 0.6.2, cssparser-macros 0.6.1, jsonptr 0.6.3, objc2 0.6.4, raw-window-handle 0.6.2, socket2 0.6.5, string_cache_codegen 0.6.1, toml_datetime 0.6.3, window-vibrancy 0.6.0 and writeable 0.6.4: every lock checksum equals the registry checksum, and none is yanked. `cargoLockCheck` gives mismatched 0, unverified []. `cargoMetadataCheck()` gives ok. zlib-rs 0.6.8 (Cargo.lock:4673) is the dependency that shares the app's number, and the new awk bump leaves it alone.

Findings:

- [ ] ADVISORY | production-readiness | A scripted sender can spend the free-plan KV daily write cap and close feedback for every player until the daily reset. The limits allow 3 stored posts a minute shared, or 4,320 a day, against the roughly 1,000/day cap that wrangler.jsonc:27-32 names. Two addresses fill the shared bucket (wrangler.jsonc:25). That means about 5.5 h of junk, then the 507 line for everyone, plus up to about 1,000 junk mails into requests@ through the hourly mailer. Whether the rate-limit binding counts per Cloudflare location, which would weaken the "global" bucket further, is unverified (audit lane J-S1). This is bounded and cannot bill, and the code comment documents the design | Evidence: wrangler.jsonc:23-35, src/worker/feedback.ts:155-161,243-250 | Evidence to close: Matt's call recorded in DECISIONS.md (accept as designed), or a daily counter (for example a KV or Durable Object count checked before the put) with a test.
- [ ] ADVISORY | production-readiness | Records that will be stale at the 0.6.9 ship. SHIPPED.md:28 still says "run_worker_first unset", 5 posts a minute per IP, 2 shared, "2,880 a day", and 503 (now `/trailers/*` run first, 2/3 a minute, 507, a cap of about 1,000). SHIPPED.md:41 repeats "so rolling back keeps every player's tower" twice. SHIPPED.md:77 says "there is no beacon (a choice Matt made)", but Web Analytics ships on every site page since 2026-09-26 (dist/index.html and dist/play/index.html each carry cloudflareinsights). .itworks/PROJECT.md:19,24 still say TypeScript 5, Vite 7 and "Cloudflare Pages ... domain not bought yet" (package.json has typescript 7.0.2 and vite 8.3.0, and the site has been live on Workers since 2026-09-19) | Evidence: the lines cited, wrangler.jsonc:17,33-35, feedback.ts:31 | Evidence to close: the 0.6.9 SHIPPED.md rewrite and PROJECT.md lines 19 and 24 corrected.

## Dependency vetting (full manifests)

No npm manifest or npm lockfile changed since 0.6.8. `git diff --stat ship-2026-09-28 HEAD` over package.json, package-lock.json, trailer/package.json, trailer/package-lock.json, src-tauri/Cargo.toml, capacitor.config.ts, the android gradle files and ios CapApp-SPM/Package.swift is empty, except src-tauri/Cargo.lock (+10/-10, the repair above). I re-vetted everything anyway. `npm view` resolved every direct entry at its pinned version, and each repository is the expected official org.

| Dependency | Where | Pinned exact | Lockfile committed | Registry / repo | Since 0.6.8 |
|---|---|---|---|---|---|
| @capacitor/android, core, ios, cli 8.5.2 | root deps/dev | yes | package-lock.json yes | ionic-team/capacitor | unchanged |
| @capacitor/filesystem 8.1.3, haptics 8.0.2 | root deps | yes | yes | ionic-team | unchanged |
| @capacitor/preferences 8.0.1, share 8.0.2, splash-screen 8.0.2, status-bar 8.0.3 | root deps | yes | yes | ionic-team/capacitor-plugins | unchanged |
| @tauri-apps/api 2.11.1, cli 2.11.5 | root | yes | yes | tauri-apps/tauri | unchanged |
| @tauri-apps/plugin-dialog 2.7.3, plugin-fs 2.5.2 | root deps | yes | yes | tauri-apps/plugins-workspace | unchanged |
| pixi.js 8.21.0 | root deps | yes | yes | pixijs/pixijs | unchanged |
| @cloudflare/workers-types 5.20260927.1 | root dev | yes | yes | cloudflare/workerd | unchanged |
| typescript 7.0.2 | root dev | yes | yes | microsoft/TypeScript | unchanged |
| vite 8.3.0, vite-plugin-pwa 1.3.0, vitest 5.0.1 | root dev | yes | yes | vitejs, vite-pwa, vitest-dev | unchanged |
| wrangler 4.135.0 | root dev | yes | yes | cloudflare/workers-sdk | new advisory on its transitive undici 7.29.0 (below) |
| uuid 11.1.1 | root override | yes | yes | uuidjs/uuid | unchanged |
| @remotion/cli, remotion 4.0.529; react, react-dom 19.2.0; @types/react 19.2.2; typescript 5.9.3 | trailer/ | yes | trailer/package-lock.json yes | remotion-dev, facebook, DefinitelyTyped, microsoft | unchanged |
| tauri-build =2.6.3, tauri =2.11.6, tauri-plugin-fs =2.5.2, tauri-plugin-dialog =2.7.3, serde =1.0.229, serde_json =1.0.151, steamworks =0.13.1 (optional) | src-tauri/Cargo.toml | yes (=) | Cargo.lock yes | crates.io (vetted at 0.6.8) | lock repaired: ten transitive crates back to their true versions, checksums match crates.io |
| capacitor-swift-pm exact 8.5.2 plus local plugin paths | ios/App/CapApp-SPM/Package.swift | yes (exact) | Package.resolved tracked | ionic-team | unchanged |
| android gradle 8.13.0, google-services 4.4.4, androidx via variables.gradle | android/ | yes | no gradle lockfile (as at every earlier ship) | Google | unchanged |

npm audit:
- root `npm audit`: 3 moderate, one advisory. GHSA-3wwx-pv8p-q78v: undici 7.28.0 to <7.29.1, a DoS through WebSocket permessage-deflate. The chain is undici 7.29.0 (package-lock.json:8876) < miniflare < wrangler 4.135.0. The advisory was published 2026-09-28T21:42:37Z (`gh api /advisories/GHSA-3wwx-pv8p-q78v`), after the 0.6.8 sweep, and that is the only reason it is new. `npm audit fix --force` proposes wrangler 4.101.0, a downgrade. The patched undici is 7.29.1 (2026-09-04) or 7.30.0.
- root `npm audit --omit=dev`: found 0 vulnerabilities. Nothing shipped to players is affected.
- trailer `npm audit`: found 0 vulnerabilities.
- Cargo: glib 0.18.5 (Cargo.lock:1084) is carried and open pending Matt's dismissal of Dependabot alert 2. crates.io today: tauri max_stable 2.12.0 still requires gtk ^0.18, so it is still unreachable by a cargo update.

Finding:

- [ ] ADVISORY | security-auth | undici 7.29.0 under wrangler 4.135.0 (dev and deploy tool only) matches GHSA-3wwx-pv8p-q78v (moderate, WebSocket decompression DoS). It is not in any shipped bundle (`--omit=dev` = 0). PROJECT.md Definition of done 9 says "npm audit clean", and root `npm audit` is no longer clean. Expect a Dependabot alert on the GitHub mirror after the push | Evidence: `npm audit` output (3 moderate: undici, miniflare, wrangler), package-lock.json:8876-8879 | Evidence to close: `npm audit` = 0 at the root. Either add `"undici": "7.30.0"` beside the existing uuid override with a regenerated lockfile, or a wrangler release whose miniflare takes undici >=7.29.1, or Matt accepts it as dev-only in DECISIONS.md.

## History audit summary

- gitleaks over all refs: 479 commits scanned, no leaks. The runbook grep over `git log --all -p`: 100 lines, all the `sk-` screenshot-name family, with 0 lines from any other pattern.
- Tracked key or env files: only deploy/.env.example (a host name).
- Refs: main, audit-fixes-2026-09-25 (local and origin), github/main. Tags newest first: ship-2026-09-28, ship-2026-09-27-h, -g, -f, -e.
- Commits since ship-2026-09-28: 24 (0f05723 to 1ce91ab), all on main. Binary churn: public/trailers/site-intro-hero.mp4 deleted (772,470 B) and public/trailers/site-splash.mp4 added (1,162,439 B). No other binaries.
- Nothing to rotate.

## Findings summary

- CRITICAL: 0
- IMPORTANT: 1. Testing: the storage clock-floor branch (src/game/storage.ts:208) guards the 0.6.8 to 0.6.9 upgrade data-loss path and has no test that fails without it.
- ADVISORY: 3. The KV daily cap can be spent by one scripted sender. SHIPPED.md and PROJECT.md lines are stale. undici moderate advisory in the dev-only wrangler chain.
- Carried, open, not new: the glib Dependabot alert 2, pending Matt's dismissal.

Not applicable:
- llm-security: no AI anywhere.
- security-auth steps 4-5 and 8: no protected routes, roles or login.
- real-data step 3 restart test: no server-side read-back store.
- real-data step 8: no database schema.
- The live hammer test and the live Worker failure probes: POST was not allowed, and the live site is 0.6.8.

## Questions for the owner

- /trailers/* running the Worker first (DECISIONS 2026-09-28) now covers the splash. Every landing visitor who is not on reduced motion or save data fetches /trailers/site-splash.mp4 through the Worker, often as more than one Range request (Safari). On the free plan (wrangler.jsonc:27), every one of those requests counts against the daily Worker request allowance. It is the same allowance /api/feedback uses. A viral day is the likeliest way to hit it. When it runs out, the splash ends at once (the error path, mutation S1) and feedback fails with the card's plain line. This is a settled decision, so it is not a finding. It is a "what breaks first" input.

## Ship checklist inputs

- Versioning: 0.6.8 to 0.6.9 is a patch under the 2026-09-18 rule, and the ship is pre-authorized (DECISIONS 2026-09-28 line 139). Every stamp is 0.6.8 today: package.json, package-lock (top and root), tauri.conf.json, Cargo.toml, the Cargo.lock app block (Cargo.lock:1279-1280), ios MARKETING_VERSION x2, android versionName, and versionCode 608. ship.sh bumps each one. The only other 0.6.8 in Cargo.lock is zlib-rs, which the new bump skips.
- Backup and restore: KV holds player feedback only transiently. It is write-only from the Worker, read hourly by n8n, emailed to requests@hundredstories.xyz (M365), then deleted. The mailbox is the record, so a KV restore does not apply, and nothing on Cloudflare needs backing up. Saves live on the player's device, and export and import is the player's backup. No server restore test applies.
- Deploy docs present: scripts/ship.sh (the deploy path, tested by tests/site/ship-script.test.ts), deploy/cloudflare-pages.md, deploy/README.md (pi3 fallback, static only), and SHIPPED.md "How to deploy an update" (line 28 needs the refresh named above).
- Exposure: unchanged. HTTPS-only custom domains, HSTS, workers_dev and preview_urls off, and a CSP identical on Cloudflare and the pi3 nginx. The Worker surface is still /api/feedback and /trailers/* only.
- SHIPPED.md "What breaks first" (lines 77-79): the PixiJS/CSP paragraph and the IndexedDB paragraph are still right. Its sentence "there is no beacon (a choice Matt made)" is wrong since 2026-09-26. Consider adding, as a second or third item, the free-plan Worker request allowance (the splash and clips through run_worker_first, plus feedback) under a traffic spike. The sign would be the splash ending instantly and feedback failing, and Workers observability would show the errors.
- Rollback: rehearse against ship-2026-09-28 (0.6.8). Save compatibility is proven above: a 0.6.9 save, including every new optional field, loads on 0.6.8. Rolling back restores the hero trailer and site-intro-hero.mp4, removes the splash, and returns the pre-audit feedback limits (5/2, limiter before validation) and the pre-fix storage sequencing. The new `:seq-high` localStorage key is inert on 0.6.8.
- Re-run after the deploy (the live site is 0.6.8 now):
  - `curl -sI https://hundredstories.xyz/ | grep -iE 'strict-transport|content-security|x-content|referrer|permissions'` and the same for `/play/`
  - `curl -sI http://hundredstories.xyz/ | head -1` (expect 301)
  - `curl -sI https://hundredstories.xyz/splash-init.js | grep -iE '^HTTP|cache-control'` (expect 200, no-cache)
  - `curl -s -o /dev/null -D - -H 'Range: bytes=0-99' https://hundredstories.xyz/trailers/site-splash.mp4 | grep -iE '^HTTP|content-range|content-length'` (expect 206, `bytes 0-99/1162439`, 100)
  - `curl -sI https://hundredstories.xyz/trailers/site-splash.mp4 | grep -iE '^HTTP|content-length|accept-ranges'` (expect 200, 1162439, bytes)
  - `curl -sI https://hundredstories.xyz/trailers/site-intro-hero.mp4 | head -1` (expect 404)
  - `curl -s -D - -o /dev/null https://hundredstories.xyz/api/feedback | grep -iE '^HTTP|allow'` (expect 405, allow: POST)

## Files read

Read in full:
- The five lens runbooks, dependency-vetting.md, secret-patterns.grep and injection-patterns.grep.
- .itworks/PROJECT.md, .itworks/MAP.md, and .itworks/DECISIONS.md lines 121-140 (plus a grep of 1-100 for versioning, sweep and beacon rules).
- SHIPPED.md lines 1-95 (every section through the 0.6.8 ship history).
- .itworks/REVIEWS.md: the 0.6.8 closeout section, the playtest checkpoint, and the audit 2026-09-28 lines on the Worker.
- src/worker/index.ts, feedback.ts and range.ts; wrangler.jsonc; public/_headers; public/splash-init.js; src/site/splash.ts.
- scripts/ship.sh (lines 1-90 plus the rest via the tag diff) and scripts/predeploy-check.mjs (via the full tag diff).
- package.json, trailer/package.json, src-tauri/Cargo.toml, and tests/game/storage-seq.test.ts.

Read in part (application logic is the audit tier's):
- src/game/storage.ts and src/sim/save.ts (the tag diff).
- src/ui/feedback.ts (URL chooser and status constants).
- src/ui/ui.ts, panels.ts and feedback.ts (the 1ce91ab diff).
- index.html (the tag diff) and privacy/index.html (the analytics and feedback paragraphs).
- deploy/nginx.conf (map and CSP) and the deploy doc diffs.
