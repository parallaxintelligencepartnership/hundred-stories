# Audio listening pass — 2026-09-24

Status: Matthew accepted the before/after audio and revised game on 2026-09-24. Approved for integration into local main; explicitly hold push/deployment for additional work with Claude.

Matthew has heard the empty and one-star game only. This pass therefore concentrates the composed arrangement and before/after comparisons on chapter one. Shared mix, cue, scheduler, and mute improvements also apply to later chapters; their musical character still needs human listening review.

## What changed

- Removed the repeating, RMS-normalized vinyl crackle source and its graph nodes.
- Reduced kick from -12 to -17 dB on its bus, removed its separate click, shortened the tail and tapered the buffer ending. Snare -16 dB; early-game percussion gets another 0.7 gain multiplier. Bass peak reduced from 0.1 to 0.075 with a gentler attack.
- Kick attacks follow the bass grid exactly. Backbeat delay reduced to 10–18 ms. Fewer ghost notes and open hats.
- Added four eight-bar sections: introduce, answer, lift, breathe. Chapter-one accompaniment and kick share the section's figures. Percussion fades away for the fourth section; the next cycle restores it. Later chapters retain their existing phrase generators but also get the breathing passage.
- Echo is an eighth note at the world tempo, wet level -21 dB, feedback 0.18, low-pass 2.2 kHz.
- Construction is a short quiet tap and filtered brush, rate-limited to 180 ms. Burst elevator ticks have a softer 35 ms attack and -34 dB peak.
- Elevator bells and musical cues follow world key/chapter mode. Musical stingers start on the next beat; urgent warning cues remain immediate. Celebration contours preserve their octave movement.
- Zero music volume stops existing score sources and avoids scheduling silent voices; ambience mute stops weather sources. Venue occupancy is cached between bars. Repeated gestures no longer reset mix automation and mood smoothing. Long timer stalls skip overdue bars.
- Added an empty-foundations listening preset, configurable render output/preset/duration environment variables, and a local comparison page.

## Listening preview

Original review worktree: `/private/tmp/hundred-stories-audio` (closed after acceptance). Preview page and local WAVs preserved in the main checkout.

Start: `npm run dev -- --host 0.0.0.0 --port 4187 --strictPort`

- `http://localhost:4187/audio-preview/`
- `http://100.123.153.18:4187/audio-preview/` on the current Tailscale network
- Normal gameplay: `/play/`; enable Sound in Settings.

Two 105-second before/after pairs, seed 101: empty foundations and sunny one-star morning. Pinning affects audio inputs; it does not populate the tower with simulated venues. Switch playback at the same position or jump to 82 seconds for the quieter passage. Fixed input values and sliders match; perceived loudness intentionally does not. Ambient noise is random, so the ambient waveform is not bit-identical.

The preview is a separate origin with separate saves. Export/import a live save to test an existing tower here. WAV files are ignored by Git, outside public/, and absent from dist and the production precache. They are local review material, not shipped assets.

Re-render revised recordings:

```sh
AUDIO_OUT=audio-preview/after AUDIO_PRESETS=empty-foundations,sunny-morning-1star AUDIO_SECONDS=105 npm run audio:samples
```

Baseline recordings were captured at base `86b4107` before audio edits, with only the empty preset and render-script options added. Preserve `audio-preview/before/` for this review; rerunning the current branch into that folder would overwrite the baseline.

## Verification

- 92 audio tests pass, including coherent kick/bass timing, musical cue scales and contour, muted allocation, missing-bar recovery, and the quiet passage.
- Typecheck and production build pass. Existing full-suite run passed 1,275 tests with one skip and five failures; two new audio assertions ran against modules loaded before the final corrections, and three non-audio tests timed out under concurrent rendering. All affected files subsequently passed. Routing and security passed with two workers; the chronicle UI file passed (12 tests, 1.81 seconds total) with one worker and a 15-second timeout allowance. No persistent timeout changes were made.
- Chrome over the Tailscale URL loaded all four 105-second players, switched versions and sought to 82 seconds. Live game mounted, gesture started an AudioContext, context time advanced (1.984 seconds observed), no browser runtime exceptions.
- Revised empty: peak -3.60 dBFS, RMS -22.60 dBFS; one star: peak -3.73 dBFS, RMS -22.54 dBFS. No clipped PCM samples. Baselines were about -18.2 dBFS RMS. Quiet window (82–98s): about -25.64 dBFS RMS.
- Game JS: 184,218 bytes / 62,832 bytes with Python gzip, compared with the existing main checkout build at 183,682 / 62,660 bytes. Approximately +172 compressed bytes; this is a comparison with an existing build, not a new controlled baseline build. No dependencies or runtime audio assets added. Removed four seconds of mono float audio allocation (about 0.71 MB at 44.1 kHz).

## Handoff claims checked

- VERIFIED OK: current score is procedural; no production audio file decoding or recorded score was introduced. Earlier handoff's proposed 35–50-minute delivered soundtrack is not the implemented architecture.
- CONFIRMED: long-session phone/headphone listening remains necessary. Offline waveform checks and headless playback prove operation, not pleasantness. This preview supplies the missing user listening step.
- STILL OPEN: listen for 15–20 minutes on phone speakers and headphones, including construction, elevator bursts, and mute/resume. Later chapters need their own listening review before any broader composition changes.
- STILL OPEN (deferred, outside audio scope): older handoff items about routing, rent UI, visual art and story progression. This pass does not alter those systems.

Listening accepted: Matthew confirmed the extra kicks were gone and the rhythm improved in the revised game. An occasional off-beat blurb remained but was acceptable; its cause was not diagnosed.

Next action: continue other changes with Claude on local main. Do not push or deploy until Matthew authorizes the combined release. See `docs/reviews/2026-09-24-audio-closeout.md`.
