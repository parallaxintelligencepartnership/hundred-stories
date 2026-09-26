// The elevator indicator's segmented glyphs (src/render/led.ts): each is three cells by five,
// top row first. The shapes are pinned here cell by cell, written out as a player reads them,
// so a mirrored map (a car's 2 reading as a 5) or a swapped glyph fails.

import { describe, expect, it } from 'vitest';
import type { Graphics } from 'pixi.js';
import { drawLedText } from '../../src/render/led';

/** Draw one glyph at 1 px a cell and read back its lit cells as five rows of '#' and '.'. */
function litRows(ch: string): string[] {
  const grid = Array.from({ length: 5 }, () => ['.', '.', '.']);
  const g = {
    rect(x: number, y: number) {
      grid[y]![x] = '#';
      return { fill: () => g };
    },
  };
  drawLedText(g as unknown as Graphics, ch, 0, 0, 1, 0xffffff);
  return grid.map((row) => row.join(''));
}

const EXPECTED: Record<string, string[]> = {
  '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '.##', '..#', '###'],
  '5': ['###', '#..', '###', '..#', '###'],
  '7': ['###', '..#', '..#', '.#.', '.#.'],
  '-': ['...', '...', '###', '...', '...'],
  ',': ['...', '...', '...', '.#.', '#..'],
  $: ['###', '##.', '###', '.##', '###'],
};

describe('LED glyphs', () => {
  for (const [ch, rows] of Object.entries(EXPECTED)) {
    it(`lights the cells of '${ch}' as the indicator reads it`, () => {
      expect(litRows(ch)).toEqual(rows);
    });
  }

  it('sets the next glyph one cell apart, four cells on', () => {
    const cells: [number, number][] = [];
    const g = { rect: (x: number, y: number) => (cells.push([x, y]), { fill: () => g }) };
    drawLedText(g as unknown as Graphics, '-,', 0, 0, 1, 0);
    expect(cells).toEqual([[0, 2], [1, 2], [2, 2], [5, 3], [4, 4]]);
  });
});
