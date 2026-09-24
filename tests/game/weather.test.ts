import { describe, expect, it } from 'vitest';
import { weatherAt, WEATHER_BLOCK_MINUTES, type WeatherKind } from '../../src/game/weather';

describe('weather', () => {
  it('is deterministic for the same seed and minute', () => {
    const seed = 12345;
    const minute = 4321;
    const first = weatherAt(seed, minute);
    for (let i = 0; i < 1000; i++) {
      expect(weatherAt(seed, minute)).toEqual(first);
    }
  });

  it('every kind appears at least once for seed 7 across blocks 0..400', () => {
    const seen = new Set<WeatherKind>();
    for (let block = 0; block <= 400; block++) {
      const snapshot = weatherAt(7, block * WEATHER_BLOCK_MINUTES);
      seen.add(snapshot.kind);
    }
    expect(seen.has('clear')).toBe(true);
    expect(seen.has('overcast')).toBe(true);
    expect(seen.has('rain')).toBe(true);
    expect(seen.has('storm')).toBe(true);
  });

  it('blend is 0 at the first minute of a block whose kind differs from the previous, 1 at minute 60', () => {
    const seed = 7;
    for (let block = 1; block <= 400; block++) {
      const start = block * WEATHER_BLOCK_MINUTES;
      const atStart = weatherAt(seed, start);
      if (atStart.from !== atStart.kind) {
        expect(atStart.blend).toBe(0);
        const atSixty = weatherAt(seed, start + 60);
        expect(atSixty.blend).toBe(1);
        return;
      }
    }
    throw new Error('no block transition found for seed 7 across blocks 1..400');
  });

  it('blend is 1 when the kind repeats', () => {
    const seed = 7;
    for (let block = 1; block <= 400; block++) {
      const start = block * WEATHER_BLOCK_MINUTES;
      const atStart = weatherAt(seed, start);
      if (atStart.from === atStart.kind) {
        expect(atStart.blend).toBe(1);
        return;
      }
    }
    throw new Error('no repeated block found for seed 7 across blocks 1..400');
  });

  it('intensity stays within 0.4..1', () => {
    for (let block = 0; block <= 400; block++) {
      const snapshot = weatherAt(7, block * WEATHER_BLOCK_MINUTES);
      expect(snapshot.intensity).toBeGreaterThanOrEqual(0.4);
      expect(snapshot.intensity).toBeLessThanOrEqual(1);
    }
  });
});
