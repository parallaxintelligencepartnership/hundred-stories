# Lane J: The Worker, feedback and notifications at 0f05723

Probes live in scratchpad/audit-2026-09-28/probes-J/ (worker-probe.ts, notify-probe.ts). Mutations ran in scratchpad/mut-J, a copy of the tree outside the repo. Arch: arm64 (uname -m).

## Suspicions

### S1. One sender can shut feedback for every player, and the card tells them to "try again in a minute" (proposed: IMPORTANT)
- Where: src/worker/feedback.ts:148-151 and :214 (both limiters run before the content-type check at :216 and before validation at :231); wrangler.jsonc:26-27 (per IP 5/60 s, global 2/60 s); src/ui/feedback.ts:32 and :258
- Input: from one IP, two `POST /api/feedback` a minute with any junk (`Content-Type: text/plain`, empty body). That is under the per-IP limit of 5, and each request spends one token of the shared "global" bucket before it is refused as 400.
- Wrong outcome: every real player's post in that minute gets 429, and the card shows "Could not send. Try again in a minute, or email ...". A retry never works while the sender keeps going, so the reason shown is wrong. Because the per-IP limit (5) is above the global one (2), a single client with no botnet and no valid body holds the lock for good. Two related points need checking against Cloudflare's docs, since I could not reach them offline. (a) The comment at wrangler.jsonc:23-24 says the global bucket "holds KV writes to 2,880 a day at most" and keeps them "under the free tier's daily cap" (feedback.ts:14-15). The KV free tier is 1,000 writes a day (developers.cloudflare.com/kv/platform/pricing/), so 2/min does not keep writes under the cap. Once a spammer with valid bodies has made 1,000 writes, every put throws and the route answers 503 until 00:00 UTC. (b) Rate-limit binding counters are per Cloudflare location (developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/), so the "global" key is not global.
- Reproduce: `cd <checkout> && npx vite-node@6.0.0 <scratch>/probes-J/worker-probe.ts`. The line "real player after 2 junk posts from 1 IP" prints `429 ... slow down`, buckets `{ 'ip:6.6.6.6': 2, 'g:global': 3, 'ip:9.9.9.9': 1 }`, puts 0. The limiter fakes count exactly the wrangler.jsonc figures.

### S2. A notification tap focuses a landing or clips tab instead of opening the game (proposed: ADVISORY)
- Where: public/notify-sw.js:9-10 (`includeUncontrolled: true` returns every same-origin window, then `|| windows[0]`)
- Input: the player closes the game tab and leaves https://hundredstories.xyz/ (or /clips/) open. An alert notification is still in the OS notification centre, and the player taps it.
- Wrong outcome: the landing tab is focused and gets an `hs-notification` message it ignores. The game is not opened, because `openWindow('/play/')` only runs when no window of the origin exists at all. The invariant is to focus an existing *game* tab, else open one.
- Reproduce: notify-probe.ts runs the real notify-sw.js source against fake `self.clients`. "tabs: landing only" prints `focus https://hundredstories.xyz/`, then the post, and no `open`.

### S3. An update that activates while the game boots is never announced (proposed: ADVISORY)
- Where: src/ui/notify.ts:414-420 (follows only `registration.installing` and `.waiting`, never `.active`); src/main.ts:156 (the watch is attached last, after `game.load()` and `createRenderer`); vite.config.ts:113 (`registerType: 'autoUpdate'`, which sets `skipWaiting` and `clientsClaim`, node_modules/vite-plugin-pwa/dist/index.js:874-876)
- Input: a deploy lands. The player opens /play/, and the page is served by the old worker. The navigation update check installs the new worker, which skips waiting and claims the page before boot reaches `watchUpdates`. IndexedDB load and renderer init take long enough for this to happen.
- Wrong outcome: `installing` and `waiting` are both null, so `told` stays 0. There is no "A new version is ready" toast and no notification. The hourly `update()` then finds nothing newer, so an open tab keeps the old bundle with no notice until the next navigation. The same result happens if the new worker is still `activating` when the watch attaches.
- Reproduce: notify-probe.ts prints `update installed+claimed before watch attached: told = 0` and `update activating (not yet claimed) when watch attached: told = 0`.

### S4. HEAD on /trailers/* loses Content-Length (proposed: ADVISORY)
- Where: src/worker/range.ts:45 and :65 (`copyHeaders` deletes Content-Length, and the pass-through path does not set it back)
- Input: `HEAD /trailers/site-intro.mp4`, with or without Range.
- Wrong outcome: 200 with no Content-Length. Before run_worker_first, the assets layer answered HEAD with the size. The non-Range GET goes through the same path. In node it also has no length, but workerd may take the length from the stream, so that half is not proven.
- Reproduce: worker-probe.ts lines "HEAD + Range", "HEAD no Range" and "GET no Range" print `CL=null`. Live check: `curl -sI https://hundredstories.xyz/trailers/site-intro.mp4 | grep -i content-length`.

### S5. A 400 or 413 also says "Try again in a minute" when the same body can never pass (proposed: ADVISORY)
- Where: src/ui/feedback.ts:150 and :258; src/worker/feedback.ts:21 and :220-222
- Input: the player pastes text carrying control characters, for example 1998 × U+0001 between two letters. That is within the 2000-character maxLength, but JSON.stringify writes each as `\u0001`, so the body is 12,090 bytes, over the 8 KB cap.
- Wrong outcome: 413. The card offers a retry that will always fail. Normal text cannot trigger this: the worst case, 2000 three-byte characters plus a 200-character email, is 6,295 bytes, which I measured.
- Reproduce: worker-probe.ts prints `control-char payload bytes 12090` and `max CJK payload bytes 6295`.

## Questions for the owner
- The Worker stores CR/LF, NUL, bidi overrides and lone surrogates as sent, in `text`, `replyTo`, `platform` and `version` (probe: `"replyTo":"x@y\r\nBcc: z@w"`, `"platform":"p\r\nX-Evil: 1"`). `platform` and `version` go into the mail Subject and `replyTo` into Reply-To (deploy/n8n-feedback-mailer.json). The mailer path is settled, and nodemailer folds header newlines, so this is not raised as a finding. Should the Worker still refuse control characters in the short fields?
- The mailer lists 100 keys an hour, while the global limiter allows 120 posts an hour per location. Is a backlog under sustained spam acceptable? (The KV drain is settled.)
- `https://localhost` is an allowed origin for Android Capacitor, so any local https dev page on a visitor's machine can post cross-origin. Is that accepted as low stakes?

## What the tests do not prove
- tests/worker/feedback.test.ts: nothing tests limiter order against validation (junk spends the global bucket, S1); nothing covers control, bidi or invalid UTF-8 text, a Content-Length that understates the body (probe: 413, correct), or a non-string honeypot (`0` and `false` count as bots, correct).
- tests/worker/range.test.ts: nothing covers `bytes=0-0`, `bytes=-1`, whitespace forms, `Bytes=` casing, a trailing comma, an empty file, POST on /trailers/, or HEAD Content-Length (S4). The probes show all of these except HEAD come out right.
- tests/ui/notify.test.ts: public/notify-sw.js has no test at all (S2). Also untested: an update already active at attach (S3), the flush timer firing after the page became visible (the `gate.clear()` branch), callback-only `requestPermission`, and `requestPermission` throwing.
- tests/ui/feedback.test.ts: no case for 429, 400 or 413 specifically (only 500, 200 not ok, bad JSON and a network error). The "Check the email" path is never exercised: mutating `if (emailLooksWrong())` to `if (false && ...)` in mut-J leaves all 20 tests green.

## Coverage
- Read in full: src/worker/index.ts, feedback.ts, range.ts; wrangler.jsonc; src/ui/feedback.ts, src/ui/notify.ts, public/notify-sw.js; tests/worker/feedback.test.ts, range.test.ts; tests/ui/feedback.test.ts, notify.test.ts; tests/site/feedback-config.test.ts; .itworks/DECISIONS.md; MAP.md Gotchas; LANES.md Lane J (read from the main repo because the section was added after 0f05723); the BRIEF. Supporting reads, not in full: main.ts:90-160, ui.ts at the notifier call sites, panels.ts:1680-1705, the ui.css trap rule, the vite.config PWA block, public/_headers, deploy/n8n-feedback-mailer.json (node parameters only).
- Skipped: the prior lane-J/verify-J reports, because none exist (the lane is new).
- Probes run:
  - `npx vitest run tests/worker tests/ui/feedback.test.ts tests/ui/notify.test.ts tests/site/feedback-config.test.ts`: 5 files, 107 passed.
  - worker-probe.ts, feedback: a 2 MB body gave 413 with no write; text/plain, an array, null and an empty body gave 400; a KV throw gave 503 `unavailable`, with only "feedback: KV write failed" logged and no binding name or stack in the body. Found S1 and S5.
  - worker-probe.ts, range: 0-0, -1, 999-999 and ` bytes = 2 - 4 ` gave the correct 206; 1-0 and 5-2 gave 200 with the whole body; -0, 1000-1000 and an empty file gave 416 with `*/size` and no Content-Type; two ranges gave 200; a missing file passed the 404 page through; a Range outside /trailers/ went to the binding unchanged; a weak If-Range gave 200. Found S4.
  - notify-probe.ts: found S2 and S3.
  - Mutations in mut-J: the email check was disabled and survived; a KV write on the honeypot path was killed (1 red).
