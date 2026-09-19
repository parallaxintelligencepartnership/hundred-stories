// Pure formatting helpers only: no DOM, so this file runs in the default vitest node environment.
import { describe, expect, it } from 'vitest';

import {
  dayLabel,
  formatClock,
  formatCount,
  formatDate,
  formatFloor,
  formatMoney,
  formatPercent,
  formatTimestamp,
  quarterLabel,
  starsGlyphs,
  stressBandLabel,
  stressBandOf,
  yearLabel,
} from '../../src/ui/format';

const DAY = 1440;
const QUARTER = 4320;
const YEAR = 17280;

describe('formatMoney', () => {
  it('groups thousands with commas and a leading dollar sign', () => {
    expect(formatMoney(1_234_000)).toBe('$1,234,000');
  });

  it('handles small amounts and zero', () => {
    expect(formatMoney(0)).toBe('$0');
    expect(formatMoney(999)).toBe('$999');
    expect(formatMoney(1_000)).toBe('$1,000');
  });

  it('puts the minus sign before the dollar sign', () => {
    expect(formatMoney(-500_000)).toBe('-$500,000');
  });

  it('rounds to whole dollars', () => {
    expect(formatMoney(1999.6)).toBe('$2,000');
  });

  it('formats the starting cash and the bankruptcy floor', () => {
    expect(formatMoney(2_000_000)).toBe('$2,000,000');
    expect(formatMoney(-500_000)).toBe('-$500,000');
  });
});

describe('formatCount', () => {
  it('groups populations', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(300)).toBe('300');
    expect(formatCount(15_000)).toBe('15,000');
  });
});

describe('formatClock', () => {
  it('shows a 12 hour clock with AM and PM', () => {
    expect(formatClock(9 * 60 + 5)).toBe('9:05 AM');
    expect(formatClock(13 * 60 + 40)).toBe('1:40 PM');
  });

  it('shows midnight and noon as 12', () => {
    expect(formatClock(0)).toBe('12:00 AM');
    expect(formatClock(12 * 60)).toBe('12:00 PM');
  });

  it('pads single digit minutes', () => {
    expect(formatClock(7 * 60 + 9)).toBe('7:09 AM');
    expect(formatClock(23 * 60 + 59)).toBe('11:59 PM');
  });

  it('wraps by day so a total minute count works', () => {
    expect(formatClock(3 * DAY + 9 * 60 + 5)).toBe('9:05 AM');
  });
});

describe('day labels', () => {
  it('names the two weekdays and the weekend day of each quarter', () => {
    expect(dayLabel(0)).toBe('Weekday 1');
    expect(dayLabel(DAY)).toBe('Weekday 2');
    expect(dayLabel(2 * DAY)).toBe('Weekend');
  });

  it('repeats the cycle every three days', () => {
    expect(dayLabel(3 * DAY + 600)).toBe('Weekday 1');
    expect(dayLabel(5 * DAY)).toBe('Weekend');
  });
});

describe('quarter and year labels', () => {
  it('counts quarters from one within a year', () => {
    expect(quarterLabel(0)).toBe('Quarter 1');
    expect(quarterLabel(QUARTER)).toBe('Quarter 2');
    expect(quarterLabel(3 * QUARTER)).toBe('Quarter 4');
  });

  it('starts over at quarter one in the next year', () => {
    expect(quarterLabel(YEAR)).toBe('Quarter 1');
  });

  it('counts years from one', () => {
    expect(yearLabel(0)).toBe('Year 1');
    expect(yearLabel(YEAR - 1)).toBe('Year 1');
    expect(yearLabel(YEAR)).toBe('Year 2');
  });

  it('writes a full date in sentence case', () => {
    expect(formatDate(YEAR + QUARTER + DAY)).toBe('Weekday 2, quarter 2, year 2');
  });

  it('stamps log lines with the day and the clock', () => {
    expect(formatTimestamp(2 * DAY + 9 * 60 + 5)).toBe('Weekend 9:05 AM');
  });
});

describe('small readouts', () => {
  it('draws stars as glyphs and names the top rank Tower', () => {
    expect(starsGlyphs(1)).toBe('★');
    expect(starsGlyphs(5)).toBe('★★★★★');
    expect(starsGlyphs(6)).toBe('Tower');
  });

  it('names floors and basements', () => {
    expect(formatFloor(1)).toBe('Floor 1');
    expect(formatFloor(12)).toBe('Floor 12');
    expect(formatFloor(-2)).toBe('Basement 2');
  });

  it('rounds evaluation to whole percent', () => {
    expect(formatPercent(0.725)).toBe('73%');
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(1)).toBe('100%');
  });

  it('bands stress by the rules thresholds', () => {
    expect(stressBandOf(0)).toBe('calm');
    expect(stressBandOf(0.34)).toBe('calm');
    expect(stressBandOf(0.35)).toBe('pink');
    expect(stressBandOf(0.7)).toBe('red');
    expect(stressBandLabel(stressBandOf(0.9))).toBe('Very stressed');
  });
});
