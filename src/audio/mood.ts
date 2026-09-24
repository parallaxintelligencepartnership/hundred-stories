import type { WeatherKind, WeatherSnapshot } from '../game/weather';
import type { Room } from '../sim/types';
import { ENTRY_THRESHOLD, type Chapter, type Voice } from './score';
import { voicesFor } from './phrase';

export interface MoodInput {
  minuteOfDay: number;
  isWeekend: boolean;
  venueFill: number;
  weather: WeatherSnapshot;
  tension: number;
}
export interface Mood { energy: number; warmth: number; tension: number }
const clamp = (n: number): number => Math.min(1, Math.max(0, n));
const WEATHER_WARMTH: Readonly<Record<WeatherKind, number>> = {
  clear: 1, overcast: 0.6, rain: 0.35, storm: 0.15,
};

function curve(minute: number): number {
  const m = ((minute % 1440) + 1440) % 1440;
  const points: readonly [number, number][] = [[0, 0.15], [300, 0.15], [480, 0.6], [780, 0.4], [1200, 0.7], [1440, 0.15]];
  for (let i = 1; i < points.length; i += 1) {
    const [end, value] = points[i]!;
    if (m <= end) {
      const [start, before] = points[i - 1]!;
      return before + (value - before) * (m - start) / (end - start);
    }
  }
  return 0.15;
}
function nightFactor(minute: number): number {
  const m = ((minute % 1440) + 1440) % 1440;
  if (m >= 1320 || m < 300) return 1;
  if (m >= 1200) return (m - 1200) / 120;
  if (m < 420) return (420 - m) / 120;
  return 0;
}
export function moodFor(input: MoodInput): Mood {
  const m = ((input.minuteOfDay % 1440) + 1440) % 1440;
  const weekendBonus = input.isWeekend ? m >= 1080 || m < 60 ? 0.2 : 0.05 : 0;
  const blend = clamp(input.weather.blend);
  const weatherWarmth = WEATHER_WARMTH[input.weather.from] * (1 - blend) + WEATHER_WARMTH[input.weather.kind] * blend;
  return {
    energy: clamp(curve(m) + weekendBonus + 0.3 * clamp(input.venueFill)),
    warmth: clamp(weatherWarmth - 0.2 * nightFactor(m)),
    tension: clamp(input.tension),
  };
}
function approach(from: number, to: number, step: number): number {
  return from < to ? Math.min(to, from + step) : Math.max(to, from - step);
}
/** Real seconds, independent of simulation speed. */
export function easeMood(current: Mood, target: Mood, seconds: number): Mood {
  const dt = Math.max(0, seconds);
  return {
    energy: approach(current.energy, target.energy, 0.05 * dt),
    warmth: approach(current.warmth, target.warmth, 0.05 * dt),
    tension: approach(current.tension, target.tension, (target.tension > current.tension ? 1 : 0.15) * dt),
  };
}

const VENUES: ReadonlySet<Room['kind']> = new Set(['restaurant', 'fastFood', 'shop', 'cinema', 'partyHall']);
/** Room has occupancy and width, but no capacity field; two places per tile is the audio proxy. */
export function venueFillFor(rooms: Iterable<Pick<Room, 'kind' | 'occupancy' | 'width'>>): number {
  let occupied = 0;
  let capacity = 0;
  for (const room of rooms) {
    if (!VENUES.has(room.kind)) continue;
    occupied += room.occupancy;
    capacity += room.width * 2;
  }
  return capacity > 0 ? clamp(occupied / capacity) : 0;
}

/** Thresholds define how much of the chapter's band plays at the current energy. */
export function activeLayers(chapter: Chapter, energy: number, tension: number, weekend = false): Voice[] {
  return voicesFor(chapter, weekend).filter(voice =>
    energy >= ENTRY_THRESHOLD[voice] && !(tension > 0.2 && (voice === 'drums' || voice === 'hat' || voice === 'kinetic')),
  );
}
