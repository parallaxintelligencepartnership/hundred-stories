/**
 * Weather is outside the tower and outside the simulation: derived from seed and minute,
 * never from world.rng, never in the hash. Renderer, UI, audio and story prose all read this
 * one snapshot; the renderer eases toward it in real time.
 */

export type WeatherKind = 'clear' | 'overcast' | 'rain' | 'storm';

export interface WeatherSnapshot {
  kind: WeatherKind;
  from: WeatherKind;
  blend: number;
  intensity: number;
}

export const WEATHER_BLOCK_MINUTES = 360;
export const WEATHER_BLEND_MINUTES = 60;

function mix(a: number, b: number): number {
  let h = (a ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ b, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function kindOf(seed: number, block: number): WeatherKind {
  const u = mix(seed | 0, block);
  if (u < 0.45) return 'clear';
  if (u < 0.7) return 'overcast';
  if (u < 0.9) return 'rain';
  return 'storm';
}

export function weatherAt(seed: number, minute: number): WeatherSnapshot {
  const block = Math.floor(minute / WEATHER_BLOCK_MINUTES);
  const kind = kindOf(seed, block);
  const from = block > 0 ? kindOf(seed, block - 1) : kindOf(seed, 0);
  const intensity = 0.4 + 0.6 * mix((seed | 0) ^ 0x5bd1e995, block);
  const blend =
    from === kind ? 1 : Math.min(1, (minute - block * WEATHER_BLOCK_MINUTES) / WEATHER_BLEND_MINUTES);
  return { kind, from, blend, intensity };
}

export function weatherLabel(kind: WeatherKind): string {
  switch (kind) {
    case 'clear':
      return 'Clear';
    case 'overcast':
      return 'Overcast';
    case 'rain':
      return 'Rain';
    case 'storm':
      return 'Storm';
  }
}
