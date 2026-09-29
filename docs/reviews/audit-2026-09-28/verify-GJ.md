# Verification of lanes G and J at 0f05723

Host arm64 (`uname -m`). Checkout: scratchpad/audit-0f05723. DECISIONS.md read in full; the checkout copy and the main repo copy are identical. No overlay was needed. My probes are in scratchpad/verifyGJ/ and run from the checkout root with `npx vite-node@6.0.0 ../verifyGJ/<file>`. I re-ran every probe from both lanes; each printed what its report quotes.

## Lane G verdicts

### G-S1. Non-number venue occupancy gives a NaN mood; with Sound on, every tick frame throws before render and autosave - CONFIRMED (final: IMPORTANT)
- Reproduction: `g1-loop.ts` uses the real `createGame` with a stub renderer that counts renders, plus the real `createSound`. The stub AudioContext's params throw on a non-finite value, as the WebIDL `float` type does. The save is imported through `game.importSave` with the restaurant set to `"occupancy":"x"` at 03:30. The UI's own subscriber is added before the sound's, as in ui.ts. Output:
  - `importSave ok: true`, then `gesture 1 THREW`, then `gesture 2 THREW` (at onClock, audio.ts:972, after it subscribed). The mood is `{"energy":null,"warmth":null}`.
  - Night, 600 frames: `threw=194 renders=406 autosaveAsks=0`. The control run with `occupancy 0` prints `threw=0 renders=600 autosaveAsks=1`, so the 05:00 autosave was lost.
  - Every frame from 03:30 to about 06:00 ticks (112 frames), and none of those frames rendered. At night the picture is frozen.
  - After the hourly recount the restaurant's occupancy is 0, yet the day run prints `threw=100 renders=500 autosaveAsks=0` and the mood is still NaN.
  - With Sound off: `threw=0`. Turning Sound on again throws, and it keeps throwing.
- Trace: `notify` (game.ts:279) is a bare `forEach`, and `advance` calls it at :369 before `maybeAutosave` at :370. `drawFrame` (:664-671) calls `advance()` before `renderer.render`. `frame()` schedules the next rAF first, so the loop survives but skips its draw.
  - Why the NaN never clears: `approach(NaN, x, s)` returns `Math.max(x, NaN)`, which is NaN. The music timer throws inside `advanceMood` (:1054) before `targetForBar` (:1063), so the target is never refreshed either.
  - The boot path is main.ts:131, where the load runs before createUi, so construction captures the NaN (audio.ts:586-589). An "Open a saved file" in the middle of a session reaches the same state one music tick later.
  - The HUD still updates, because its subscriber comes earlier in the Set. Hide and pagehide saves still run, so the stored tower heals once the recount has run. That keeps this below CRITICAL.
  - `setSoundOn` (sound-toggle.ts:17-20) skips `announcePref` when `setEnabled` throws.
- Severity: IMPORTANT, as proposed. The draw freezes all night and autosave stops for the session, with no workaround except Sound off, which nobody would guess. It needs a hand-edited or corrupt file.
- Fix spec: audio must never throw into the game loop.
  1. `venueFillFor` and `clamp` (mood.ts:14, :74-83) treat a non-finite value as 0.
  2. `easeMood` resets a non-finite axis to its target.
  3. The loader refuses a non-integer or negative occupancy (the lane D side).
  - Tests: a mood.test case with `occupancy: 'x'` and `{}` gives a finite mood. An audio.test case uses a stub whose params throw on non-finite values: `wake`, then `onClock` over 10 minutes, must not throw. Both fail today.
  - Must not change: the mood values for finite inputs, and the event and hash streams.

### G-S2. Sound off then on, or hide then show, before `suspend()` settles leaves the context suspended with Sound on - CONFIRMED on the code path; browser timing UNVERIFIABLE HERE (final: ADVISORY)
- Reproduction: `p3-race.ts` re-run prints `A. ... settings.on = true state = suspended` and `B. ... settings.on = true state = suspended`.
  - Trace: `sleep` (audio.ts:776) suspends without a follow-up. `wake` (:709) and `onPageShown` (:651) resume only when `state === 'suspended'`.
  - The Web Audio spec updates `state` in the task that resolves the suspend promise, so a compliant engine shows `'running'` inside that window.
  - It recovers on the next pointerdown or keydown (onGesture, then wake, then resume).
- Browser step: in Safari, turn Sound on and let music play. Then either press the button twice within about 50 ms, or switch apps and come back at once. Music stays silent until the next tap.
- Fix spec: chain `.then(() => { if (settings.on && !dozing && gestured && ctx.state === 'suspended') resumeGuarded(ctx); })` on the suspends at :644 and :776.
  - Test: a stub whose suspend settles later. Off, on, settle must end `running`. Fails today.
  - Must not change: the existing S4 guard (on, off before the resume lands).

### G-S3. A ransom paid while a fire burns clears the tension and drops the fire's release cue - CONFIRMED (final: ADVISORY)
- Reproduction: `p4-firebomb.ts` re-run prints `tension false tensionLevel 0` with the fire still in `world.events`, then `bell oscillators while the fire burns: 4`, then `fire.resolved later: release cue oscillators = 0`.
  - events.ts:921-926 rolls fire and bomb independently at 06:00, so both can start the same morning. `startThreat('bomb')` replaces fire (audio.ts:838).
  - The pay path (events.ts:977-985) emits `bomb.resolved`, and `endThreat` (:861) clears everything. The later `fire.resolved` is dropped at :810.
  - The window is short: security puts a fire out in 45 game minutes, about 4.5 s at 1x.
- Fix spec: after the release cue in the `release.*` branch (:807-813), re-derive the threat with `syncThreat` (liveThreat) instead of clearing it, so a live fire re-ducks without a start cue.
  - Test: fire then bomb, pay the ransom. `tensionLevel` must stay 1, and a later `fire.resolved` must play the release cue. Fails today.
  - Must not change: a single incident's start and end cues.

## Lane J verdicts

### J-S1. Limiters run before the body checks, and the shared limit (2) sits below the per-IP limit (5), so one address holds feedback shut - CONFIRMED (final: IMPORTANT)
- Reproduction: `j1.ts`, with limiters counting as in wrangler.jsonc. One IP sends two posts, then three different IPs send real posts:
  - Empty `text/plain` junk: 400, 400, then `429,429,429`, with the attacker at 2 of 5 and 0 KV puts.
  - Invalid JSON: the same.
  - Valid bodies: 200, 200, then `429,429,429`, with 2 KV puts.
- Consequences:
  - Reordering alone does not fix it: the root is a per-IP limit above the global limit. It contradicts the intent stated at feedback.ts:147, "one sender ... never spends the shared bucket".
  - The card shows FEEDBACK_FAILED (ui/feedback.ts:32, :258) for every 429.
  - The global limit is not in DECISIONS.md. Line 119 settles only "validates, rate limits per IP and writes to a KV store".
- Severity: IMPORTANT, as proposed. It is a refusal with a wrong reason ("try again in a minute" never works while the sender continues). It needs an adversary, and the email address in the message is a partial workaround.
- Settled from code only:
  - The comment "holds KV writes to 2,880 a day" (wrangler.jsonc:23-24) is 2 × 1440, the right arithmetic for one bucket.
  - Offline I cannot confirm the claim "under the free tier's daily cap" (feedback.ts:14-15). The lane's figure is 1,000 writes a day, which would make it false, and the account would then reach 503 `unavailable` until the daily reset.
  - I also cannot confirm whether the rate-limit binding counts per Cloudflare location. If it does, "global" is per location and the lockout reaches only players served by the attacker's location. Both need the Cloudflare docs (kv/platform/pricing, workers/runtime-apis/bindings/rate-limit).
- Fix spec:
  1. Check the content type, size, parse, validation and honeypot before either limiter.
  2. Set the per-IP limit well below the global one (for example 2 per 60 s per IP), with the global figure chosen against the confirmed KV write cap.
  3. Correct both comments.
  - Tests: two `text/plain` posts from IP A, then a valid post from IP B, must give 200 with 1 put. Fails today. The existing order test (feedback.test.ts:184-199) stays.

### J-S2. A notification tap with no game tab focuses a landing or clips tab - CONFIRMED (final: ADVISORY)
- Reproduction: `notify-probe.ts` re-run prints `tabs: landing only -> focus https://hundredstories.xyz/, post ...` and does not print `open`.
  - `matchAll({includeUncontrolled:true})` returns every same-origin window, not only those in the /play/ scope (vite.config.ts:113-117). The `|| windows[0]` at notify-sw.js:10 contradicts the file's own comment ("with no game tab open it opens the game").
- Fix spec: drop `|| windows[0]`, so an alert with no /play/ tab opens `/play/`.
  - Test: a new notify-sw test with a landing-only client list expects `openWindow('/play/')`. Fails today.
  - Must not change: a /play/ tab is still focused and receives the post.

### J-S3. An update that activates before `watchForUpdate` attaches is never announced - CONFIRMED on the code path; timing UNVERIFIABLE HERE (final: ADVISORY)
- Reproduction: `notify-probe.ts` prints `told = 0` for both an already-claimed worker and a worker still `activating`.
  - notify.ts:414-416 follows only `installing` and `waiting`, and the watch attaches last in boot (main.ts:156).
  - `autoUpdate` means skipWaiting plus clientsClaim, so a worker installed during the navigation can be active before boot ends.
- Browser step: deploy a build, open /play/ on a slow device served by the old worker, wait an hour, and check that no notice appeared.
- Fix spec: at attach, also follow `registration.active` when `active !== sw.controller` or `active.state === 'activating'`. Also listen for `controllerchange` when the page started under a controller.
  - Test: `active` claimed before attach gives `told = 1`. Fails today.
  - Must not change: a first install is not an update.

### J-S4. HEAD on /trailers/* has no Content-Length - PARTIAL (final: ADVISORY)
- Holds for HEAD: the probe prints `HEAD + Range ... CL=null` and `HEAD no Range ... CL=null`. The live check `curl -sI https://hundredstories.xyz/trailers/site-intro.mp4` returns 200 with `content-type`, `accept-ranges` and no `content-length`. The cause is `copyHeaders` (range.ts:45) followed by the pass-through at :65, which never sets the length again.
- Does not hold for GET without Range: live `GET /trailers/the-wait.mp4` returns `content-length: 2550247`, so workerd takes the length from the stream. The node probe's `CL=null` does not apply there.
- Fix spec: on the pass-through, copy the asset's Content-Length when the response is not a range answer.
  - Test: range.test HEAD expects `content-length` equal to the size. Fails today.

### J-S5. A 413 from control characters shows "Try again in a minute" - CONFIRMED (final: ADVISORY)
- Reproduction: `j1.ts` sends 2000 characters (`'a' + 1998×U+0001 + 'b'`) through the card's own `sendFeedback` into the real worker. It prints `false | status 413`, and the retry prints `413` again.
  - Normal text cannot reach the limit: the lane measured 6,295 bytes for the worst real CJK payload.
- Fix spec: either strip C0 control characters other than tab and newline from `text` before sending, or map a 413 or 400 to a sentence without the retry advice.
  - Test: that body sends ok, or shows the new sentence. Fails today.

## Duplicates
- G-S1 shares its loader root with lane D: save.ts never checks `room.occupancy`. It is the same class as lane D S5 (validator gaps), though lane D's report does not name occupancy. Lane D's verifier owns the loader half. The audio half above is independent and needs its own fix.

## Notes
- No new suspicion. One observation for the orchestrator: J-S1's "valid body" variant writes KV. Combined with the unconfirmed daily write cap, that is the path to a whole-day 503, which is why the fix must change the limits and not only the order.
- Skipped: I did not fetch any Cloudflare docs (the task limits me to the code and wrangler.jsonc), and I did not call the live /api/feedback.
