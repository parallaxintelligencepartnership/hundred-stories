// Today's tower: the daily mode. Everyone who plays on the same calendar date gets the same
// start and the same twist, with no server: the player's local date (YYYY-MM-DD) goes through
// a fixed hash. The date is read here, in the game layer, and never inside src/sim.
//
// Twists use only knobs the sim already has. "Tight money" is less starting cash (TowerStart).
// "Narrow lot" is left out: the demo box is a build-time edition check in src/sim/build.ts, and
// a smaller box for one tower would be a new sim rule.

import type { World } from '../sim/types';
import type { TowerStart } from '../sim/world';
import type { DailyRecord } from './storage';
import { SITE_URL } from '../share/share';
import { formatCount } from '../ui/format';

export type TwistId = 'normal' | 'tightMoney';

export interface Twist {
  id: TwistId;
  /** The twist's name on the result card and the start card. */
  name: string;
  /** One plain sentence for the player. */
  line: string;
  start: TowerStart;
}

/** Tight money starts with half the usual $2,000,000. */
export const TIGHT_MONEY_CASH = 1_000_000;

/** The twists, in a fixed order the date's hash indexes: never reorder, or past days change. */
export const TWISTS: readonly Twist[] = [
  { id: 'normal', name: 'Normal day', line: 'No twist today. Build the best tower you can.', start: {} },
  { id: 'tightMoney', name: 'Tight money', line: 'You start with less money today, so spend it with care.', start: { cash: TIGHT_MONEY_CASH } },
];

/**
 * How long a daily lasts: eight game days, from 06:00 on the first morning to 06:00 on the
 * ninth. At normal speed a game day is 17 daytime hours at 10 minutes a second (102 s) plus 7
 * night hours at eight times that (5.25 s), 107.25 s in all, so eight days are 858 s, about
 * 14 minutes 18 seconds. One quarter (three days, about 5 minutes 22 seconds) was too short.
 */
export const DAILY_DAYS = 8;
const OPENING_MINUTE = 6 * 60;
export const DAILY_END_MINUTE = OPENING_MINUTE + DAILY_DAYS * 1440;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date written YYYY-MM-DD. */
export function isDateKey(text: string): boolean {
  const m = DATE_RE.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** The player's local calendar date, YYYY-MM-DD. */
export function localDateKey(now: Date = new Date()): string {
  const y = String(now.getFullYear()).padStart(4, '0');
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** The date before, YYYY-MM-DD, by the calendar (never by 24 hours of wall time). */
export function previousDateKey(date: string): string {
  const m = DATE_RE.exec(date);
  if (!m) return date;
  const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) - 1));
  return `${String(day.getUTCFullYear()).padStart(4, '0')}-${String(day.getUTCMonth() + 1).padStart(2, '0')}-${String(day.getUTCDate()).padStart(2, '0')}`;
}

/** FNV-1a, 32 bit, over the text's UTF-16 code units, then mixed. Fixed forever: change it and every day's tower changes. */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // FNV-1a keeps the low bit of the last character, so without this final mix the twist would
  // simply alternate day by day. Murmur3's fmix32 spreads every input bit over the output.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** The day's starting number. Never shown to the player. */
export function dailyStart(date: string): number {
  return fnv1a(`hundred-stories/daily/start/${date}`);
}

/** The day's twist. */
export function dailyTwist(date: string): Twist {
  return TWISTS[fnv1a(`hundred-stories/daily/twist/${date}`) % TWISTS.length] as Twist;
}

/** The note the daily writes into the build log (BuildLog.mode), so a save knows its date. */
export function dailyMode(date: string): string {
  return `daily:${date}`;
}

/** The date a build log note names, or null when the tower is not a daily. */
export function dateOfMode(mode: string | undefined): string | null {
  if (!mode || !mode.startsWith('daily:')) return null;
  const date = mode.slice('daily:'.length);
  return isDateKey(date) ? date : null;
}

/** Has this daily run its course? A bankrupt tower is over too. */
export function dailyFinished(world: Pick<World, 'time' | 'gameOver'>): boolean {
  return world.time.minute >= DAILY_END_MINUTE || world.gameOver !== null;
}

/** The highest floor with a room on it: the same count the share card uses. */
function topFloor(world: World): number {
  let floors = 0;
  for (const room of world.rooms.values()) {
    const top = room.floor + room.height - 1;
    if (top > floors) floors = top;
  }
  return floors;
}

export interface DailyResult {
  date: string;
  twist: Twist;
  /** The score: workers, residents and guests, the sim's own population count. */
  people: number;
  floors: number;
  stars: number;
  money: number;
}

export function dailyResult(world: World, date: string): DailyResult {
  return { date, twist: dailyTwist(date), people: world.population, floors: topFloor(world), stars: world.stars, money: world.cash };
}

/** The link a daily share carries: today's tower on the date it was played. */
export function dailyShareUrl(date: string): string {
  return `${SITE_URL}play/?daily=${date}`;
}

/**
 * The share message. A daily from another date than `today` (finished after the choice) is named
 * by its date, the same words the result card uses, never "today's tower".
 */
export function dailyShareText(people: number, date?: string, today?: string): string {
  const which = date !== undefined && today !== undefined && date !== today ? `the tower from ${formatDateKey(date)}` : "today's tower";
  return `I got ${formatCount(people)} ${people === 1 ? 'person' : 'people'} in ${which}. Can you beat it?`;
}

/** The twist's line for a daily from another date than `today`: the same news, without "today". */
const OTHER_DAY_LINES: Record<TwistId, string> = {
  normal: 'No twist on that day. Build the best tower you can.',
  tightMoney: 'This tower starts with less money, so spend it with care.',
};

/** The twist's one sentence for the start card: its own line on its own date, date-free words on another. */
export function dailyTwistLine(date: string, today: string): string {
  const twist = dailyTwist(date);
  return date === today ? twist.line : OTHER_DAY_LINES[twist.id];
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "September 24, 2026" for the result card. */
export function formatDateKey(date: string): string {
  const m = DATE_RE.exec(date);
  if (!m) return date;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${Number(m[1])}`;
}

/**
 * What opening today's tower does, given the daily slot's save and the daily record: resume it
 * (it is today's), offer the choice (an unfinished tower from an earlier date), show a tower
 * dated after today (the device's date moved back) with the choice to start today's instead, or
 * start today's fresh (no save, a finished earlier one, or one that cannot be read). A fresh start
 * is only ever today's date, and never replaces a tower dated after today.
 *
 * The record (storage.ts, readDailyRecord) locks a date once played: 'clock-back' when today is
 * earlier than the newest date ever started or finished (one more than two days ahead is a clock
 * set wrong and counts as today, settleDailyRecord), 'done' when today's tower was already
 * finished and the slot no longer holds it. Neither ever starts a tower.
 */
export type DailyOpening = 'resume' | 'choose' | 'ahead' | 'fresh' | 'clock-back' | 'done';

export function dailyOpening(
  saved: { date: string | null; finished: boolean } | null,
  today: string,
  stored: DailyRecord = emptyDailyRecord(),
): DailyOpening {
  const record = settleDailyRecord(stored, today);
  if (record.latest !== null && today < record.latest) return 'clock-back';
  if (record.finished.includes(today)) return saved?.date === today ? 'resume' : 'done';
  if (!saved || saved.date === null) return 'fresh';
  if (saved.date === today) return 'resume';
  if (saved.date > today) return 'ahead';
  if (!saved.finished) return 'choose';
  return 'fresh';
}

/** The finished dates the record keeps: the newest this many. */
export const DAILY_RECORD_LIMIT = 60;

/** A device that never played a daily, or an install from before the record. */
export function emptyDailyRecord(): DailyRecord {
  return { latest: null, finished: [] };
}

/**
 * How far the record's newest date may run ahead of today and still be a real clock: across time
 * zones a device's date is at most about one day ahead of another's.
 */
export const DAILY_AHEAD_DAYS = 2;

/** Whole calendar days from `from` to `to` (both YYYY-MM-DD), or null when either is not a date. */
function daysBetween(from: string, to: string): number | null {
  const a = DATE_RE.exec(from);
  const b = DATE_RE.exec(to);
  if (!a || !b) return null;
  const ms = Date.UTC(Number(b[1]), Number(b[2]) - 1, Number(b[3])) - Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3]));
  return Math.round(ms / 86_400_000);
}

/**
 * The record as today should read it. A newest date more than two days after today came from a
 * clock set far ahead by mistake (or a dead clock), not from travel: it becomes today, so that
 * date does not lock Today's tower until it comes around. The finished dates are kept; one in
 * the future only ever locks that date. Returns the same record when nothing changes.
 */
export function settleDailyRecord(record: DailyRecord, today: string): DailyRecord {
  if (record.latest === null) return record;
  const ahead = daysBetween(today, record.latest);
  if (ahead === null || ahead <= DAILY_AHEAD_DAYS) return record;
  return { latest: today, finished: [...record.finished] };
}

function laterOf(a: string | null, b: string): string {
  return a !== null && a > b ? a : b;
}

/** A daily on `date` began: the newest date moves up to it, never back. */
export function noteDailyStarted(record: DailyRecord, date: string): DailyRecord {
  return { latest: laterOf(record.latest, date), finished: [...record.finished] };
}

/** A daily on `date` finished: its date joins the finished ones (newest 60 kept) and the newest date. */
export function noteDailyFinished(record: DailyRecord, date: string): DailyRecord {
  const finished = Array.from(new Set([...record.finished, date])).sort().slice(-DAILY_RECORD_LIMIT);
  return { latest: laterOf(record.latest, date), finished };
}

/**
 * The record to open with: the stored one (null when there is none, as on an install from before
 * it), with a finished daily in the slot added, so an older install's finished day is locked too.
 */
export function seedDailyRecord(stored: DailyRecord | null, saved: { date: string | null; finished: boolean } | null): DailyRecord {
  const record = stored ?? emptyDailyRecord();
  if (saved && saved.date !== null && saved.finished && !record.finished.includes(saved.date)) return noteDailyFinished(record, saved.date);
  return record;
}
