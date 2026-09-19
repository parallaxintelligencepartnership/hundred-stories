// Pure display formatting for the UI. No DOM, so it is safe to import anywhere, tests included.
// Every string here is sentence case, US spelling, and free of dashes used as punctuation.

import { STRESS } from '../sim/rules';
import { clockOf } from '../sim/types';
import type { Star, StressBand } from '../sim/types';

/** 1234000 becomes "1,234,000". Locale independent so saves and tests never drift. */
export function formatCount(value: number): string {
  const whole = Math.round(value);
  const sign = whole < 0 ? '-' : '';
  const digits = String(Math.abs(whole));
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits.charAt(i);
  }
  return sign + out;
}

/** 1234000 becomes "$1,234,000"; a debt becomes "-$500,000". */
export function formatMoney(dollars: number): string {
  const whole = Math.round(dollars);
  return `${whole < 0 ? '-' : ''}$${formatCount(Math.abs(whole))}`;
}

/** A signed amount for the finances panel: "+$10,000" or "-$4,000". */
export function formatSignedMoney(dollars: number): string {
  const whole = Math.round(dollars);
  if (whole === 0) return '$0';
  return `${whole < 0 ? '-' : '+'}$${formatCount(Math.abs(whole))}`;
}

/** A total minute count becomes a wall clock reading: "9:05 AM". */
export function formatClock(minute: number): string {
  const { hour, minuteOfDay } = clockOf(Math.max(0, Math.floor(minute)));
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  const minutes = String(minuteOfDay % 60).padStart(2, '0');
  return `${hour12}:${minutes} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** Days run in threes: two weekdays then a weekend day. */
export function dayLabel(minute: number): string {
  const { dayOfQuarter } = clockOf(Math.max(0, Math.floor(minute)));
  if (dayOfQuarter === 2) return 'Weekend';
  return `Weekday ${dayOfQuarter + 1}`;
}

export function quarterLabel(minute: number): string {
  return `Quarter ${clockOf(Math.max(0, Math.floor(minute))).quarter + 1}`;
}

export function yearLabel(minute: number): string {
  return `Year ${clockOf(Math.max(0, Math.floor(minute))).year}`;
}

/** The long form for the top strip and the log header: "Weekday 2, quarter 2, year 2". */
export function formatDate(minute: number): string {
  const clock = clockOf(Math.max(0, Math.floor(minute)));
  return `${dayLabel(minute)}, quarter ${clock.quarter + 1}, year ${clock.year}`;
}

/** The short form for log lines: "Weekend 9:05 AM". */
export function formatTimestamp(minute: number): string {
  return `${dayLabel(minute)} ${formatClock(minute)}`;
}

/** Stars as text glyphs; the sixth rank is Tower status and has no glyphs. */
export function starsGlyphs(stars: Star | number): string {
  const rank = Math.max(1, Math.min(6, Math.round(stars)));
  if (rank === 6) return 'Tower';
  return '★'.repeat(rank);
}

export function starsTitle(stars: Star | number): string {
  const rank = Math.max(1, Math.min(6, Math.round(stars)));
  if (rank === 6) return 'Tower status';
  return rank === 1 ? '1 star' : `${rank} stars`;
}

export function formatFloor(floor: number): string {
  return floor < 0 ? `Basement ${Math.abs(floor)}` : `Floor ${floor}`;
}

/** The compact form for the cursor readout: "Floor 12" above ground, "B3" below it. */
export function formatFloorShort(floor: number): string {
  return floor < 0 ? `B${Math.abs(floor)}` : `Floor ${floor}`;
}

export function formatFloorRange(floorMin: number, floorMax: number): string {
  return `${formatFloor(floorMin)} to ${formatFloor(floorMax).toLowerCase()}`;
}

export function formatPercent(fraction: number): string {
  return `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
}

export function stressBandOf(stress: number): StressBand {
  if (stress >= STRESS.red) return 'red';
  if (stress >= STRESS.pink) return 'pink';
  return 'calm';
}

export function stressBandLabel(band: StressBand): string {
  if (band === 'red') return 'Very stressed';
  if (band === 'pink') return 'Stressed';
  return 'Calm';
}
