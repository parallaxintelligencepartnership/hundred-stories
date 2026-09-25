/**
 * Story beats are presentation state: never read by tick, never in the hash projection.
 * Package 1 attaches this as world.story and persists it in save v4.
 */

import { personIdentity, personName, personVoice, vipPreference } from './identity';
import { collectorStatus } from './recycling';
import { guardStatus } from './security';
import { ROOMS, STARS } from './rules';
import { clockOf } from './types';
import type { Leg, Room, Sim, Star, World } from './types';

export type BeatCode =
  | 'wait.long'
  | 'trip.gaveUp'
  | 'trip.arrived'
  | 'room.vacated'
  | 'fire.started'
  | 'fire.resolved'
  | 'bomb.started'
  | 'bomb.resolved'
  | 'bomb.failed'
  | 'vip.notice'
  | 'vip.arrival'
  | 'vip.rated'
  | 'star.gained'
  | 'star.lost'
  | 'theft.started'
  | 'guard.dispatched'
  | 'theft.caught'
  | 'theft.escaped'
  | 'waste.backlog'
  | 'waste.cleared';

/**
 * One recorded transition. value: wait.long = wait minutes; trip.arrived = trip minutes; vip.rated = 0 poor,
 * 1 fair, 2 good; star.* = the new star number; theft.escaped = dollars lost. theft.* carry the thief's
 * simId and the target's roomId; guard.dispatched carries the guard's simId and the incident's roomId.
 * waste.backlog and waste.cleared carry the room's roomId.
 */
export interface StoryBeat {
  code: BeatCode;
  minute: number;
  simId?: number;
  roomId?: number;
  value?: number;
}

export const STORY_RECENT_CAP = 256;
export const STORY_FOLLOWED_CAP = 8;
export const STORY_THREAD_CAP = 6;

export const CHRONICLE_LINE_CAP = 40;
/** Longest chronicle line an import keeps; a longer one marks the chronicle as damaged. */
export const CHRONICLE_LINE_CHARS = 400;

/** The tower chronicle, written once the tower reaches Tower status (src/sim/chronicle.ts). */
export interface Chronicle {
  lines: string[];
  minute: number;
}

export interface StoryState {
  seq: number;
  recent: StoryBeat[];
  followed: number[];
  threads: Record<number, StoryBeat[]>;
  /** Null until the tower first reaches Tower status. */
  chronicle: Chronicle | null;
}

export function createStoryState(): StoryState {
  return { seq: 0, recent: [], followed: [], threads: {}, chronicle: null };
}

export function recordBeat(story: StoryState, beat: StoryBeat): void {
  story.seq += 1;
  story.recent.push(beat);
  if (story.recent.length > STORY_RECENT_CAP) {
    story.recent.shift();
  }
  if (beat.simId !== undefined && story.followed.includes(beat.simId)) {
    const thread = story.threads[beat.simId];
    if (thread) {
      thread.push(beat);
      if (thread.length > STORY_THREAD_CAP) {
        thread.shift();
      }
    }
  }
}

export function followSim(story: StoryState, simId: number): boolean {
  if (story.followed.includes(simId)) {
    return true;
  }
  if (story.followed.length >= STORY_FOLLOWED_CAP) {
    return false;
  }
  story.followed.push(simId);
  story.threads[simId] = [];
  return true;
}

export function unfollowSim(story: StoryState, simId: number): void {
  const idx = story.followed.indexOf(simId);
  if (idx !== -1) {
    story.followed.splice(idx, 1);
  }
  delete story.threads[simId];
}

// ---------------------------------------------------------------------------
// Recording: followed people always, everyone else spaced out tower wide
// ---------------------------------------------------------------------------

/** Every code, as a value table, so an import can drop codes it does not know. */
const BEAT_CODES: Record<BeatCode, true> = {
  'wait.long': true,
  'trip.gaveUp': true,
  'trip.arrived': true,
  'room.vacated': true,
  'fire.started': true,
  'fire.resolved': true,
  'bomb.started': true,
  'bomb.resolved': true,
  'bomb.failed': true,
  'vip.notice': true,
  'vip.arrival': true,
  'vip.rated': true,
  'star.gained': true,
  'star.lost': true,
  'theft.started': true,
  'guard.dispatched': true,
  'theft.caught': true,
  'theft.escaped': true,
  'waste.backlog': true,
  'waste.cleared': true,
};

export function isFollowed(story: StoryState, simId: number): boolean {
  return story.followed.includes(simId);
}

/**
 * The minute of the last beat per code recorded about somebody nobody follows. Kept beside
 * the story, not in it: it is rebuilt from `recent` the first time it is needed, so a loaded
 * save spaces its beats the way the running game did.
 */
const unfollowedLast = new WeakMap<StoryState, Map<BeatCode, number>>();

function unfollowedLastOf(story: StoryState): Map<BeatCode, number> {
  let last = unfollowedLast.get(story);
  if (!last) {
    last = new Map();
    for (const beat of story.recent) {
      if (beat.simId !== undefined && !story.followed.includes(beat.simId)) last.set(beat.code, beat.minute);
    }
    unfollowedLast.set(story, last);
  }
  return last;
}

/**
 * Record a beat about one person. A followed person's beat always lands; anyone else's lands
 * only when no beat of the same code about an unfollowed person landed in the last
 * `gapMinutes`. Returns the recorded beat, or null when it was spaced out.
 */
export function recordSimBeat(story: StoryState, beat: StoryBeat & { simId: number }, gapMinutes: number): StoryBeat | null {
  if (story.followed.includes(beat.simId)) {
    recordBeat(story, beat);
    return beat;
  }
  const last = unfollowedLastOf(story);
  const prev = last.get(beat.code);
  if (prev !== undefined && beat.minute - prev < gapMinutes) return null;
  last.set(beat.code, beat.minute);
  recordBeat(story, beat);
  return beat;
}

// ---------------------------------------------------------------------------
// Import: a story that does not check out is trimmed, never a reason to refuse the save
// ---------------------------------------------------------------------------

function finiteOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function cleanBeat(raw: unknown): StoryBeat | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.code !== 'string' || !Object.hasOwn(BEAT_CODES, r.code)) return null;
  const minute = finiteOrUndefined(r.minute);
  if (minute === undefined) return null;
  const beat: StoryBeat = { code: r.code as BeatCode, minute };
  const simId = finiteOrUndefined(r.simId);
  const roomId = finiteOrUndefined(r.roomId);
  const value = finiteOrUndefined(r.value);
  if (simId !== undefined) beat.simId = simId;
  if (roomId !== undefined) beat.roomId = roomId;
  if (value !== undefined) beat.value = value;
  return beat;
}

function cleanBeats(raw: unknown, cap: number): StoryBeat[] {
  if (!Array.isArray(raw)) return [];
  const out: StoryBeat[] = [];
  for (const item of raw) {
    const beat = cleanBeat(item);
    if (beat) out.push(beat);
  }
  return out.slice(-cap);
}

/**
 * A saved story made safe: unknown codes and non-finite numbers dropped, every cap enforced,
 * a thread for each followed person and none for anyone else. Anything unreadable becomes an
 * empty story, so a damaged story never costs the player the save.
 */
export function sanitizeStory(raw: unknown): StoryState {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return createStoryState();
  const r = raw as Record<string, unknown>;
  const recent = cleanBeats(r.recent, STORY_RECENT_CAP);
  const followed: number[] = [];
  if (Array.isArray(r.followed)) {
    for (const id of r.followed) {
      if (followed.length >= STORY_FOLLOWED_CAP) break;
      if (typeof id === 'number' && Number.isInteger(id) && !followed.includes(id)) followed.push(id);
    }
  }
  const rawThreads =
    typeof r.threads === 'object' && r.threads !== null && !Array.isArray(r.threads) ? (r.threads as Record<string, unknown>) : {};
  const threads: Record<number, StoryBeat[]> = {};
  for (const id of followed) threads[id] = cleanBeats(rawThreads[String(id)], STORY_THREAD_CAP);
  const seq = finiteOrUndefined(r.seq);
  return {
    seq: seq !== undefined && seq >= recent.length ? Math.floor(seq) : recent.length,
    recent,
    followed,
    threads,
    chronicle: cleanChronicle(r.chronicle),
  };
}

/**
 * A saved chronicle, or null. It is kept whole or not at all: a line that is not text, too
 * many lines, or a minute that is not a number makes it null, never a half chronicle.
 */
function cleanChronicle(raw: unknown): Chronicle | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const minute = finiteOrUndefined(r.minute);
  if (minute === undefined || !Array.isArray(r.lines) || r.lines.length > CHRONICLE_LINE_CAP) return null;
  const lines: string[] = [];
  for (const line of r.lines) {
    if (typeof line !== 'string' || line.length > CHRONICLE_LINE_CHARS) return null;
    lines.push(line);
  }
  return { lines, minute };
}

// ---------------------------------------------------------------------------
// Words. Rendered when a panel opens, never per tick. Observed facts and numbers only:
// no line says why something happened, only what happened and how long it took.
// ---------------------------------------------------------------------------

const NUMBER_WORDS: readonly string[] = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty',
];

/** "eight minutes", "one minute", "34 minutes": how a story line says a length of time. */
export function minutesText(n: number): string {
  const whole = Math.max(0, Math.round(n));
  const count = whole <= 20 ? (NUMBER_WORDS[whole] as string) : String(whole);
  return whole === 1 ? `${count} minute` : `${count} minutes`;
}

function cap(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function floorText(floor: number): string {
  return floor < 0 ? `floor B${-floor}` : `floor ${floor}`;
}

function roomLabel(room: Room): string {
  return ROOMS[room.kind].label.toLowerCase();
}

/** "the office on floor 12", or "the lobby" for the ground lobby. */
function placeText(room: Room): string {
  if (room.kind === 'lobby' && room.floor === 1) return 'the lobby';
  return `the ${roomLabel(room)} on ${floorText(room.floor)}`;
}

/** Where a trip went, as "to floor 12", or "to the lobby". */
function toText(room: Room | undefined): string {
  if (!room) return '';
  if (room.kind === 'lobby' && room.floor === 1) return ' to the lobby';
  return ` to ${floorText(room.floor)}`;
}

const HOTEL_KINDS = new Set<Room['kind']>(['hotelSingle', 'hotelTwin', 'hotelSuite']);
const VIP_RATINGS = ['poor', 'fair', 'good'] as const;

function starText(value: number | undefined): string {
  const star = Math.min(6, Math.max(1, Math.round(value ?? 1))) as Star;
  return star === 6 ? 'Tower status' : STARS[star].label;
}

/** A person's own line about one beat, in their voice. */
function personLine(beat: StoryBeat, voice: number, room: Room | undefined): string {
  const m = minutesText(beat.value ?? 0);
  const to = toText(room);
  switch (beat.code) {
    case 'wait.long':
      if (voice === 1) return `I waited ${m} for a car${to}. I hope the next one has room.`;
      if (voice === 2) return `${cap(m)} at the doors${to ? `, going${to}` : ''}. Noted.`;
      return `${cap(m)} waiting for a car${to}.`;
    case 'trip.arrived': {
      const dest = room ? to.trim() : 'out to the street';
      if (voice === 1) return `I made it ${dest} in ${m} today.`;
      if (voice === 2) return `${cap(room ? dest.replace(/^to /, '') : dest)} in ${m}.`;
      return `${cap(m)} to get ${dest} today.`;
    }
    case 'trip.gaveUp':
      if (voice === 1) return `${cap(m)} and no car${to}. I gave up on the trip.`;
      if (voice === 2) return `Gave up after ${m} at the doors.`;
      return `I gave up after ${m} waiting for a car${to}.`;
    case 'room.vacated': {
      const place = room ? placeText(room) : 'my room';
      if ((beat.value ?? 0) >= 1) {
        if (voice === 1) return `I moved out of ${place}. It was not working for me.`;
        if (voice === 2) return `Moved out of ${place}. Not happy there.`;
        return `I moved out of ${place}. I was not happy there.`;
      }
      if (room && HOTEL_KINDS.has(room.kind)) {
        if (voice === 1) return `Checked out of ${place}. Time to go.`;
        if (voice === 2) return `Checked out of ${place}.`;
        return `I checked out of ${place}.`;
      }
      if (voice === 1) return `Time to go. I left ${place}.`;
      if (voice === 2) return `Left ${place}.`;
      return `I left ${place} for good.`;
    }
    default:
      return towerLine(beat, room);
  }
}

/** A line about the tower as a whole, in the narrator's plain voice. */
function towerLine(beat: StoryBeat, room: Room | undefined): string {
  switch (beat.code) {
    case 'fire.started':
      return room ? `A fire started in ${placeText(room)}.` : 'A fire started.';
    case 'fire.resolved': {
      const lost = Math.max(0, Math.round(beat.value ?? 0));
      return `The fire is out. ${cap(lost <= 20 ? (NUMBER_WORDS[lost] as string) : String(lost))} room${lost === 1 ? '' : 's'} burned down.`;
    }
    case 'bomb.started':
      return room ? `A caller planted a bomb in ${placeText(room)}.` : 'A caller planted a bomb.';
    case 'bomb.resolved':
      return 'The bomb threat is over.';
    case 'bomb.failed':
      return room ? `The bomb went off on ${floorText(room.floor)}.` : 'The bomb went off.';
    case 'vip.notice':
      return room ? `A VIP is coming to ${placeText(room)} tomorrow.` : 'A VIP is coming tomorrow.';
    case 'vip.arrival':
      return room ? `The VIP arrived at ${placeText(room)}.` : 'The VIP arrived.';
    case 'vip.rated':
      return `The VIP rated the tower ${VIP_RATINGS[Math.min(2, Math.max(0, Math.round(beat.value ?? 0)))]}.`;
    case 'star.gained':
      return `The tower reached ${starText(beat.value)}.`;
    case 'star.lost':
      return `The tower fell to ${starText(beat.value)}.`;
    // theft.started never names a thief: the line stays true of a visitor until it is resolved.
    case 'theft.started':
      return room ? `Something went missing from ${placeText(room)}.` : 'Something went missing.';
    case 'guard.dispatched':
      return room ? `A guard was sent to ${floorText(room.floor)}.` : 'A guard was sent out.';
    case 'theft.caught':
      return room ? `A guard caught a thief at ${placeText(room)}.` : 'A guard caught a thief.';
    case 'theft.escaped':
      return room ? `A thief got away from ${placeText(room)}.` : 'A thief got away.';
    case 'waste.backlog':
      return room ? `Waste piled up in ${placeText(room)} with nobody to collect it.` : 'Waste piled up with nobody to collect it.';
    case 'waste.cleared':
      return room ? `The collectors cleared the waste from ${placeText(room)}.` : 'The collectors cleared a pile of waste.';
    default:
      return '';
  }
}

const PERSON_CODES = new Set<BeatCode>(['wait.long', 'trip.arrived', 'trip.gaveUp', 'room.vacated']);

/**
 * One beat as a sentence. A person's beat is in their own voice, first person; a tower
 * beat is plain narration. A room that has since gone drops out of the line, never the line.
 */
export function describeBeat(beat: StoryBeat, world: World): string {
  const room = beat.roomId !== undefined ? world.rooms.get(beat.roomId) : undefined;
  if (PERSON_CODES.has(beat.code) && beat.simId !== undefined) {
    return personLine(beat, personVoice(world.seed, beat.simId), room);
  }
  return towerLine(beat, room);
}

// ---------------------------------------------------------------------------
// The person card
// ---------------------------------------------------------------------------

export const ROLE_LABELS: Record<Sim['kind'], string> = {
  worker: 'Worker',
  resident: 'Resident',
  guest: 'Hotel guest',
  shopper: 'Shopper',
  diner: 'Diner',
  staff: 'Housekeeper',
  visitor: 'Visitor',
  vip: 'VIP guest',
  guard: 'Security guard',
  collector: 'Collection worker',
  thief: 'Visitor', // never "thief" on the card: the player learns it from the encounter
};

/** The card's four headings, in the order the panel shows them. */
export const PERSON_CARD_HEADINGS = ['Who', 'On their mind', 'Recent chapter', 'What helps'] as const;

export const WAIT_HELP = 'More cars in this elevator, or another elevator for this trip.';
export const NOTHING_HELPS = 'Nothing right now.';
export const NOTHING_RECORDED = 'Nothing recorded yet.';
const CHAPTER_LINES = 6;

export interface PersonCard {
  name: string;
  lookKey: number;
  voiceKey: number;
  /** Name, role, and the room they belong to. */
  who: string[];
  /** The goal they are acting on now, from their state and route. */
  mind: string;
  /** Beats, oldest first, newest last, rendered. */
  chapter: string[];
  /** Mapped from the latest setback only. */
  helps: string;
}

/** Where this person belongs, in words: "Works in the office on floor 12". */
function belongsText(world: World, sim: Sim): string | null {
  const home = sim.homeRoomId !== null ? world.rooms.get(sim.homeRoomId) : undefined;
  if (home) {
    const place = placeText(home);
    switch (sim.kind) {
      case 'worker':
        return `Works in ${place}`;
      case 'resident':
        return `Lives in ${place}`;
      case 'guest':
      case 'vip':
        return `Staying in ${place}`;
      case 'staff':
      case 'guard':
      case 'collector':
        return `Works for ${place}`;
      default:
        return `Belongs to ${place}`;
    }
  }
  // A visitor has no home room: their plan names the place they came for.
  const goal = sim.schedule[0]?.goal;
  const target = goal && goal.kind === 'room' ? world.rooms.get(goal.roomId) : undefined;
  if (target) return `Visiting ${placeText(target)}`;
  return null;
}

/** The room the route in hand ends at, if it ends at a room. */
function routeRoom(world: World, route: readonly Leg[]): Room | undefined {
  for (let i = route.length - 1; i >= 0; i--) {
    const leg = route[i] as Leg;
    if (leg.kind === 'enter') return world.rooms.get(leg.roomId);
  }
  return undefined;
}

function headingText(world: World, sim: Sim, room: Room): string {
  const isHome = sim.homeRoomId === room.id;
  if (isHome && sim.kind === 'worker') return `Heading to work on ${floorText(room.floor)}`;
  if (isHome && sim.kind === 'resident') return `Heading home to ${floorText(room.floor)}`;
  if (isHome && (sim.kind === 'guest' || sim.kind === 'vip')) return `Heading to ${placeText(room)}`;
  if (sim.kind === 'staff' && HOTEL_KINDS.has(room.kind)) return `On the way to clean ${placeText(room)}`;
  if (sim.kind === 'staff') return `Heading back to ${placeText(room)}`;
  return `Heading to ${placeText(room)}`;
}

function insideText(world: World, sim: Sim, room: Room): string {
  const isHome = sim.homeRoomId === room.id;
  if (sim.kind === 'staff') {
    if (HOTEL_KINDS.has(room.kind)) return `Cleaning ${placeText(room)}`;
    return `Waiting for rooms to clean in ${placeText(room)}`;
  }
  if (isHome && sim.kind === 'worker') return `At work on ${floorText(room.floor)}`;
  if (isHome && sim.kind === 'resident') return 'At home';
  if (isHome && (sim.kind === 'guest' || sim.kind === 'vip')) {
    const checkout = sim.schedule.find((entry) => entry.goal.kind === 'exit');
    if (sim.kind === 'vip' || !checkout) return `Staying in ${placeText(room)}`;
    return clockOf(world.time.minute).minuteOfDay < checkout.minuteOfDay ? 'Checking out today' : 'In for the night, checking out tomorrow';
  }
  return `At ${placeText(room)}`;
}

/**
 * What this person is doing about their day right now, grounded in their state and route.
 * Every live person gets a line, with or without any beats.
 */
export function goalLine(world: World, sim: Sim): string {
  if (sim.kind === 'guard' && sim.state !== 'leaving' && sim.state !== 'gone' && !sim.exiting) return guardStatus(world, sim);
  if (sim.kind === 'collector' && sim.state !== 'leaving' && sim.state !== 'gone' && !sim.exiting) return collectorStatus(world, sim);
  if (sim.kind === 'thief' && !sim.exiting && sim.state !== 'leaving' && sim.state !== 'gone') {
    if (sim.state === 'waiting' || sim.state === 'riding') return goalLineByState(world, sim);
    return sim.route.length > 0 ? 'Heading to the shops' : 'Looking around the shop';
  }
  return goalLineByState(world, sim);
}

function goalLineByState(world: World, sim: Sim): string {
  switch (sim.state) {
    case 'waiting': {
      const where = sim.pos.floor === 1 ? 'at the lobby' : `on ${floorText(sim.pos.floor)}`;
      const waited = sim.waitStart !== null ? Math.max(0, world.time.minute - sim.waitStart) : 0;
      return `Waiting for an elevator ${where}, ${minutesText(waited)} so far`;
    }
    case 'riding': {
      const leg = sim.route[0];
      if (leg && leg.kind === 'ride') {
        const dir = leg.toFloor > sim.pos.floor ? 'up' : 'down';
        return `Riding ${dir} to ${floorText(leg.toFloor)}`;
      }
      return 'Riding an elevator';
    }
    case 'walking':
    case 'leaving': {
      if (sim.exiting || sim.state === 'leaving') return 'Leaving the tower';
      const room = routeRoom(world, sim.route);
      if (room) return headingText(world, sim, room);
      return sim.homeRoomId !== null ? 'Heading out for the day' : 'Leaving the tower';
    }
    case 'inRoom': {
      const room = sim.inRoomId !== null ? world.rooms.get(sim.inRoomId) : undefined;
      if (room) return insideText(world, sim, room);
      return 'Inside the tower';
    }
    case 'outside':
      if (sim.kind === 'guest') return 'Checking in this evening';
      if (sim.kind === 'vip') return 'Arriving tomorrow';
      if (sim.leaveReason !== null) return 'Went home early today';
      return sim.kind === 'worker' ? 'Off work for the day' : 'Out for the day';
    case 'gone':
      return 'Left the tower';
  }
}

/** This person's beats, oldest first: the followed thread, or what the tower list still holds. */
export function beatsFor(story: StoryState, simId: number): StoryBeat[] {
  if (story.followed.includes(simId)) return [...(story.threads[simId] ?? [])];
  const out: StoryBeat[] = [];
  for (const beat of story.recent) if (beat.simId === simId) out.push(beat);
  return out.slice(-CHAPTER_LINES);
}

function helpsFor(beats: readonly StoryBeat[], sim: Sim): string {
  for (let i = beats.length - 1; i >= 0; i--) {
    const beat = beats[i] as StoryBeat;
    if (beat.code === 'wait.long' || beat.code === 'trip.gaveUp') return WAIT_HELP;
    if (beat.code === 'room.vacated' && (beat.value ?? 0) >= 1) return sim.leaveReason ?? NOTHING_HELPS;
  }
  return NOTHING_HELPS;
}

export function personCard(world: World, sim: Sim): PersonCard {
  const identity = personIdentity(world.seed, sim.id, sim.kind);
  const who = [identity.name, ROLE_LABELS[sim.kind]];
  const belongs = belongsText(world, sim);
  if (belongs) who.push(belongs);
  const beats = beatsFor(world.story, sim.id).slice(-CHAPTER_LINES);
  const chapter = beats.map((beat) => describeBeat(beat, world));
  return {
    name: identity.name,
    lookKey: identity.lookKey,
    voiceKey: identity.voiceKey,
    who,
    mind: sim.kind === 'vip' ? `${goalLine(world, sim)}. Cares most about ${vipPreferenceOf(world, sim.id)}` : goalLine(world, sim),
    chapter: chapter.length > 0 ? chapter : [NOTHING_RECORDED],
    helps: helpsFor(beats, sim),
  };
}

/** A VIP's preference: the one their visit carries, or the identity hash's pick. */
function vipPreferenceOf(world: World, simId: number): string {
  for (const event of world.events) if (event.kind === 'vip' && event.simId === simId) return event.preference;
  return vipPreference(world.seed, simId);
}

/** A name for anyone the story mentions, here or gone. */
export function storyName(world: World, simId: number): string {
  return personName(world.seed, simId);
}
