// First run and goals: the intro's three screens, the guided first tower, the goals card and
// the one-time tips. Everything here is pure: it reads a world (or the few fields of one a
// test can stub) and answers words and numbers. cards.ts turns the answers into DOM.

import type { Tool } from '../game/api';
import { ROOMS, SCHEDULES, STARS, type StarRule } from '../sim/rules';
import { clockOf, type Room, type Star, type World } from '../sim/types';
import { longWaitsInHour } from '../sim/world';
import { formatCount, formatMoney } from './format';

// ------------------------------------------------------------------ intro

export interface IntroScreen {
  title: string;
  lines: string[];
}

/** What each star past the first asks for, in words: "1,000 people and a security office". */
export function starRequirementText(rule: StarRule): string {
  const parts = [`${formatCount(rule.population)} people`];
  const r = rule.requires;
  if (r.security) parts.push('a security office');
  if (r.hotelSuites !== undefined) parts.push(r.hotelSuites === 1 ? 'a hotel suite' : `${r.hotelSuites} hotel suites`);
  if (r.vipRating !== undefined) parts.push(`a ${r.vipRating} VIP rating`);
  if (r.recycling) parts.push('a recycling center');
  if (r.medical) parts.push('a medical center');
  if (r.metro) parts.push('a metro station');
  if (r.cathedral) parts.push('a cathedral');
  if (r.wedding) parts.push('a wedding');
  if (parts.length === 1) return parts[0] as string;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export const INTRO_SCREENS: readonly IntroScreen[] = [
  {
    title: 'Your tower',
    lines: [
      'You build a tower one floor at a time.',
      'Offices, condos and hotel rooms bring tenants, tenants pay rent, and rent pays for the next floor.',
      'Keep them happy and the tower earns stars.',
    ],
  },
  {
    title: 'Stars',
    lines: [
      'Stars unlock new rooms. Each one needs more people, and from 3 stars a landmark too.',
      ...([2, 3, 4, 5, 6] as Star[]).map((star) => `${STARS[star].label}: ${starRequirementText(STARS[star])}.`),
    ],
  },
  {
    title: 'What empties a tower',
    lines: [
      'Stress: people who wait too long for an elevator get cross, and cross tenants move out.',
      'Noise: shops and offices next to condos or hotel rooms, or fast food next to offices, drive tenants away.',
      'Reach: a room no elevator reaches stays empty.',
    ],
  },
];

// ------------------------------------------------------------------ guide

/** The stretch of the tower where the next step can be built, in floors and tiles, inclusive. */
export interface GuideBand {
  floorMin: number;
  floorMax: number;
  xMin: number;
  xMax: number;
}

/** The fields of a world the guide and the goals card read. A test can stub just these. */
export type GuideWorld = Pick<World, 'rooms' | 'shafts' | 'stars' | 'population'>;

/** 0 to 4 are the five steps; 5 means the guide is finished. */
export type GuideStep = 0 | 1 | 2 | 3 | 4 | 5;
export const GUIDE_DONE: GuideStep = 5;
export const GUIDE_STEP_COUNT = 5;

const TOWER_LAST_TILE = 374;

function lobbies(world: GuideWorld): Room[] {
  const out: Room[] = [];
  for (const room of world.rooms.values()) if (room.kind === 'lobby' && room.floor === 1) out.push(room);
  return out;
}

function offices(world: GuideWorld): Room[] {
  const out: Room[] = [];
  for (const room of world.rooms.values()) if (room.kind === 'office') out.push(room);
  return out;
}

/** The first office an elevator from the lobby floor reaches, or null. */
function reachedOffice(world: GuideWorld): Room | null {
  for (const office of offices(world)) {
    const lo = Math.min(1, office.floor);
    const hi = Math.max(1, office.floor);
    for (const shaft of world.shafts.values()) {
      if (shaft.floorMin <= lo && shaft.floorMax >= hi) return office;
    }
  }
  return null;
}

function anyTenants(world: GuideWorld): boolean {
  for (const room of world.rooms.values()) {
    if (room.occupancy > 0) return true;
    if ((room.kind === 'office' || room.kind === 'condo') && !room.vacant) return true;
  }
  return false;
}

/**
 * Which step the player is on, read from the world as it stands: the first one not yet true.
 * No clock is read, so the guide only moves when the tower does.
 */
export function guideStep(world: GuideWorld): GuideStep {
  if (lobbies(world).length === 0) return 0;
  if (offices(world).length === 0) return 1;
  if (!reachedOffice(world)) return 2;
  if (!anyTenants(world)) return 3;
  if (world.stars < 2) return 4;
  return GUIDE_DONE;
}

/** The ground lobby's extent, left edge to right edge, or null with no lobby. */
function lobbyExtent(world: GuideWorld): { xMin: number; xMax: number } | null {
  const list = lobbies(world);
  if (list.length === 0) return null;
  let xMin = Infinity;
  let xMax = -Infinity;
  for (const room of list) {
    xMin = Math.min(xMin, room.x);
    xMax = Math.max(xMax, room.x + room.width - 1);
  }
  return { xMin, xMax };
}

function topFloor(world: GuideWorld): number {
  let top = 1;
  for (const room of world.rooms.values()) top = Math.max(top, room.floor + room.height - 1);
  return top;
}

/** Where the step's room or elevator can go, for the amber band on the tower. */
export function guideBand(world: GuideWorld, step: GuideStep): GuideBand | null {
  if (step === 0) return { floorMin: 1, floorMax: 1, xMin: 0, xMax: TOWER_LAST_TILE };
  const lobby = lobbyExtent(world);
  if (!lobby) return null;
  if (step === 1 || step === 4) return { floorMin: 2, floorMax: topFloor(world) + 1, ...lobby };
  if (step === 2) {
    const office = offices(world)[0];
    if (!office) return null;
    const xMin = Math.max(lobby.xMin, office.x);
    const xMax = Math.min(lobby.xMax, office.x + office.width - 1);
    const over = xMin <= xMax ? { xMin, xMax } : lobby;
    return { floorMin: Math.min(1, office.floor), floorMax: Math.max(1, office.floor), ...over };
  }
  return null;
}

export interface GuideStepCopy {
  title: string;
  text: string;
  /** The palette tool the step lights, or null for a step that is only waiting. */
  tool: Tool | null;
}

/** The words and the lit tool for a step. Step 3's floor comes from the office already built. */
export function guideCopy(world: GuideWorld, step: GuideStep): GuideStepCopy {
  switch (step) {
    case 0:
      return { title: 'Build a lobby', text: 'Pick Lobby and lay it along floor 1. Everyone comes and goes through it.', tool: { kind: 'room', room: 'lobby' } };
    case 1:
      return { title: 'Add an office', text: 'Pick Office and put it on floor 2, over the lobby. Offices bring workers and rent.', tool: { kind: 'room', room: 'office' } };
    case 2: {
      const floor = offices(world)[0]?.floor ?? 2;
      return {
        title: 'Add an elevator',
        text: `Pick Elevator and run it from floor 1 to floor ${floor}, inside the lobby, so workers can reach the office.`,
        tool: { kind: 'shaft', shaft: 'standard' },
      };
    }
    case 3:
      return { title: 'Wait for tenants', text: 'Let the clock run. A company moves in once people can reach the office.', tool: null };
    case 4:
      return {
        title: 'Reach 2 stars',
        text: `Grow to ${formatCount(STARS[2].population)} people: you have ${formatCount(world.population)}. More offices get you there.`,
        tool: { kind: 'room', room: 'office' },
      };
    default:
      return { title: 'Done', text: 'Your tower has 2 stars.', tool: null };
  }
}

// ------------------------------------------------------------------ goals

export interface GoalItem {
  label: string;
  value: string;
  done: boolean;
}

export interface Goals {
  title: string;
  items: GoalItem[];
}

export type GoalsWorld = GuideWorld & { stats: Pick<World['stats'], 'vipRating' | 'weddingsHeld'> };

const VIP_ORDER: Record<World['stats']['vipRating'], number> = { none: 0, poor: 1, fair: 2, good: 3 };

function countKind(world: GuideWorld, kind: Room['kind']): number {
  let n = 0;
  for (const room of world.rooms.values()) if (room.kind === kind) n++;
  return n;
}

/** The next star's checklist with live progress, or null at Tower status. */
export function goalsFor(world: GoalsWorld): Goals | null {
  if (world.stars >= 6) return null;
  const next = (world.stars + 1) as Star;
  const rule = STARS[next];
  const items: GoalItem[] = [
    {
      label: 'Population',
      value: `${formatCount(world.population)} of ${formatCount(rule.population)}`,
      done: world.population >= rule.population,
    },
  ];
  const r = rule.requires;
  const landmark = (kind: 'security' | 'recycling' | 'medical' | 'metro' | 'cathedral'): void => {
    const built = countKind(world, kind) > 0;
    items.push({ label: ROOMS[kind].label, value: built ? 'Built' : 'Not built', done: built });
  };
  if (r.security) landmark('security');
  if (r.hotelSuites !== undefined) {
    const suites = countKind(world, 'hotelSuite');
    items.push({ label: 'Hotel suites', value: `${suites} of ${r.hotelSuites}`, done: suites >= r.hotelSuites });
  }
  if (r.vipRating !== undefined) {
    const now = world.stats.vipRating;
    items.push({
      label: 'VIP rating',
      value: now === 'none' ? `${capitalize(r.vipRating)} needed, no visit yet` : `${capitalize(r.vipRating)} needed, now ${now}`,
      done: VIP_ORDER[now] >= VIP_ORDER[r.vipRating],
    });
  }
  if (r.recycling) landmark('recycling');
  if (r.medical) landmark('medical');
  if (r.metro) landmark('metro');
  if (r.cathedral) landmark('cathedral');
  if (r.wedding) {
    const held = world.stats.weddingsHeld > 0;
    items.push({ label: 'Wedding', value: held ? 'Held' : 'Not yet', done: held });
  }
  return { title: `Next: ${rule.label}`, items };
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Game minutes the population may sit still, with rooms vacant, before the card says why. */
export const STALL_MINUTES = 2 * 1440;
/** More long waits than this in the last hour and the card says so. */
export const LONG_WAIT_NUDGE = 12;

export interface NudgeInput {
  /** Long waits in the current game hour and the one before it. */
  longWaitsThisHour: number;
  longWaitsLastHour: number;
  /** Minutes the population has not moved, as the ui watched it. */
  populationStillFor: number;
  vacantRooms: number;
}

/** One line when a requirement stalls, or null. The waits come first: they say what to fix. */
export function goalsNudge(input: NudgeInput): string | null {
  const waits = Math.max(input.longWaitsThisHour, input.longWaitsLastHour);
  if (waits > LONG_WAIT_NUDGE) return `${formatCount(waits)} people waited over 5 minutes for a car in the last hour.`;
  if (input.populationStillFor >= STALL_MINUTES && input.vacantRooms > 0) return 'Tenants need an elevator within reach.';
  return null;
}

/** The world's side of the nudge: long waits this hour and last, and vacant offices and condos. */
export function nudgeCounts(world: Pick<World, 'rooms' | 'time'> & Partial<Pick<World, 'longWaits'>>): {
  longWaitsThisHour: number;
  longWaitsLastHour: number;
  vacantRooms: number;
} {
  const hour = Math.floor(world.time.minute / 60);
  const ring = world.longWaits ? { longWaits: world.longWaits } : null;
  let vacantRooms = 0;
  for (const room of world.rooms.values()) {
    if ((room.kind === 'office' || room.kind === 'condo') && room.vacant) vacantRooms++;
  }
  return {
    longWaitsThisHour: ring ? longWaitsInHour(ring, hour) : 0,
    longWaitsLastHour: ring ? longWaitsInHour(ring, hour - 1) : 0,
    vacantRooms,
  };
}

// ------------------------------------------------------------------- tips

export type TipId = 'longWait' | 'tenantLeft' | 'firstRent' | 'firstEvent' | 'nightSpeed' | 'firstPanel';

export const TIP_IDS: readonly TipId[] = ['longWait', 'tenantLeft', 'firstRent', 'firstEvent', 'nightSpeed', 'firstPanel'];

export interface Tip {
  id: TipId;
  text: string;
}

/** "Too noisy next to ..." reads on after a colon as "too noisy next to ...". */
function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function clockHour(minuteOfDay: number): string {
  const hour = Math.floor(minuteOfDay / 60) % 24;
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12} ${hour < 12 ? 'AM' : 'PM'}`;
}

export const TIP_TEXT = {
  longWait: (): string => 'Someone waited over 5 minutes for a car, and another car from the elevator panel shortens the wait.',
  tenantLeft: (reason: string): string => `A tenant moved out: ${lowerFirst(reason)}`,
  firstRent: (income: number): string => `Rent day: the tower took in ${formatMoney(income)} last quarter, and the finances panel has the details.`,
  firstEvent: (): string => 'Events arrive as alerts, and the ones that need a decision carry the button that answers them.',
  nightSpeed: (mode: string): string =>
    `${mode}: from ${clockHour(SCHEDULES.nightStart)} to ${clockHour(SCHEDULES.nightEnd)} the clock runs faster while the tower sleeps.`,
  firstPanel: (): string => 'Panels show the details, and Close puts one away while the tower keeps running.',
};

/** The reason behind the newest move out: the key whose count grew since the last look. */
export function newLeaveReason(before: Readonly<Record<string, number>>, now: Readonly<Record<string, number>>): string | null {
  for (const [reason, count] of Object.entries(now)) {
    if (count > (before[reason] ?? 0)) return reason;
  }
  return null;
}

/** Is it the night stretch, when the clock runs at night speed? */
export function isNight(minute: number): boolean {
  const m = clockOf(Math.max(0, Math.floor(minute))).minuteOfDay;
  return m >= SCHEDULES.nightStart || m < SCHEDULES.nightEnd;
}

/**
 * The tips waiting to be shown: one at a time, each id once, and held back while the intro or
 * a guide step card is open.
 */
export class TipQueue {
  private readonly fired: Set<TipId>;
  private readonly waiting: Tip[] = [];

  constructor(fired: readonly string[]) {
    this.fired = new Set(fired.filter((id): id is TipId => (TIP_IDS as readonly string[]).includes(id)));
  }

  /** Has this id been seen, or is it already waiting? Callers skip the work of wording it. */
  has(id: TipId): boolean {
    return this.fired.has(id) || this.waiting.some((tip) => tip.id === id);
  }

  offer(tip: Tip): boolean {
    if (this.has(tip.id)) return false;
    this.waiting.push(tip);
    return true;
  }

  /** The tip to show now, or null when there is none or the moment is wrong. */
  next(blocked: boolean): Tip | null {
    if (blocked) return null;
    return this.waiting[0] ?? null;
  }

  /** The player read it: it never shows again. */
  done(id: TipId): void {
    this.fired.add(id);
    const at = this.waiting.findIndex((tip) => tip.id === id);
    if (at >= 0) this.waiting.splice(at, 1);
  }

  get pending(): number {
    return this.waiting.length;
  }
}
