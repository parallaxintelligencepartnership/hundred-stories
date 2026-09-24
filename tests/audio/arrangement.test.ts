import { describe, expect, it } from 'vitest';
import { foundationFigure, sectionFor } from '../../src/audio/arrangement';
import { drumHitsFor } from '../../src/audio/drums';
import { phraseFor } from '../../src/audio/phrase';
import { CHAPTER_SCALES, keyFor, musicalHz, swingBeat, swingFor, type Chapter } from '../../src/audio/score';

describe('foundation arrangement', () => {
  it('develops over 32 bars with a distinct closing breath', () => {
    expect([0, 1, 2, 3, 4].map(sectionFor)).toEqual(['introduce', 'answer', 'lift', 'breathe', 'introduce']);
    const phrases = [0, 1, 2, 3].map(phrase => Array.from({ length: 8 }, (_, bar) => foundationFigure(phrase, bar)));
    expect(new Set(phrases.map(p => JSON.stringify(p))).size).toBe(4);
    expect(phrases[3]!.every(bar => bar.length === 1)).toBe(true);
  });
  it('keeps early kick attacks with bass notes, without an extra click or timing offset', () => {
    for (let phrase = 0; phrase < 4; phrase += 1) {
      for (const energy of [0.2, 0.4, 0.65, 0.9]) {
        const bass = phraseFor(101, 1, phrase, 'bass', { energy });
        for (let bar = 0; bar < 8; bar += 1) {
          const kicks = drumHitsFor(101, phrase, phrase * 8 + bar, energy, 1).filter(h => h.kind === 'kick');
          for (const hit of kicks) {
            expect(hit.lateSeconds).toBe(0);
            expect(bass.some(n => Math.abs(n.beat - (bar * 4 + hit.beat)) < 1e-8)).toBe(true);
          }
          expect(kicks.every(h => h.beat === 0 || Math.abs(h.beat - swingBeat(2.5, swingFor(energy))) < 1e-8)).toBe(true);
        }
      }
    }
  });
  it('preserves an ascending celebration across octaves', () => {
    const line = [523, 659, 784, 1047, 1318].map(hz => musicalHz(hz, 7, 1));
    expect(line.every((hz, i) => i === 0 || hz > line[i - 1]!)).toBe(true);
  });
  it('fits pitched cues to every chapter and world key', () => {
    for (let seed = 0; seed < 30; seed += 1) {
      for (const chapter of [1, 2, 3, 4, 5, 6] as Chapter[]) {
        for (const hz of [330, 369.99, 392, 440, 466.16, 523, 659, 1047, 1318]) {
          const key = keyFor(seed);
          const pitch = Math.round(69 + 12 * Math.log2(musicalHz(hz, key, chapter) / 440)) - key;
          expect(CHAPTER_SCALES[chapter]).toContain(((pitch % 12) + 12) % 12);
        }
      }
    }
  });
});
