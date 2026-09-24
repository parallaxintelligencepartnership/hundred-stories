// The VIP card: who is coming, what they care about, what to prepare, and after the visit why
// it rated as it did and when the next chance comes. Pure words from the world, no DOM, so the
// event log panel draws it and the tests read it directly.

import { EVENT_ROLL_MINUTE_OF_DAY, vipSafetyBand, vipWaitBand } from '../sim/events';
import { personName } from '../sim/identity';
import { EVENTS } from '../sim/rules';
import { carCovers, clockOf } from '../sim/types';
import type { ActiveEvent, Room, VipRating, VipVisitRecord, World } from '../sim/types';
import { formatClock, formatDate } from './format';

type VipEvent = Extract<ActiveEvent, { kind: 'vip' }>;

/** The slice of the world the card reads; every part optional so a partial test world is fine. */
export type VipWorld = Pick<World, 'seed' | 'time'> & {
  events?: World['events'];
  stats?: Partial<Pick<World['stats'], 'lastVip'>>;
  stars?: World['stars'];
  rooms?: World['rooms'];
  shafts?: World['shafts'];
};

export interface VipCheck {
  label: string;
  done: boolean;
}

export interface VipRow {
  label: string;
  value: string;
}

export interface VipView {
  /** Name and role, preference, and where the visit stands. */
  lines: string[];
  /** Live preparation ticks while a visit is booked or under way; null otherwise. */
  checklist: VipCheck[] | null;
  /** Why the last visit rated as it did; null before the first rating or while a new visit runs. */
  breakdown: VipRow[] | null;
  /** One line on when a visit can come next, in the words of the daily roll rule. */
  nextChance: string | null;
}

const MINUTES_PER_DAY = 1440;
const MINUTES_PER_QUARTER = 3 * MINUTES_PER_DAY;

function floorText(floor: number): string {
  return floor < 0 ? `floor B${-floor}` : `floor ${floor}`;
}

function cap(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function minutesWord(n: number): string {
  return n === 1 ? '1 minute' : `${n} minutes`;
}

function activeVisit(world: VipWorld): VipEvent | undefined {
  return (world.events ?? []).find((e): e is VipEvent => e.kind === 'vip');
}

function suiteOf(world: VipWorld, visit: VipEvent): Room | undefined {
  return visit.suiteId === null ? undefined : world.rooms?.get(visit.suiteId);
}

/** Does a car a hotel guest may ride stop at this floor and at the lobby? The lobby floor needs none. */
function elevatorServes(world: VipWorld, floor: number): boolean {
  if (floor === 1) return true;
  for (const shaft of world.shafts?.values() ?? []) {
    if (shaft.kind === 'service') continue;
    if (!shaft.stops.has(floor) || !shaft.stops.has(1)) continue;
    const car = shaft.cars.find(
      (c) => (c.serves === 'any' || c.serves === 'hotel') && carCovers(shaft, c, floor) && carCovers(shaft, c, 1),
    );
    if (car) return true;
  }
  return false;
}

function incidentActive(world: VipWorld): boolean {
  return (world.events ?? []).some((e) => e.kind === 'fire' || e.kind === 'bomb');
}

/** The four things to get ready, ticked from the live tower. */
export function vipChecklist(world: VipWorld, visit: VipEvent): VipCheck[] {
  const suite = suiteOf(world, visit);
  const floor = suite ? suite.floor : null;
  return [
    { label: 'A suite is ready for them', done: suite !== undefined },
    { label: 'The suite is clean', done: suite !== undefined && !suite.dirty && !suite.infested },
    {
      label: floor === null ? 'An elevator stops at the suite floor' : floor === 1 ? 'The suite is on the lobby floor' : `An elevator stops at ${floorText(floor)}`,
      done: floor !== null && elevatorServes(world, floor),
    },
    { label: 'No fire or bomb in the tower', done: !incidentActive(world) },
  ];
}

function statusLine(world: VipWorld, visit: VipEvent): string {
  const suite = suiteOf(world, visit);
  const where = suite ? `the suite on ${floorText(suite.floor)}` : 'the suite';
  switch (visit.phase) {
    case 'notice':
      return `Arrives at the lobby ${formatDate(visit.arrivesAt).toLowerCase()} at ${formatClock(visit.arrivesAt)}`;
    case 'route':
      return visit.longestWait > 0
        ? `On the way up to ${where}, longest wait so far ${minutesWord(visit.longestWait)}`
        : `On the way up to ${where}`;
    case 'stay':
      return `Staying in ${where} until ${formatClock(visit.leavesAt)}`;
    case 'checkout':
      return 'Checked out and on the way out of the tower';
  }
}

const RATING_WORD: Record<VipRating, string> = { poor: 'poor', fair: 'fair', good: 'good' };

/** The rows that explain a finished visit. */
export function vipBreakdown(record: VipVisitRecord): VipRow[] {
  const rows: VipRow[] = [];
  if (record.reason) rows.push({ label: 'Visit', value: record.reason });
  rows.push({ label: 'Longest wait', value: `${minutesWord(record.longestWait)} (${RATING_WORD[vipWaitBand(record.longestWait)]})` });
  rows.push({ label: 'Suite clean', value: record.suiteClean === null ? 'Never reached' : record.suiteClean ? 'Yes' : 'No' });
  if (record.suiteClean !== null) rows.push({ label: 'Suite rating', value: cap(RATING_WORD[record.suiteBand]) });
  rows.push({ label: 'Fire or bomb', value: vipSafetyBand(record.incident) === 'poor' ? 'Yes' : 'No' });
  rows.push({ label: 'Rating', value: cap(RATING_WORD[record.rating]) });
  return rows;
}

/** The next 6:00 AM on the first day of a quarter, at or after this minute. */
function nextRollMinute(minute: number): number {
  const quarterStart = minute - (minute % MINUTES_PER_QUARTER);
  const roll = quarterStart + EVENT_ROLL_MINUTE_OF_DAY;
  return roll >= minute ? roll : roll + MINUTES_PER_QUARTER;
}

/**
 * When the next visit can come, stated the way rollDailyEvents decides it: once a quarter at
 * the morning roll on its first day, a chance, from the minimum star, with a clean, empty suite.
 */
export function vipNextChance(world: VipWorld): string {
  const percent = Math.round(EVENTS.vip.quarterlyChance * 100);
  const rule = `VIP visits are rolled at ${formatClock(EVENT_ROLL_MINUTE_OF_DAY)} on the first day of each quarter, a ${percent}% chance while you have ${EVENTS.vip.minStar} stars and a clean, empty suite.`;
  if (activeVisit(world)) return rule;
  const next = nextRollMinute(world.time.minute + 1);
  const clock = clockOf(next);
  return `Next chance: ${formatDate(next).toLowerCase()} at ${formatClock(clock.minuteOfDay)}. ${rule}`;
}

/** Everything the card shows, or null when there is nothing to say yet. */
export function vipView(world: VipWorld): VipView | null {
  const visit = activeVisit(world);
  if (visit) {
    return {
      lines: [
        `${personName(world.seed, visit.simId)}, VIP guest`,
        `Cares most about ${visit.preference}`,
        statusLine(world, visit),
      ],
      checklist: vipChecklist(world, visit),
      breakdown: null,
      nextChance: null,
    };
  }
  const last = world.stats?.lastVip;
  if (last) {
    return {
      lines: [`${personName(world.seed, last.simId)}, VIP guest`, `Cared most about ${last.preference}`],
      checklist: null,
      breakdown: vipBreakdown(last),
      nextChance: vipNextChance(world),
    };
  }
  if ((world.stars ?? 1) < EVENTS.vip.minStar) return null;
  return { lines: ['No VIP has visited yet'], checklist: null, breakdown: null, nextChance: vipNextChance(world) };
}

/** A key that changes whenever the card's words do, so the panel rebuilds only then. */
export function vipViewKey(view: VipView | null): string {
  if (!view) return '';
  const checks = view.checklist ? view.checklist.map((c) => `${c.label}=${c.done ? 1 : 0}`).join('|') : '';
  const rows = view.breakdown ? view.breakdown.map((r) => `${r.label}=${r.value}`).join('|') : '';
  return [view.lines.join('|'), checks, rows, view.nextChance ?? ''].join('#');
}
