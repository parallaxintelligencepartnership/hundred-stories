// Today's tower: the date gives everyone the same start and twist, the day lasts about fifteen
// minutes, and the result and the share text read the sim's own numbers.
import { describe, expect, it } from 'vitest';
import {
  DAILY_DAYS,
  DAILY_END_MINUTE,
  TIGHT_MONEY_CASH,
  TWISTS,
  DAILY_RECORD_LIMIT,
  dailyOpening,
  emptyDailyRecord,
  noteDailyFinished,
  noteDailyStarted,
  seedDailyRecord,
  dailyResult,
  dailyShareText,
  dailyShareUrl,
  dailyStart,
  dailyTwist,
  dateOfMode,
  dailyMode,
  formatDateKey,
  isDateKey,
  localDateKey,
  previousDateKey,
} from '../../src/game/daily';
import { NIGHT_MULTIPLIER } from '../../src/game/api';
import { SCHEDULES } from '../../src/sim/rules';
import { createWorld } from '../../src/sim/world';

function datesFrom(first: string, count: number): string[] {
  const out: string[] = [];
  const day = new Date(`${first}T12:00:00Z`);
  for (let i = 0; i < count; i++) {
    out.push(day.toISOString().slice(0, 10));
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return out;
}

describe('the date to the start and the twist', () => {
  it('is fixed for a date: these values never change, or every past day would', () => {
    expect(dailyStart('2026-09-24')).toBe(dailyStart('2026-09-24'));
    expect(dailyStart('2026-09-24')).toBe(3323031062);
    expect(dailyTwist('2026-09-24').id).toBe('normal');
    expect(dailyStart('2026-09-28')).toBe(1299633931);
    expect(dailyTwist('2026-09-28').id).toBe('tightMoney');
  });

  it('differs across dates, and every twist turns up', () => {
    const dates = datesFrom('2026-01-01', 365);
    expect(new Set(dates.map(dailyStart)).size).toBe(365);
    const twists = new Set(dates.map((d) => dailyTwist(d).id));
    expect([...twists].sort()).toEqual(TWISTS.map((t) => t.id).sort());
  });

  it('uses only knobs the sim has: Tight money is less starting cash, Normal day changes nothing', () => {
    expect(TWISTS.map((t) => t.name)).toEqual(['Normal day', 'Tight money']);
    const tight = TWISTS.find((t) => t.id === 'tightMoney')!;
    expect(tight.start).toEqual({ cash: TIGHT_MONEY_CASH });
    expect(createWorld(1, tight.start).cash).toBe(TIGHT_MONEY_CASH);
    expect(TWISTS.find((t) => t.id === 'normal')!.start).toEqual({});
    for (const t of TWISTS) expect(t.line.split(/[.!?]/).filter((s) => s.trim()).length).toBeLessThanOrEqual(2);
  });

  it('reads the local calendar date, and the date before by the calendar', () => {
    expect(localDateKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(previousDateKey('2026-03-01')).toBe('2026-02-28');
    expect(previousDateKey('2027-01-01')).toBe('2026-12-31');
    expect(isDateKey('2026-02-30')).toBe(false);
    expect(dateOfMode(dailyMode('2026-09-24'))).toBe('2026-09-24');
    expect(dateOfMode('daily:today')).toBe(null);
  });
});

describe('how long a daily lasts', () => {
  it('runs eight game days, about fifteen minutes at normal speed', () => {
    expect(DAILY_DAYS).toBe(8);
    expect(DAILY_END_MINUTE).toBe(360 + 8 * 1440);
    // Ten game minutes a second by day, NIGHT_MULTIPLIER times that between nightStart and nightEnd.
    const nightMinutes = 1440 - SCHEDULES.nightStart + SCHEDULES.nightEnd;
    const secondsPerDay = (1440 - nightMinutes) / 10 + nightMinutes / (10 * NIGHT_MULTIPLIER);
    const seconds = DAILY_DAYS * secondsPerDay;
    expect(seconds).toBe(858);
    expect(seconds).toBeGreaterThan(13 * 60);
    expect(seconds).toBeLessThan(17 * 60);
  });
});

describe('the result and the share', () => {
  it('scores people from the sim population, with floors, stars and money beside it', () => {
    const world = createWorld(5);
    world.population = 1234;
    world.stars = 3;
    world.cash = 456_000;
    world.rooms.set(1, { floor: 7, height: 1 } as never);
    const result = dailyResult(world, '2026-09-24');
    expect(result).toMatchObject({ date: '2026-09-24', people: 1234, floors: 7, stars: 3, money: 456_000 });
    expect(result.twist.name).toBe(dailyTwist('2026-09-24').name);
    expect(formatDateKey('2026-09-24')).toBe('September 24, 2026');
  });

  it('shares the plain message and a link to the same day', () => {
    expect(dailyShareText(1234)).toBe("I got 1,234 people in today's tower. Can you beat it?");
    expect(dailyShareUrl('2026-09-24')).toBe('https://hundredstories.xyz/play/?daily=2026-09-24');
  });
});

describe('opening the daily slot', () => {
  const today = '2026-09-24';
  it('starts fresh with no save, resumes today, and offers the choice for an unfinished older one', () => {
    expect(dailyOpening(null, today)).toBe('fresh');
    expect(dailyOpening({ date: today, finished: false }, today)).toBe('resume');
    expect(dailyOpening({ date: today, finished: true }, today)).toBe('resume');
    expect(dailyOpening({ date: '2026-09-23', finished: false }, today)).toBe('choose');
    expect(dailyOpening({ date: '2026-09-20', finished: false }, today)).toBe('choose');
    expect(dailyOpening({ date: '2026-09-23', finished: true }, today)).toBe('fresh');
    expect(dailyOpening({ date: null, finished: false }, today)).toBe('fresh');
  });
});

describe('the daily record locks a date once played', () => {
  const finishedOn = (...dates: string[]) => dates.reduce(noteDailyFinished, emptyDailyRecord());

  it('a clock moved back to a finished date opens nothing new', () => {
    const record = finishedOn('2026-09-23', '2026-09-24');
    // The slot holds the 24th, finished: before the record this was 'ahead', with a fresh start on offer.
    expect(dailyOpening({ date: '2026-09-24', finished: true }, '2026-09-23', record)).toBe('clock-back');
    expect(dailyOpening(null, '2026-09-23', record)).toBe('clock-back');
    expect(dailyOpening(null, '2026-09-20', record)).toBe('clock-back');
  });

  it('forward then back: the later date started, the earlier one is locked until the date catches up', () => {
    let record = noteDailyStarted(emptyDailyRecord(), '2026-09-24');
    record = noteDailyStarted(record, '2026-09-26'); // the clock moved forward and that day began
    expect(record).toEqual({ latest: '2026-09-26', finished: [] });
    expect(dailyOpening({ date: '2026-09-26', finished: false }, '2026-09-24', record)).toBe('clock-back');
    expect(dailyOpening({ date: '2026-09-26', finished: false }, '2026-09-25', record)).toBe('clock-back');
    // Once the date catches up, it is today's tower again.
    expect(dailyOpening({ date: '2026-09-26', finished: false }, '2026-09-26', record)).toBe('resume');
    expect(dailyOpening({ date: '2026-09-26', finished: false }, '2026-09-27', record)).toBe('choose');
    // A started date moves latest up, never back.
    expect(noteDailyStarted(record, '2026-09-20').latest).toBe('2026-09-26');
  });

  it('today, finished, with the slot no longer holding it, is done; holding it, it resumes', () => {
    const record = finishedOn('2026-09-24');
    expect(dailyOpening(null, '2026-09-24', record)).toBe('done');
    expect(dailyOpening({ date: '2026-09-23', finished: false }, '2026-09-24', record)).toBe('done');
    expect(dailyOpening({ date: '2026-09-24', finished: true }, '2026-09-24', record)).toBe('resume');
    expect(dailyOpening({ date: '2026-09-24', finished: true }, '2026-09-25', record)).toBe('fresh'); // the next day is new
  });

  it('a fresh device opens as before', () => {
    const record = emptyDailyRecord();
    expect(record).toEqual({ latest: null, finished: [] });
    expect(dailyOpening(null, '2026-09-24', record)).toBe('fresh');
    expect(dailyOpening({ date: '2026-09-25', finished: false }, '2026-09-24', record)).toBe('ahead');
    expect(dailyOpening({ date: '2026-09-23', finished: false }, '2026-09-24', record)).toBe('choose');
  });

  it('an older install with no record is seeded from a finished daily in the slot', () => {
    const seeded = seedDailyRecord(null, { date: '2026-09-24', finished: true });
    expect(seeded).toEqual({ latest: '2026-09-24', finished: ['2026-09-24'] });
    expect(dailyOpening({ date: '2026-09-24', finished: true }, '2026-09-24', seeded)).toBe('resume');
    expect(dailyOpening({ date: '2026-09-24', finished: true }, '2026-09-23', seeded)).toBe('clock-back');
    // An unfinished one, an undated one or none seeds nothing; a stored record is kept as it is.
    expect(seedDailyRecord(null, { date: '2026-09-24', finished: false })).toEqual(emptyDailyRecord());
    expect(seedDailyRecord(null, { date: null, finished: true })).toEqual(emptyDailyRecord());
    expect(seedDailyRecord(null, null)).toEqual(emptyDailyRecord());
    const stored = finishedOn('2026-09-26');
    expect(seedDailyRecord(stored, { date: '2026-09-24', finished: true })).toEqual({ latest: '2026-09-26', finished: ['2026-09-24', '2026-09-26'] });
  });

  it('keeps the newest 60 finished dates', () => {
    const dates = datesFrom('2026-06-01', DAILY_RECORD_LIMIT + 5);
    const record = finishedOn(...dates);
    expect(record.finished).toHaveLength(DAILY_RECORD_LIMIT);
    expect(record.finished).toEqual(dates.slice(-DAILY_RECORD_LIMIT));
    expect(record.latest).toBe(dates[dates.length - 1]);
    expect(noteDailyFinished(record, dates[dates.length - 1]!).finished).toHaveLength(DAILY_RECORD_LIMIT); // no doubles
  });
});
