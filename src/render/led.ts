// The segmented face of the elevator indicator (docs/VISUAL.md: the status readouts' signature),
// shared by the car's floor indicator and the price that rises out of a room just placed (D-14).
// Each glyph is three cells wide and five tall, one bit a cell, top row first; glyphs sit one
// cell apart.

import type { Graphics } from 'pixi.js';

export const LED_GLYPHS: Record<string, readonly number[]> = {
  '0': [7, 5, 5, 5, 7],
  '1': [2, 6, 2, 2, 7],
  '2': [7, 1, 7, 4, 7],
  '3': [7, 1, 3, 1, 7],
  '4': [5, 5, 7, 1, 1],
  '5': [7, 4, 7, 1, 7],
  '6': [7, 4, 7, 5, 7],
  '7': [7, 1, 1, 2, 2],
  '8': [7, 5, 7, 5, 7],
  '9': [7, 5, 7, 1, 7],
  B: [6, 5, 6, 5, 6],
  '-': [0, 0, 7, 0, 0],
  ',': [0, 0, 0, 2, 4],
  $: [7, 6, 7, 3, 7],
};

/** How wide `text` draws at `cell` px a cell: four cells a glyph, less the trailing gap. */
export function ledTextWidth(text: string, cell: number): number {
  return text.length === 0 ? 0 : (text.length * 4 - 1) * cell;
}

/** Draw `text` into `g` with its top left at (x, y), `cell` px a segment cell. Unknown glyphs leave a gap. */
export function drawLedText(g: Graphics, text: string, x: number, y: number, cell: number, color: number): void {
  let cx = x;
  for (const ch of text) {
    const rows = LED_GLYPHS[ch];
    if (rows) {
      rows.forEach((bits, r) => {
        for (let c = 0; c < 3; c++) if (bits & (4 >> c)) g.rect(cx + c * cell, y + r * cell, cell, cell).fill(color);
      });
    }
    cx += 4 * cell;
  }
}
