// The VIP card: who is coming, what they like, what to prepare, and after the visit why it
// rated as it did, what that means for the fourth star and when the next chance comes. Pure words
// from the world, no DOM, so Stories and the alert cards (vip-cards.ts) draw it and the tests read
// it directly. No scoring here: the rating and its reasons are the sim's (vipWaitBand,
// vipSafetyBand, the saved record), and the preference is character only, never scoring.

import { MINUTES_PER_QUARTER } from '../sim/economy';
import { EVENT_ROLL_MINUTE_OF_DAY, vipSafetyBand, vipWaitBand } from '../sim/events';
import { personName } from '../sim/identity';
import { EVENTS, STARS } from '../sim/rules';
import { entrances, findRoute } from '../sim/routing';
import { clockOf, riderClassOf } from '../sim/types';
import type { ActiveEvent, Id, Room, VipPreference, VipRating, VipVisitRecord, World } from '../sim/types';
import { formatClock } from './format';

type VipEvent = Extract<ActiveEvent, { kind: 'vip' }>;

/** The slice of the world the card reads; every part optional so a partial test world is fine. */
export type VipWorld = Pick<World, 'seed' | 'time'> & {
  events?: World['events'];
  stats?: Partial<Pick<World['stats'], 'lastVip' | 'vipRating'>>;
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

/** A finished visit as the departure card and Stories show it. */
export interface VipResult {
  simId: Id;
  name: string;
  rating: VipRating;
  /** The rating as the headline word: Good, Fair or Poor. */
  headline: string;
  /** The visit ended before the stay. */
  leftEarly: boolean;
  /** "Checked out." or "Left early." */
  outcome: string;
  /** The reasons, straight from vipBreakdown, without its Rating row (the headline says it). */
  reasons: VipRow[];
  /** What the visit means for the fourth star. */
  progress: string;
  /** When a new VIP may book, in plain words. */
  next: string;
}

export interface VipView {
  /** Booked and on the way, in the tower, or the last result. */
  stage: 'booked' | 'visiting' | 'result';
  simId: Id;
  name: string;
  /** Name and role, where the visit stands, the suite, what they like and what they rate. */
  lines: string[];
  /** Live preparation ticks while a visit is booked or under way; null otherwise. */
  checklist: VipCheck[] | null;
  /** Why the last visit rated as it did; null while a visit runs. */
  breakdown: VipRow[] | null;
  /** The last visit, laid out as the departure card shows it; null while a visit runs. */
  result: VipResult | null;
  /** When a visit can come next, with the rule; null while a visit runs. */
  nextChance: string | null;
}

/** What every visit is rated on, whatever the guest likes. */
export const VIP_RATED_ON = 'Every VIP rates the same three things: the longest elevator wait, the suite and safety.';

/** A guest's preference, as character: it does not change the rating. */
export function vipLikes(preference: VipPreference): string {
  return `Likes: ${preference}`;
}

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

/**
 * Can the VIP get from the lobby door to the suite, the way the sim routes a hotel guest
 * (sendVipToSuite: stairs, escalators, any car a guest may ride, a sky lobby transfer)? A world
 * without the parts routing reads (a partial test world) answers no.
 */
function vipCanReach(world: VipWorld, suite: Room): boolean {
  if (!isRoutable(world)) return false;
  const door = entrances(world).find((p) => p.floor === 1);
  if (!door) return false;
  const center = suite.x + Math.floor(suite.width / 2);
  return findRoute(world, door, { floor: suite.floor, x: center }, { riderClass: riderClassOf('vip') }) !== null;
}

function isRoutable(world: VipWorld): world is World {
  return world.rooms instanceof Map && world.shafts instanceof Map;
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
      label: floor === null ? 'The VIP can get to the suite' : floor === 1 ? 'The suite is on the lobby floor' : `The VIP can get to ${floorText(floor)}`,
      done: suite !== undefined && vipCanReach(world, suite),
    },
    // Once the VIP is in the tower, a fire or bomb that has come and gone still spoils the
    // visit (the sim records it on the visit), so the tick stays off after it is out.
    visit.phase === 'notice'
      ? { label: 'No fire or bomb in the tower', done: !incidentActive(world) }
      : { label: 'No fire or bomb during the visit', done: !incidentActive(world) && !visit.incident },
  ];
}

/**
 * When a minute comes, in plain words from now, with no day numbers: "this afternoon at 3:00 PM",
 * "tomorrow morning at 9:00 AM", "in 2 days, in the evening at 5:00 PM".
 */
export function whenWords(now: number, at: number): string {
  const days = Math.floor(Math.max(0, at) / 1440) - Math.floor(Math.max(0, now) / 1440);
  const hour = clockOf(Math.max(0, at)).hour;
  const part = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  const day = days <= 0 ? `this ${part}` : days === 1 ? `tomorrow ${part}` : `in ${days} days, in the ${part}`;
  return `${day} at ${formatClock(at)}`;
}

/** When the VIP walks into the lobby, from now. A booking past its hour waits for a fire to go out. */
export function vipArrivalLine(now: number, arrivesAt: number): string {
  return arrivesAt <= now ? 'Waiting outside until the fire is out' : `Arrives ${whenWords(now, arrivesAt)}`;
}

/** The booked suite, by floor: "Suite on floor 3", or that none is ready. */
export function vipSuiteLine(world: VipWorld, visit: VipEvent): string {
  const suite = suiteOf(world, visit);
  return suite ? `Suite on ${floorText(suite.floor)}` : 'No suite is ready';
}

function statusLine(world: VipWorld, visit: VipEvent): string {
  const suite = suiteOf(world, visit);
  const where = suite ? `the suite on ${floorText(suite.floor)}` : 'the suite';
  switch (visit.phase) {
    case 'notice':
      return vipArrivalLine(world.time.minute, visit.arrivesAt);
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
const RATING_ORDER: Record<VipRating, number> = { poor: 0, fair: 1, good: 2 };

/** "The VIP left: no suite was ready" as the row says it: "No suite was ready". */
function leftEarlyWords(reason: string): string {
  return cap(reason.replace(/^The VIP left:\s*/, '').replace(/\.$/, ''));
}

/** The suite row: where it was (when the record kept it) and how it was found. */
function suiteWords(record: VipVisitRecord): string {
  let state: string;
  if (record.suiteClean === null) state = 'never reached';
  else if (!record.suiteClean) state = `not clean (${RATING_WORD[record.suiteBand]})`;
  else if (record.suiteBand === 'good') state = 'clean (good)';
  else state = `clean, but rated low (${RATING_WORD[record.suiteBand]})`;
  return record.suiteFloor === undefined ? cap(state) : `${cap(floorText(record.suiteFloor))}, ${state}`;
}

/** The rows that explain a finished visit: why they left early, the wait, the suite, safety, the rating. */
export function vipBreakdown(record: VipVisitRecord): VipRow[] {
  const rows: VipRow[] = [];
  if (record.reason) rows.push({ label: 'Left early', value: leftEarlyWords(record.reason) });
  rows.push({ label: 'Longest wait', value: `${minutesWord(record.longestWait)} (${RATING_WORD[vipWaitBand(record.longestWait)]})` });
  rows.push({ label: 'Suite', value: suiteWords(record) });
  const safety = vipSafetyBand(record.incident);
  rows.push({ label: 'Safety', value: safety === 'poor' ? `A fire or bomb (${safety})` : `No fire or bomb (${safety})` });
  rows.push({ label: 'Rating', value: cap(RATING_WORD[record.rating]) });
  return rows;
}

/** The next 6:00 AM on the first day of a quarter, at or after this minute. */
function nextRollMinute(minute: number): number {
  const quarterStart = minute - (minute % MINUTES_PER_QUARTER);
  const roll = quarterStart + EVENT_ROLL_MINUTE_OF_DAY;
  return roll >= minute ? roll : roll + MINUTES_PER_QUARTER;
}

/** The next morning roll in words: "today", "tomorrow" or "in 2 days", and its clock. */
function nextRoll(now: number): { day: string; clock: string } {
  const next = nextRollMinute(now + 1);
  const days = Math.floor(next / 1440) - Math.floor(Math.max(0, now) / 1440);
  return { day: days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`, clock: formatClock(clockOf(next).minuteOfDay) };
}

/** The short line on the departure card: when a new VIP may book. */
export function vipNextWhen(world: VipWorld): string {
  const { day, clock } = nextRoll(world.time.minute);
  return `A new VIP may book ${day} at ${clock}.`;
}

/** How a visit gets booked, in the words of the daily roll rule. */
export function vipRule(): string {
  const percent = Math.round(EVENTS.vip.quarterlyChance * 100);
  return `On the first day of each quarter at ${formatClock(EVENT_ROLL_MINUTE_OF_DAY)}, there is a ${percent}% chance a VIP books a visit, if you have at least ${EVENTS.vip.minStar} stars and a clean, empty suite.`;
}

/**
 * When the next visit can come, stated the way rollDailyEvents decides it: once a quarter at
 * the morning roll on its first day, a chance, from the minimum star, with a clean, empty suite.
 */
export function vipNextChance(world: VipWorld): string {
  const rule = vipRule();
  if (activeVisit(world)) return rule;
  const { day, clock } = nextRoll(world.time.minute);
  return `Next chance: ${day} at ${clock}. ${rule}`;
}

/** The star whose rule asks for a VIP rating, and the rating it asks for. */
function vipStar(): { star: number; need: VipRating } | null {
  for (const [star, rule] of Object.entries(STARS)) {
    if (rule.requires.vipRating !== undefined) return { star: Number(star), need: rule.requires.vipRating };
  }
  return null;
}

/**
 * What the visits mean for the star that asks for a VIP rating (STARS[4] today), from that rule,
 * the tower's stars and the best visit so far, the one the stars read.
 */
export function vipProgress(world: VipWorld): string {
  const rule = vipStar();
  if (!rule) return '';
  const stars = `${rule.star} stars`;
  if ((world.stars ?? 1) >= rule.star) return `Your tower already has ${stars}, so the VIP rating already counted.`;
  const ask = `A ${RATING_WORD[rule.need]} or better visit is needed for ${stars}.`;
  const best = world.stats?.vipRating ?? 'none';
  if (best === 'none') return `${ask} No visit has been rated yet.`;
  return RATING_ORDER[best] >= RATING_ORDER[rule.need]
    ? `${ask} Your best so far is ${best}, so that part is done.`
    : `${ask} Your best so far is ${best}.`;
}

/** A finished visit, as the departure card and Stories lay it out. */
export function vipResult(world: VipWorld, record: VipVisitRecord): VipResult {
  const leftEarly = record.reason !== null;
  return {
    simId: record.simId,
    name: personName(world.seed, record.simId),
    rating: record.rating,
    headline: cap(RATING_WORD[record.rating]),
    leftEarly,
    outcome: leftEarly ? 'Left early.' : 'Checked out.',
    reasons: vipBreakdown(record).filter((row) => row.label !== 'Rating'),
    progress: vipProgress(world),
    next: vipNextWhen(world),
  };
}

/**
 * Everything the Stories section shows, or null when there has never been a visit and none is
 * booked: the booking or the stay with the live checklist, else the last result.
 */
export function vipView(world: VipWorld): VipView | null {
  const visit = activeVisit(world);
  if (visit) {
    const name = personName(world.seed, visit.simId);
    const lines = [`${name}, VIP guest`, statusLine(world, visit)];
    if (visit.phase === 'notice') lines.push(vipSuiteLine(world, visit));
    lines.push(vipLikes(visit.preference), VIP_RATED_ON);
    return {
      stage: visit.phase === 'notice' ? 'booked' : 'visiting',
      simId: visit.simId,
      name,
      lines,
      checklist: vipChecklist(world, visit),
      breakdown: null,
      result: null,
      nextChance: null,
    };
  }
  const last = world.stats?.lastVip;
  if (!last) return null;
  const name = personName(world.seed, last.simId);
  return {
    stage: 'result',
    simId: last.simId,
    name,
    lines: [`${name}, VIP guest`, vipLikes(last.preference), VIP_RATED_ON],
    checklist: null,
    breakdown: vipBreakdown(last),
    result: vipResult(world, last),
    nextChance: vipNextChance(world),
  };
}

/** A key that changes whenever the card's words do, so the panel rebuilds only then. */
export function vipViewKey(view: VipView | null): string {
  if (!view) return '';
  const checks = view.checklist ? view.checklist.map((c) => `${c.label}=${c.done ? 1 : 0}`).join('|') : '';
  const rows = view.breakdown ? view.breakdown.map((r) => `${r.label}=${r.value}`).join('|') : '';
  const result = view.result ? `${view.result.progress}|${view.result.next}` : '';
  return [view.stage, view.simId, view.lines.join('|'), checks, rows, result, view.nextChance ?? ''].join('#');
}
