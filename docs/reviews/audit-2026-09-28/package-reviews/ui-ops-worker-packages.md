# Review: UI and share, ops, Worker and audio fix packages (2026-09-28)

Scope: tier checkpoint on three committed packages: 59ad253 (UI and share), d0a7da1 (ops) and df53601 (Worker, feedback, notifications, audio). The task named the UI commit as 2b1fc9c. That commit is on no branch. It is an earlier cut of the UI package: 59ad253 plus src/ui/feedback.ts, src/ui/notify.ts and their two test files, and those four files are byte-identical to df53601's. Reviewing 59ad253 and df53601 therefore covers all of 2b1fc9c. Covered: design verify against verify-E, verify-AH lane H, verify-GJ and verify-D S4, plus the production-readiness, security and testing lenses. Not covered: any browser or device run, the live site (no curl, no /api/feedback call), and Cloudflare documentation (not fetched). ui.ts (2,110 lines) and panels.ts (2,007 lines) were read at every changed hunk and every function those hunks call, not end to end. Every other touched file was read in full. Host: arm64 (uname -m).

All probes ran in a pristine scratch export of df53601 at scratchpad/co-df53601. It was diffed against git archive after the mutation runs and came back clean. The repository was never touched.

## Findings

### F1. The KV daily write cap is still unguarded, and the shared limit went from 2 to 6 a minute (IMPORTANT)
- **Where:** wrangler.jsonc:23-31, src/worker/feedback.ts:148-154 and :236-241, src/ui/feedback.ts:32.
- **Input:** One address posts two valid messages every minute. Or three addresses post two a minute each.
- **Wrong outcome:**
  - Probe: one address gives `200,200,429×8` and honest senders still get 200, so the one-address lockout is fixed.
  - Three hostile addresses in one minute give `200×6, 429×6` and honest senders get `429,429,429`. The J-S1 lockout is back with three addresses instead of one.
  - The daily arithmetic is the bigger problem. DECISIONS 2026-09-27 (line 119) settles "all on the Cloudflare free plan". The verify-GJ note gives the KV free tier as 1,000 writes a day. That matches Cloudflare's published free limits as I know them, but I did not fetch the docs.
  - At 2 a minute, one address writes 2,880 a day and reaches 1,000 in 500 minutes. Three addresses at 6 a minute reach it in 167 minutes. After that every `put` fails and the Worker returns 503. The card then says "Could not send. Try again in a minute" for the rest of the UTC day, which is a refusal with the wrong reason.
  - Spec J-S1 fix item 2 required "the global figure chosen against the confirmed KV write cap". The verifier's note singles out this whole-day 503 as the reason the fix must change the limits and not only the order. The commit instead tripled the shared rate, and its comment at :27 says the cap was never checked.
  - Unverified here: whether the rate-limit binding counts per Cloudflare location. If it does, "global" is per location and attackers in several locations multiply the rate.
- **Reproduce:** `npx vitest run --config scratchpad/uow/probes/probe.config.mjs --disableConsoleIntercept worker` from scratchpad/co-df53601. The probe uses windowed fake limiters (2 per address, 6 shared) and a counting KV. Output lines: "one hostile ... honest 200,200,200 puts 5", "three hostile ... honest 429,429,429 puts 6", "writes/day 2880 / 8640".
- **Fix spec:**
  - The binding's periods are 10 or 60 seconds only. Even 1 per 60 s is 1,440 writes a day, above 1,000, so no limiter setting alone can hold the day. A daily bound needs a counter: one Durable Object, or a date-keyed counter checked before the put. Alternatively, confirm the plan's real cap and record it in DECISIONS.
  - Map 503 (and 429 once the day is spent) to a sentence without "try again in a minute", for example "Feedback is closed for today. Email requests@hundredstories.xyz."
  - Test: a probe like the one above, with a counting KV that throws after N puts. It must show the new sentence and must not lock out honest senders before the cap.

### F2. The predeploy allowlist fails a genuine crate at 0.7.4; a checksum check against the registry cache would replace it (ADVISORY)
- **Where:** scripts/predeploy-check.mjs:27-57. It runs inside `npm run deploy`, which ship.sh:93 calls after the release commit.
- **Input:** Ship the app as 0.7.4, 0.7.6 or 0.8.0.
- **Wrong outcome:**
  - `cargoLockProblems` flags crates that genuinely sit at those versions:
    - 0.7.4: libloading 0.7.4.
    - 0.7.6: num_enum and num_enum_derive 0.7.6.
    - 0.8.0: bit-set, bit-vec and ctor 0.8.0.
  - The deploy fails after the release commit with "Cargo.lock has dependencies at the app version: libloading 0.7.4 ...". That wording invites someone to "repair" a correct crate.
  - The list will need a hand edit at every such number. A `cargo update` that moves a listed crate to a new checksum also fails the guard.
  - Would a checksum check replace the list? Yes. On this host, all 446 checksummed lock entries have a `~/.cargo/registry/cache/index.crates.io-*/<name>-<version>.crate` file whose sha256 equals the lock checksum. That covers libloading-0.7.4 and zlib-rs-0.6.8. The rewritten entries (objc2 at 0.6.6) have no matching cache file.
  - A list-free option that needs no cache: compare against `git show HEAD:src-tauri/Cargo.lock`. A non-app block whose version changed while its checksum did not is a rewrite.
- **Reproduce:**
  - `node scratchpad/uow/guard.mjs`. It prints `current []` and the ten crates for the parent lock, then `0.7.4 [libloading ...]`, `0.7.6 [num_enum, num_enum_derive]` and `0.8.0 [bit-set, bit-vec, ctor]`.
  - The cache check was a shasum loop over the lock pairs: `ok 446 missing 0 bad 0`.
- **Fix spec:**
  - Replace GENUINE_AT_APP_VERSION with the checksum or HEAD-diff rule. A missing cache file means "cannot verify, run cargo fetch", not a failure.
  - Run the check with NEW before the release commit.
  - Keep the versions.test.ts cases on the rule.

### F3. The elevator panel's refusal lines repeat one sentence per car on every untouched elevator (ADVISORY)
- **Where:** src/ui/panels.ts:834 (`setRefusal(row.why, ...)`), with carStepRefusals and refusedLines at :898-927.
- **Input:** Open any new elevator, or an elevator with 8 cars and no custom ranges.
- **Wrong outcome:**
  - A 1-car elevator always shows two lines: "Remove car: An elevator needs at least one car." and "This car already reaches the top and bottom of the elevator."
  - 8 cars show 9 lines, eight of them the same sentence.
  - These describe the default state, not a refusal the player met. On a phone sheet they push the car controls down.
  - The refusal text itself holds up: every reason is plain US English with no code and no day number ("Extend up and Extend down: Elevators can span only 30 floors."). The mechanism (visible text rather than aria-disabled) is the spec's own alternative.
- **Reproduce:** `... --disableConsoleIntercept elev`. It prints `cars 1 lines 2 [...]` and `cars 8 lines 9 [...]`.
- **Fix spec:**
  - Show the per-car line only when the car has a custom range or is busy. Or say "Each car already reaches every floor." once.
  - Update the expectation in elevator-refusals.test.ts ("says so once" currently pins two identical lines).

### F4. Guards the lane H spec asked for were not added, and one doc is stale (ADVISORY)
- **Where:** tests/site (no nginx/_headers equality test), scripts/ship.sh (no script test, no `cargo metadata --locked --offline` step), deploy/cloudflare-pages.md.
- **Input:** A future CSP edit to only one file, a regression in ship.sh's status capture, or a lock that resolves wrongly.
- **Wrong outcome:**
  - Nothing fails. The two CSPs are identical today, but only a comment keeps them so, and that is exactly how S3 arose.
  - The ship.sh fix works (see Holds), but no test runs it.
  - cloudflare-pages.md still describes the predeploy check as a dist-only gate and does not mention the Cargo.lock check.
  - It also says "every other request ... never runs the Worker", but a path with no matching asset does run it (index.ts:1-5).
- **Reproduce:** `git grep -n nginx HEAD -- tests` finds only fonts.test.ts:78, which checks font-src and style-src only.
- **Fix spec:**
  - A test asserting full-policy equality between public/_headers and deploy/nginx.conf.
  - tests/site/ship-script.test.ts built on the harness in scratchpad/uow/ship (stub npm, bare remotes, failing deploy → exit 1, no tag, no push).
  - The cargo step where cargo exists.
  - Update both doc sentences.

### F5. The ship.sh failure message does not name the tag to create by hand (ADVISORY)
- **Where:** scripts/ship.sh:96-101.
- **Input:** A deploy that fails, then the "run npm run deploy and tag and push by hand" path.
- **Wrong outcome:** $TAG (for example ship-2026-09-28-b) is computed but not printed. Recomputing it by hand risks a wrong suffix. Everything else in the message is accurate: nothing was tagged or pushed, and the live site is unchanged.
- **Reproduce:** `DEPLOY_FAIL=3 /bin/dash scripts/ship.sh 0.6.9 t-3` in scratchpad/uow/ship/run-dash-3/repo prints the message without the tag.
- **Fix spec:** Print `git tag $TAG && git push origin main --tags && git push github main --tags`.

### F6. Test gaps found by mutation and by the missing desktop test (ADVISORY)
- **Where and what survives:**
  - The desktop dialog import (panels.ts:1631-1638) has no test. I wrote it: scratchpad/uow/probes/tauri-import.vt.ts sets `__TAURI_INTERNALS__` and mocks importSaveWithDialog. It passes (`addresses ["/play/"]`, a refused file leaves the address alone). Deleting `ctx.syncAddress?.()` at :1635 fails it, so the code is right and only the test is missing.
  - watch.ts:191: mutating it to clear on any pointer still passes all 27 watch tests. My two-finger probe (twofinger.vt.ts) passes on the real code (`A down true, B down false, B up false, A up true`) and fails on that mutant (A's release not swallowed).
  - ui.ts:955-956: removing the tower-switch reset still passes tests/ui (594 tests).
  - audio.ts:649: dropping `destroyed` from resumeGuarded still passes tests/audio (113 tests).
  - drums.ts:195: dropping the finite guard passes. So does clampLevel's guard, but that one is harmless because paramValue and readLevel catch NaN too.
- **Reproduce:** `node scratchpad/uow/mut.mjs <checkout> '<name>'` (29 mutants). Every other mutant is caught by a named test. The destroyed flag in suspendGuarded is caught only as a hang: vitest times out at 90 s, because destroy then ping-pongs suspend and resume.
- **Fix spec:** Commit the tauri-import and two-finger probes as tests, and add a tower-switch count test and a destroy-during-resume test.

### F7. The keyboard help still says "(pause, 1x, 2x, 4x)" (ADVISORY)
- **Where:** src/ui/keys.ts:138.
- **Input:** Open the keys help.
- **Wrong outcome:**
  - E1 S7's spec was to build the tip and the keys line from the constants. The Watch tip was done (watch.ts:44); the keys line was not.
  - It stays symbol shorthand in player text, against DECISIONS 2026-09-24 (plain words, a reader of 8 to 10).
  - The new paused chip, "Paused. Nights run 8 times as fast", is plain.
- **Reproduce:** `grep -n "1x, 2x" src/ui/keys.ts`.
- **Fix spec:** Use words built from SPEED_STEPS ("paused, normal, two times, four times as quick"), matching the speed buttons' wording.

## Holds (verified; nothing to fix)

### UI and share
- **Refusal count:**
  - A refusal no longer counts toward the warning toast; the Watch reset and the tower-switch reset work.
  - A real problem is not lost. Watch never toasted warn lines by design, the News panel keeps every line, and the change only stops them inflating the first toast afterwards.
  - The `lastNoticeText` skip can drop a real warn line from the count only when its text equals the last notice, word for word, and the line still toasts itself as the newest.
- **Office rent:** the room panel figure is `officeQuarterRent(room, evaluateRoom(world, room, 0))`, the same call quarterForecast makes (economy.ts:91). A vacant office says "No rent until leased".
- **Cash pill:** the key adds an odd-multiplier rent fingerprint. One rent change always changes it, so the pill cannot stall. The cost is O(rooms) per update; the forecast stays at most once per key.
- **VIP card:** item 4 is false after the bomb on the seed-6 path (vip.test.ts). The notice phase is unchanged.
- **Guide:**
  - Step 1 says "put it on floor 2", so a player following the guide still reaches "Add an elevator". It is skipped only when stairs or escalators already reach the office.
  - An office built on floor 1 now passes step 2 without any connector (guide.vt.ts prints step 3). This is correct, since workers walk there.
- **Quiet labels:** the wheel listener is `{capture, passive: true}`.
- **Import address:** syncAddress runs after a successful import on all three paths: the menu input, the game-over card and the Tauri dialog. The Tauri path was proven by my test.
- **Share:** "1 floor · 1 person", and "I just started a tower" at 0 floors.

### Ops
- **ship.sh:**
  - Under /bin/sh (bash 3.2 in POSIX mode here; /private/var/select/sh points to bash) and /bin/dash, a deploy exit of 3 gives script exit 1, no tag and no push to either bare remote. Exit 0 tags and pushes both.
  - A feature branch or a detached HEAD is refused ("ship from main, not HEAD").
  - Bumps 0.6.8→0.6.9→0.7.0 change exactly one line in Cargo.toml and one in Cargo.lock. zlib-rs 0.6.8, serde_spanned 0.6.9 and keyboard-types 0.7.0 stay untouched.
- **Cargo.lock:** exactly ten version lines changed against the parent, and none against 0.5.4 except the app line. `~/.cargo/bin/cargo metadata --locked --offline` (cargo 1.98.1) exits 0 on a scratch copy.
- **CSP and docs:** the nginx.conf CSP is identical to public/_headers (node probe: true). The new doc text names only the pi3 ssh alias.

### Worker and audio
- **Validation before the limiters:** an oversize body (declared, or chunked with no length) gets 413 with 0 limiter calls and 0 puts. Honeypot, invalid JSON and text/plain spend nothing either.
- **Limits:** math for one hostile address and for three is in F1.
- **Client 413:** the card shows its own sentence.
- **notify-sw:** with no window, or with only landing and clips tabs open, it opens /play/. The native shells ship no service worker (vite.config.ts:22-24).
- **Update notice:** a first install stays silent. With a null start controller no controllerchange listener is attached, and a claimed first worker is measured against null.
- **HEAD Content-Length:** asserted in range.test with a fake binding. Whether workerd keeps a user-set Content-Length on a null-body HEAD response is unverifiable offline; a `curl -sI .../trailers/site-intro.mp4` after the next deploy settles it.
- **Audio:**
  - Every bus, filter and voice write that reads mood or settings goes through paramValue or a finite source. clamp, easeMood and venueFillFor make the mood finite at its source; the rest read constants or the loader-checked seed, stars and minute.
  - No resume after destroy (sleep plus the flag). No AudioContext while Sound is off (wake requires settings.on).
  - resolvedThreat leaves the ended incident out, so a fire under a paid ransom re-ducks with no start cue and later plays its release.

## Questions for the owner
- Rate limit scope: if the Workers rate-limit binding counts per Cloudflare location, is a per-location "shared" bucket acceptable, or should feedback's daily bound live in one place? It bears on F1's fix.

## What the tests do not prove
- tests/worker: nothing models the KV daily cap or a 503 path's wording (F1).
- tests/site/versions.test.ts: it proves the guard catches a global replace, not that it accepts future genuine crates (F2).
- tests/ui: no Tauri import test, no two-finger test, no tower-switch count test (F6).
- tests/worker/range.test.ts: the HEAD length is proven against a fake binding only.

## Probes run
- The allowed suite once (tests/ui tests/share tests/worker tests/audio tests/site/versions.test.ts): 66 files, 809 tests passed.
- scratchpad/uow/ship: the ship.sh harness (sh and dash, pass and fail, branch guard, a second bump).
- `cargo metadata --locked --offline` on a scratch copy of src-tauri.
- guard.mjs and the registry-cache shasum loop.
- Probes: worker.vt.ts, tauri-import.vt.ts (with a mutation), twofinger.vt.ts (with a mutation), elev.vt.ts, guide.vt.ts.
- mut.mjs: 29 mutants; survivors listed in F6.
