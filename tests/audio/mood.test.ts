import { describe, expect, it } from 'vitest';
import { activeLayers, easeMood, moodFor, venueFillFor, type MoodInput } from '../../src/audio/mood';
import { drumHitsFor, kickPatternFor, lazyOffsetMs } from '../../src/audio/drums';
import { chordColourFor, cutoffForWarmth, keyFor, swingFor, tempoFor } from '../../src/audio/score';
import { phraseFor } from '../../src/audio/phrase';

const clear = { kind: 'clear', from: 'clear', blend: 1, intensity: 1 } as const;
const weather = (kind: 'clear' | 'rain' | 'storm') => ({ kind, from: kind, blend: 1, intensity: 1 });
const input = (minuteOfDay: number, isWeekend = false, venueFill = 0): MoodInput =>
  ({ minuteOfDay, isWeekend, venueFill, weather: clear, tension: 0 });

describe('pure live mood', () => {
  it('is deterministic and follows the specified hour curve', () => {
    const three = input(3 * 60);
    expect(moodFor(three)).toEqual(moodFor({ ...three }));
    expect(moodFor(three).energy).toBeLessThan(0.2);
    expect(moodFor(input(21 * 60, true, 1)).energy).toBe(1);
  });
  it('blends weather warmth and darkens night', () => {
    expect(moodFor(input(12 * 60)).warmth).toBe(1);
    expect(moodFor({ ...input(12 * 60), weather: weather('storm') }).warmth).toBe(0.15);
    expect(moodFor({ ...input(3 * 60), weather: weather('rain') }).warmth).toBeCloseTo(0.15);
    expect(moodFor({ ...input(12 * 60), weather: { kind: 'rain', from: 'clear', blend: 0.5, intensity: 1 } }).warmth).toBeCloseTo(0.675);
  });
  it('takes at least 15 real seconds to ease from zero to 0.9 energy', () => {
    const target = { energy: 0.9, warmth: 1, tension: 1 };
    const zero = { energy: 0, warmth: 0, tension: 0 };
    expect(easeMood(zero, target, 15).energy).toBeLessThan(0.9);
    expect(easeMood(zero, target, 18).energy).toBeCloseTo(0.9);
    expect(easeMood(zero, target, 1).tension).toBe(1);
    expect(easeMood(target, zero, 1).tension).toBeCloseTo(0.85);
  });
  it('uses occupancy and twice the venue width, ignoring other rooms', () => {
    expect(venueFillFor([])).toBe(0);
    expect(venueFillFor([
      { kind: 'restaurant', occupancy: 12, width: 12 },
      { kind: 'shop', occupancy: 8, width: 8 },
      { kind: 'office', occupancy: 999, width: 1 },
    ])).toBe(0.5);
  });
  it('keeps only the foundation at low energy and the first band at full energy', () => {
    expect(activeLayers(6, 0.1, 0)).toEqual(['piano', 'bass']);
    expect(activeLayers(1, 1, 0)).toEqual(['piano', 'bass', 'drums', 'hat']);
    expect(activeLayers(5, 1, 1)).not.toContain('hat');
    expect(activeLayers(5, 1, 1)).not.toContain('kinetic');
    expect(activeLayers(5, 1, 1)).not.toContain('drums');
  });
  it('chooses warm, middle and dark chord colours', () => {
    expect(chordColourFor(0.8)).toBe('major9');
    expect(chordColourFor(0.5)).toBe('dominant9');
    expect(chordColourFor(0.2)).toBe('minor11');
    expect(chordColourFor(1, 1)).toBe('minor11');
    expect(cutoffForWarmth(0.2)).toBe(1200);
    expect(cutoffForWarmth(1)).toBe(6000);
  });
  it('makes low-energy phrases sparse and changes chord and motif colour', () => {
    const sparse = phraseFor(81, 4, 7, 'piano', { density: 0.4, energy: 0.2, warmth: 0.2, night: true });
    const full = phraseFor(81, 4, 7, 'piano', { density: 1, energy: 0.9, warmth: 0.9 });
    expect(sparse.length).toBeLessThan(full.length);
    expect(sparse.map(n => n.freq)).not.toEqual(full.map(n => n.freq));
    expect(phraseFor(81, 4, 7, 'lead', { energy: 0.2, night: true })).not.toEqual(
      phraseFor(81, 4, 7, 'lead', { energy: 0.9, night: false }));
  });
});

describe('lofi groove', () => {
  it('keeps snares on beats two and four in every seeded kick pattern', () => {
    const patterns = new Set<string>();
    for (let i = 0; i < 32; i += 1) {
      patterns.add(JSON.stringify(kickPatternFor(42, i)));
      expect(drumHitsFor(42, i, i % 8, 0.7).filter(h => h.kind === 'snare').map(h => h.beat)).toEqual([1, 3]);
    }
    expect(patterns.size).toBe(4);
  });
  it('is lazier at low energy and adds ghost and open hats above 0.5', () => {
    expect(lazyOffsetMs(0.2)).toBeGreaterThan(lazyOffsetMs(0.9));
    expect(drumHitsFor(7, 0, 0, 0.2).some(h => h.kind === 'ghost')).toBe(false);
    expect(drumHitsFor(7, 0, 0, 0.9).some(h => h.kind === 'ghost')).toBe(true);
    expect(swingFor(0.2)).toBeGreaterThan(swingFor(0.9));
  });
  it('chooses a fixed world tempo and key within the genre range', () => {
    for (let seed = 0; seed < 100; seed += 1) {
      expect(tempoFor(seed)).toBeGreaterThanOrEqual(72);
      expect(tempoFor(seed)).toBeLessThanOrEqual(82);
      expect(tempoFor(seed)).toBe(tempoFor(seed));
      expect(keyFor(seed)).toBe(keyFor(seed));
    }
  });
});
