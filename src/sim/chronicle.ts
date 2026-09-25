/**
 * The milestone recap and the tower chronicle: presentation only, assembled from recorded story
 * state (world.story.recent, the followed threads) and a few recorded stats. Nothing here is
 * read by the tick, nothing here enters the hash, and no line says anything the record does not.
 */

import { ROOMS, SHAFTS, STARS } from './rules';
import {
  CHRONICLE_LINE_CAP,
  describeBeat,
  storyName,
  type BeatCode,
  type Chronicle,
  type StoryBeat,
} from './story';
import type { RoomKind, ShaftKind, Star, World } from './types';

/** Lines a milestone recap lists at most. */
export const RECAP_LINE_CAP = 6;
export const NO_STORIES_YET = 'No stories yet.';

/** Tower beats a recap lists, besides the followed people's latest lines. */
const RECAP_CODES: ReadonlySet<BeatCode> = new Set<BeatCode>([
  'room.vacated',
  'vip.rated',
  'theft.caught',
  'theft.escaped',
  'waste.backlog',
  'waste.cleared',
]);

const PERSON_CODES: ReadonlySet<BeatCode> = new Set<BeatCode>(['wait.long', 'trip.arrived', 'trip.gaveUp', 'room.vacated']);

export interface MilestoneRecap {
  /** The star the milestone reached. */
  star: number;
  minute: number;
  /** What the star opened up to build. */
  unlocks: string;
  /** Newest first, at most RECAP_LINE_CAP. Empty when nothing was recorded. */
  lines: string[];
}

/** A beat as a line: a person's beat carries their name, a tower beat is plain narration. */
export function beatLine(world: World, beat: StoryBeat): string {
  const line = describeBeat(beat, world);
  return PERSON_CODES.has(beat.code) && beat.simId !== undefined ? `${storyName(world, beat.simId)}: ${line}` : line;
}

function starName(star: number): string {
  const s = Math.min(6, Math.max(1, Math.round(star))) as Star;
  return s === 6 ? 'Tower status' : STARS[s].label;
}

/** What a star opens up to build, from the rules: "Now open: Restaurant, Shop." */
export function unlocksText(star: number): string {
  const names: string[] = [];
  for (const kind of Object.keys(ROOMS) as RoomKind[]) if (ROOMS[kind].star === star) names.push(ROOMS[kind].label);
  for (const kind of Object.keys(SHAFTS) as ShaftKind[]) if (SHAFTS[kind].star === star) names.push(SHAFTS[kind].label);
  if (names.length === 0) return `Nothing new to build at ${starName(star)}.`;
  return `Now open: ${names.join(', ')}.`;
}

function beatKey(beat: StoryBeat): string {
  return `${beat.code}|${beat.minute}|${beat.simId ?? ''}|${beat.roomId ?? ''}|${beat.value ?? ''}`;
}

/**
 * The recap for the latest star.gained beat still on record: the followed people's latest beats
 * and the departures, VIP ratings, thefts and waste since the star.gained before it (or since the
 * record began), newest first, capped. Null when no star.gained beat is on record.
 */
export function milestoneRecap(world: World): MilestoneRecap | null {
  const story = world.story;
  const recent = story.recent;
  let last = -1;
  let prev = -1;
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    if ((recent[i] as StoryBeat).code !== 'star.gained') continue;
    if (last < 0) last = i;
    else {
      prev = i;
      break;
    }
  }
  if (last < 0) return null;
  const starBeat = recent[last] as StoryBeat;
  const fromMinute = prev >= 0 ? (recent[prev] as StoryBeat).minute : -Infinity;
  const window = recent.slice(prev + 1, last);

  // Each pick carries a rank for ordering: its place in the window, or below every window beat.
  const picked: { beat: StoryBeat; rank: number }[] = [];
  const seen = new Set<string>();
  const take = (beat: StoryBeat, rank: number): void => {
    const key = beatKey(beat);
    if (seen.has(key)) return;
    seen.add(key);
    picked.push({ beat, rank });
  };

  const latestFollowed = new Map<number, { beat: StoryBeat; rank: number }>();
  window.forEach((beat, i) => {
    if (beat.simId !== undefined && story.followed.includes(beat.simId)) latestFollowed.set(beat.simId, { beat, rank: i });
  });
  // A followed person's thread outlasts the tower list: look there for anyone the list lost.
  for (const id of story.followed) {
    if (latestFollowed.has(id)) continue;
    const thread = story.threads[id] ?? [];
    for (let i = thread.length - 1; i >= 0; i -= 1) {
      const beat = thread[i] as StoryBeat;
      if (beat.minute > fromMinute && beat.minute <= starBeat.minute) {
        latestFollowed.set(id, { beat, rank: -1 });
        break;
      }
    }
  }
  for (const { beat, rank } of latestFollowed.values()) take(beat, rank);
  window.forEach((beat, i) => {
    if (RECAP_CODES.has(beat.code)) take(beat, i);
  });

  // Newest first; within one minute, the later recorded first.
  picked.sort((a, b) => b.beat.minute - a.beat.minute || b.rank - a.rank);

  const star = starBeat.value ?? 1;
  return {
    star,
    minute: starBeat.minute,
    unlocks: unlocksText(star),
    lines: picked.slice(0, RECAP_LINE_CAP).map(({ beat }) => beatLine(world, beat)),
  };
}

function countText(value: number): string {
  const digits = String(Math.max(0, Math.round(value)));
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits.charAt(i);
  }
  return out;
}

function dayOf(minute: number): number {
  return Math.floor(minute / 1440) + 1;
}

/**
 * The tower chronicle, in a fixed order, all from recorded state: seed and day, population, each
 * star and the day it was gained, the followed people, departures, the VIP rating, thefts, waste
 * backlogs and the wedding. At most CHRONICLE_LINE_CAP lines.
 */
export function assembleChronicle(world: World): Chronicle {
  const story = world.story;
  const recent = story.recent;
  const minute = world.time.minute;
  const lines: string[] = [];

  lines.push(`Day ${dayOf(minute)} in the tower.`);
  lines.push(`Population ${countText(world.population)}.`);

  for (let star = 2; star <= world.stars; star += 1) {
    const gained = recent.find((beat) => beat.code === 'star.gained' && beat.value === star);
    lines.push(
      gained ? `Reached ${starName(star)} on day ${dayOf(gained.minute)}.` : `Reached ${starName(star)} before the record began.`,
    );
  }

  for (const id of story.followed) {
    const thread = story.threads[id] ?? [];
    const latest = thread[thread.length - 1];
    lines.push(`${storyName(world, id)}: ${latest ? describeBeat(latest, world) : 'Nothing recorded yet.'}`);
  }

  const departures = recent.filter((beat) => beat.code === 'room.vacated');
  lines.push(departures.length === 1 ? '1 tenant moved out.' : `${countText(departures.length)} tenants moved out.`);
  for (const beat of departures.slice(-3)) lines.push(beatLine(world, beat));

  const ratings = recent.filter((beat) => beat.code === 'vip.rated');
  const rating = ratings[ratings.length - 1];
  if (rating) lines.push(describeBeat(rating, world));

  const caught = recent.filter((beat) => beat.code === 'theft.caught').length;
  const escaped = recent.filter((beat) => beat.code === 'theft.escaped').length;
  lines.push(`Thieves: ${countText(caught)} caught, ${countText(escaped)} got away.`);

  const backlogs = recent.filter((beat) => beat.code === 'waste.backlog').length;
  const cleared = recent.filter((beat) => beat.code === 'waste.cleared').length;
  lines.push(`Times waste piled up: ${countText(backlogs)}, cleaned up: ${countText(cleared)}.`);

  const weddings = world.stats.weddingsHeld;
  if (weddings > 0) lines.push(weddings === 1 ? 'The cathedral held a wedding.' : `The cathedral held ${countText(weddings)} weddings.`);

  return { lines: lines.slice(0, CHRONICLE_LINE_CAP), minute };
}
