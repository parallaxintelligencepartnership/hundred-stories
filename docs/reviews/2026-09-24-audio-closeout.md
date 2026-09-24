# Audio closeout — 2026-09-24

## 1. Blind spots

- **Claim:** Later chapters and extended phone/headphone sessions have not received Matthew's listening approval.
  **Evidence:** He approved the empty/one-star comparison and revised game; automated coverage includes later chapters.
  **Check:** Run `npm run dev -- --port 4187` and open `/play/?new&audio=weekend-night-5star`, then `/play/?new&audio=storm-night-tower`; click to enable playback and listen on the intended device.
  **Priority:** whenever (before further chapter composition changes).

## 2. Time bombs

- **Claim:** The before/after WAV files are local review assets and will not follow a Git clone.
  **Evidence:** `.gitignore` excludes `audio-preview/**/*.wav`; copies were preserved in the main checkout before worktree cleanup.
  **Check:** `ls -lh audio-preview/before audio-preview/after`
  **Priority:** whenever.

## 3. Least certain

- **Claim:** The cause of the occasional off-beat blurb Matthew reported remains unconfirmed.
  **Evidence:** He said it sounded like a cut and was acceptable; no matching event recording was collected.
  **Check:** Run `npm run dev -- --port 4187`, open `/play/`, and compare with Effects and Ambient at zero; capture a timestamp if it becomes distracting.
  **Priority:** whenever; not an acceptance blocker.

## 4. Design regret

None requiring follow-up. The compact synthesized score remains the chosen approach.

## 5. Hacks ledger

- **Claim:** The full test suite did not complete in one clean run during the implementation pass; affected files passed on targeted reruns.
  **Evidence:** Initial run: 1,275 passed, one skipped, five failures. Two new audio assertions ran during final edits; three unrelated tests timed out while Chrome rendered. Final 92 audio tests passed; routing/security passed with two workers; chronicle passed with one worker and a 15-second CLI timeout. No permanent timeout changes.
  **Check:** Before the combined release, run `npx vitest run --maxWorkers=2` with rendering stopped.
  **Priority:** soon (combined-release validation).

## 6. Decided not to do

- **Claim:** No recorded soundtrack, sample library, dependency, push, or deployment is included in this audio pass.
  **Evidence:** Only procedural score/controller, tests, preview tooling and documentation changed; Matthew explicitly requested local completion before more work with Claude.
  **Check:** `git show --stat c01e0fe`; review this release instruction before running a push or deploy command.
  **Priority:** blocker-for-next-release; wait for combined-release authorization.

## 7. Tribal knowledge

- **Claim:** The listening comparison is development-only and uses different browser save storage from live.
  **Evidence:** `audio-preview/index.html` is outside public/ and production build entries; WAVs were absent from dist. Browser validation used port 4187 and Tailscale address 100.123.153.18.
  **Check:** `npm run dev -- --host 0.0.0.0 --port 4187 --strictPort`; open `/audio-preview/`. Export/import a live save to test that tower locally.
  **Priority:** whenever.

## 8. Skeptic's flag

- **Claim:** Some perceived improvement comes from a quieter overall mix, in addition to removing competing transients and changing the arrangement.
  **Evidence:** Matched-slider recordings fell from about -18.2 to -22.6 dBFS RMS; Matthew accepted the actual result. Waveform measurements do not establish subjective quality alone.
  **Check:** Use `/audio-preview/` to compare matched moments, allowing for the approximately 4 dB loudness difference.
  **Priority:** whenever.

## 9. Wishlist

- **Claim:** If later listening still finds synthesized instruments limiting, a small sample bank is the next candidate rather than a full recorded score.
  **Evidence:** This pass improved the score without assets; no instrument-library need has yet been demonstrated by listening.
  **Check:** Open `docs/reviews/2026-09-24-audio-listening-pass.md` and audition the existing instruments first; prototype a single keys or brushes sample only if needed.
  **Priority:** whenever.

## 10. Next steps

- **Claim:** Claude should continue from local main containing the accepted audio commit `c01e0fe` and these closeout notes.
  **Evidence:** Matthew requested completion of the worktree for additional local changes tonight.
  **Check:** `git merge-base --is-ancestor c01e0fe main && git status --short`
  **Priority:** blocker-for-next.
- **Claim:** The combined release should run the test suite and build after Claude's additional changes, then await Matthew's push/deploy instruction.
  **Evidence:** Audio typecheck/build and live-browser playback passed, but future changes have not been validated.
  **Check:** `npx vitest run --maxWorkers=2` followed by `npm run build`.
  **Priority:** soon.
