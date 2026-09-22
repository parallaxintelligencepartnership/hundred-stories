# Second opinion: UI and graphics build specs (Codex GPT-6-Astra, low effort)

Date: 2026-09-22. Requested by Matt as a second opinion on the look round of docs/reviews/2026-09-22-modernisation-proposal.md sections 4 and 5. Read-only run, four tightly defined requests, output kept as returned apart from repo-relative paths and the note below.

Orchestrator's note: request 1 asked for a person at 4 by 8 tiles, which at 16 px tiles is 64 by 128 px and taller than a 72 px floor. That was the brief's error, not Astra's. The figure is 2 by 4 tiles, 32 by 64 px, authored directly at that size; ignore the 0.5 scale display trick in the person paragraph and keep the rest (palette, stress colours, three frames at 120 ms).

## 1. Art specification

Double the existing geometry; retain its palette and furniture. Dimensions below are logical pixels, independent of bake resolution. Sources: docs/VISUAL.md Tokens, src/render/art.ts:28, proposal section 4.1.

Shared room shell: 2 px `#222222` outline; slab at y=66 to 71, `#e6e6e6`, with 2 px `#333333` top edge. Add a 4 px `#333333` shadow at 25% opacity beneath each slab, drawn over the next floor. Wall shadow occupies the rightmost 8 interior pixels, 4 for lobby tiles. Shadow colours below are new derivatives of existing wall colours. Windows: 12 by 12 panes at `(2+16n, 6)`, 2 px mullions, sill y=18 to 19.

| Piece | Geometry and palette |
|---|---|
| Office, 144 by 72 | Wall `#f7f5ee`; shadow `#d6d4ce`. Double `drawOffice` coordinates: desks x=14, 50, 86, tops 20 by 4 at y=46; monitors 14 by 14; cabinet 16 by 30 at (124, 36). Wood `#a9702f`, legs `#6b4420`, metal `#5a6472`, chairs `#2b5ea8` and `#6a3a97`. |
| Hotel single, 64 by 72 | Wall `#eef2f7`; shadow `#ced2d8`. Double `drawHotelSingle`: bed x=4, width 32, headboard 8 by 32; nightstand 10 by 16 at (36, 50); TV 14 by 16 at (48, 40). Linen `#f7f7f2`, pillow `#ffffff`, blanket `#2f5c9e` and `#8c3050`; office wood colours. |
| Lobby tile, 16 by 72 | Wall `#f8f8f6`; shadow `#d7d7d4`; marble veins `#c9c4b8`. Double existing `narrowLobbySegment` and `marbleFloor` coordinates and world-x repetition, preserving `#3a3a3a` columns. Soffit 16 by 2 at y=20. |
| Standard car, 56 by 60 | Fits a 64 px shaft. Body `#f0c419`, right 4 px shadow face `#c09d14`; 2 px `#222222` trim; ceiling light 52 by 4 at (2, 2), `#fff3b0`. Door opening 44 by 48 at (6, 8), cavity `#3b3f47`; two 22 by 48 `#f7d54a` panels slide outward 8 px each, clipped to the opening. Bottom plate 4 px; cast shadow 56 by 4 above the car, `#222222` at 25%. |

All room panes: day `#7fb6e0`; occupied night `#ffd866` with a 2 px `#fff3b0` header; vacant night entirely `#2a3550`. Screens switch `#8fd4ff` to `#33404d`; lamps switch `#ffd866` to `#f7f7f2`. Dirty hotel rooms keep only lamp light. Lobby lighting follows people present, since lobby capacity is zero. The car light stays on when empty; it has no vacancy state.

Person: preserve `#111111`, stress `#ff7ad9` and `#ff2d2d`, and the existing accessories. Frames: existing standing, stride, mirrored stride; 120 ms each. No wall, slab or vacancy state; receives ambient lighting. This resolves the current 8 by 24 figure's scale mismatch (src/render/art.ts:1286). See the orchestrator's note for the size.

## 2. Hour-based light layer

Choose one screen-sized multiply overlay, sharpening proposal section 4.2. Per-sprite tint requires 5,000 property updates per band; separate window sprites preserve emission but add up to 5,000 objects and do not shade walls alone.

Use `Sprite(Texture.WHITE)`, `blendMode = 'multiply'`, alpha 0.4. Tint anchors:

| Time | Tint |
|---|---|
| 06:00 | `#bfd8ff` |
| 12:00 | `#ffffff` |
| 18:00 | `#ffd0a0` |
| 23:00 | `#6078b0` |

Hold noon through 17:00, interpolate to evening at 18:00, night at 19:00; hold through 05:00, reach dawn at 06:00 and noon at 07:00. Update once per game minute. Insert after world rendering, before placement and selection overlays; it also grades the existing sky. Warm windows remain yellow under this partial multiply.

Incremental cost: one quad, about one draw call and viewport width by height by DPR squared blended fragments per frame, independent of room count; no defensible millisecond estimate without measurement. Extend the cached `lit` boolean to day, lit, vacant and housekeeping states; update changed rooms only (src/render/renderer.ts:761).

## 3. DOM palette tile

Retain the 232 px directory and the phone's 42vh sheet (src/ui/ui.css).

```html
<button class="hs-tool" aria-pressed="false">
  <canvas aria-hidden="true"></canvas>
  <span><span class="name"></span><span class="footprint"></span></span>
  <span class="cost"></span>
  <span class="progress" role="progressbar"></span>
</button>
```

Desktop: 88 px row, 8 px padding and gaps; thumbnail 72 by 36; name 14 px, metadata 12 px; cost on the second row, progress 4 px. At 720 px and below: two equal columns, 104 px rows, thumbnails unchanged.

Available: steel and ink. Selected: amber background, on-amber text, `aria-pressed=true`. Locked: `aria-disabled=true`, retain focus, show "Needs N stars"; progress = current stars over N, labelled accordingly. Unaffordable: alert cost plus "Short $X"; remains selectable for the existing placement feedback.

Expose a thumbnail method through the renderer holding the existing Art instance. Get `art.room(kind, rule.width, rule.height, 0, false)`; call `renderer.extract.canvas(texture)`, then `drawImage` into the DOM canvas with smoothing disabled, aspect-fit centred. Extract once per texture identity; refresh on art or cache recreation, redraw on DPR or size changes. Keep daytime previews stable. The cache is private (src/render/art.ts:1358); never create another Art instance.

## 4. Status bar and clock

Implement proposal section 4.5 as cash, population, stars, clock, then speed and menu. Add tokens: `--status-h: 56px`, `--status-gap: 12px`, `--status-value: 20px`, `--status-meta: 12px`, `--star-size: 16px`, `--clock-size: 40px`. Preserve both fonts and the theme tokens.

Cash: 160 px column; quarter delta = cash minus a quarter-start cash snapshot, including spending. Population: 112 px; arrow and signed change since the previous game-day boundary. Persist baselines; older saves display a dash until established. The existing `lastQuarter.net` is operating profit, not the cash delta (src/sim/types.ts:194).

Stars: six SVG icons, amber earned and line unearned, visible "Stars" label. Focus or tap tooltip lists population and every next-star prerequisite from src/sim/stars.ts.

Clock: 24 hour dial, midnight at top; shaded 23:00 to 06:00 arc, numeric time and date beside it. Show "Night x8, effective x16" at a selected x2; paused shows "Paused, night x8". This matches the actual multiplier (src/game/game.ts:191).

Phone: two 56 px rows; finances, population and stars first, clock and controls second. Reduced motion: instantaneous hands, progress and panel updates; no tweening, pulses, sway or walk cycling; the simulation continues.
