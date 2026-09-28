// The car's floor indicator draws the whole floor label through the LED glyphs, inside the
// housing: floor 100 reads 100 and B10 reads B10, not the 00 and 10 two glyphs would leave.
import { describe, expect, it } from 'vitest';
import type { Graphics } from 'pixi.js';
import { LED_GLYPHS, carFloorLabel, drawCarIndicator } from '../../src/render/led';
import { carIndicator } from '../../src/render/illustrated';

const BOX = carIndicator(40, 4);

/** Draw the indicator for a car at `y` and read the glyphs back from the lit cells. */
function read(y: number, dir: number): { text: string; inside: boolean } {
  const cells: [number, number][] = [];
  const points: number[][] = [];
  const g = {
    rect(x: number, yy: number) {
      cells.push([x, yy]);
      return { fill: () => g };
    },
    poly(p: number[]) {
      points.push(p);
      return { fill: () => g };
    },
  };
  drawCarIndicator(g as unknown as Graphics, carFloorLabel(y, dir), dir, BOX.w, 0xffb347);
  const x0 = Math.min(...cells.map(([x]) => x));
  const y0 = Math.min(...cells.map(([, yy]) => yy));
  const glyphs = Math.ceil((Math.max(...cells.map(([x]) => x)) - x0 + 1) / 4);
  let text = '';
  for (let i = 0; i < glyphs; i++) {
    const rows = [0, 1, 2, 3, 4].map((r) => {
      let bits = 0;
      for (let c = 0; c < 3; c++) if (cells.some(([x, yy]) => x === x0 + i * 4 + c && yy === y0 + r)) bits |= 4 >> c;
      return bits;
    });
    const hit = Object.entries(LED_GLYPHS).find(([, g]) => g.every((b, r) => b === rows[r]));
    text += hit ? hit[0] : '?';
  }
  const xs = [...cells.flatMap(([x]) => [x, x + 1]), ...points.flatMap((p) => p.filter((_, k) => k % 2 === 0))];
  const ys = [...cells.flatMap(([, yy]) => [yy, yy + 1]), ...points.flatMap((p) => p.filter((_, k) => k % 2 === 1))];
  const inside = Math.min(...xs) >= 0 && Math.max(...xs) <= BOX.w && Math.min(...ys) >= 0 && Math.max(...ys) <= BOX.h;
  return { text, inside };
}

describe('the car floor indicator', () => {
  for (const [y, label] of [
    [100, '100'],
    [-10, 'B10'],
    [7, '7'],
  ] as const) {
    for (const dir of [0, 1, -1]) {
      it(`reads ${label} at y ${y}, direction ${dir}, inside the housing`, () => {
        expect(read(y, dir)).toEqual({ text: label, inside: true });
      });
    }
  }
});

// Audit F1 S5: floor 0 does not exist, but the sim parks a car crossing between B1 and 1 at y 0
// for a tick. Going down it must already read B1, not 1; going up it reads 1.
describe('the car crossing between B1 and 1', () => {
  it('reads B1 at y 0 going down', () => {
    expect(read(0, -1).text).toBe('B1');
    expect(carFloorLabel(0, -1)).toBe('B1');
  });

  it('reads 1 at y 0 going up', () => {
    expect(carFloorLabel(0, 1)).toBe('1');
  });

  it('reads the floor it is at on whole floors, whatever the direction', () => {
    for (const dir of [-1, 0, 1]) {
      expect(carFloorLabel(1, dir)).toBe('1');
      expect(carFloorLabel(-1, dir)).toBe('B1');
      expect(carFloorLabel(2, dir)).toBe('2');
      expect(carFloorLabel(-2, dir)).toBe('B2');
    }
  });
});
