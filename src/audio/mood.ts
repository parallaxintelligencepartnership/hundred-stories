import type { WeatherKind, WeatherSnapshot } from '../game/weather';
import type { Room } from '../sim/types';
import { BEDS, ENTRY_THRESHOLD, MAX_MELODIC, MELODIC, type Chapter, type Voice } from './score';
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
/** 1 from 18:00 to 01:00, when the restaurants and bars fill; eases over an hour at each edge. */
function eveningFactor(minute: number): number {
  const m = ((minute % 1440) + 1440) % 1440;
  if (m >= 1080 || m < 60) return 1;
  if (m >= 1020) return (m - 1020) / 60;
  if (m < 120) return (120 - m) / 60;
  return 0;
}
export function moodFor(input: MoodInput): Mood {
  const m = ((input.minuteOfDay % 1440) + 1440) % 1440;
  const weekendBonus = input.isWeekend ? m >= 1080 || m < 60 ? 0.2 : 0.05 : 0;
  const blend = clamp(input.weather.blend);
  const weatherWarmth = WEATHER_WARMTH[input.weather.from] * (1 - blend) + WEATHER_WARMTH[input.weather.kind] * blend;
  const fill = clamp(input.venueFill);
  return {
    energy: clamp(curve(m) + weekendBonus + 0.3 * fill),
    // Full rooms in the evening warm the night back up; the busiest weekend night is the warmest.
    warmth: clamp(weatherWarmth - 0.2 * nightFactor(m) + 0.3 * fill * eveningFactor(m) * (input.isWeekend ? 1 : 0.5)),
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

/**
 * The chapter decides which players exist; the mood decides how many play. Keys, bass and the
 * kit are the core. Above that, one bed (pad or strings) and up to two featured lines rotate
 * by phrase: none under 0.35 energy, one under 0.7, two above, one fewer under tension. With the
 * keys that is never more than three melodic voices at once.
 */
export function activeLayers(chapter: Chapter, energy: number, tension: number, weekend = false, phraseIndex = 0): Voice[] {
  const available = voicesFor(chapter, weekend);
  const heard = (voice: Voice): boolean => available.includes(voice) && energy >= ENTRY_THRESHOLD[voice];
  const out: Voice[] = (['piano', 'bass', 'drums', 'hat'] as Voice[]).filter(voice =>
    heard(voice) && !(tension >= 0.8 && (voice === 'drums' || voice === 'hat')));
  const rotate = <T>(list: readonly T[], by: number): T[] => {
    const k = ((by % Math.max(1, list.length)) + list.length) % Math.max(1, list.length);
    return [...list.slice(k), ...list.slice(0, k)];
  };
  const beds = available.filter(voice => BEDS.has(voice) && heard(voice));
  if (beds.length && tension < 0.8) out.push(rotate(beds, phraseIndex)[0]!);
  let lines = energy < 0.35 ? 0 : energy < 0.7 ? 1 : 2;
  if (tension > 0.2) lines -= 1;
  if (tension >= 0.8) lines = 0;
  lines = Math.min(lines, MAX_MELODIC - (out.includes('piano') ? 1 : 0));
  const featured = available.filter(voice => MELODIC.has(voice) && voice !== 'piano' && heard(voice));
  out.push(...rotate(featured, phraseIndex).slice(0, Math.max(0, lines)));
  if (heard('kinetic') && tension <= 0.2 && energy >= 0.8) out.push('kinetic');
  return out;
}
