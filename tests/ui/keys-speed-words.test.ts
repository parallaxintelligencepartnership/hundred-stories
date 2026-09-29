// The keyboard help names the speeds in plain words, as the speed buttons do, not "1x, 2x, 4x"
// (audit close, 2026-09-28; DECISIONS 2026-09-24: plain words for a reader of 8 to 10).
import { expect, it } from 'vitest';
import { keyHelpLines } from '../../src/ui/keys';

it('the speed line says paused, normal speed, two and four times as quick, with no "1x"', () => {
  const speed = keyHelpLines(6).find((line) => line.startsWith('Speed:'))!;
  expect(speed).toBe(
    'Speed: comma slows down one step and period speeds up one step (paused, normal speed, two times as quick, four times as quick). Space pauses and starts again.',
  );
  expect(speed).not.toMatch(/\d+x\b/);
});
