// Tower problems: what is wrong in the tower right now, where, how bad, and what the player can do
// about it. A pure read of the world: nothing here simulates, stores or remembers anything, so an
// item is listed while it is true and gone the moment it stops being true. Things that already
// happened (a move-out, a fire put out) are history and live in Today, not here.
//
// Stories shows one row per item (stories-problems.ts), and the folded warning toast says
// towerProblems(world).length, so the toast's number is always the number of rows on the page.
//
// Elevator congestion and tenants leaving are consequences the game means to have: the words
// explain them plainly, they never soften them.

import { floorWaits, hallQueues } from '../render/overlays';
import { averageTenantStress, noisyNeighborsOf } from '../sim/evaluation';
import { dirtyHotelRooms, hotelRoomsHousekeepingCannotReach } from '../sim/people';
import { centerSummary, floorsCollectorsCannotReach, inWasteBacklog, recyclingCenters } from '../sim/recycling';
import { findRoute, isReachableFromLobby } from '../sim/routing';
import { EVAL, RENT, ROOMS, takesRent, TOWER_WIDTH } from '../sim/rules';
import type { Id, Room, RoomKind, World } from '../sim/types';
import { groundLobby, LONG_WAIT_MINUTES, roomsOfKind, roomsOnFloor, shaftsOnFloor } from '../sim/world';
import { formatCount } from './format';

/** The kinds of problem, in the order Stories lists them. */
export type ProblemKind =
  | 'wait'
  | 'gaveUp'
  | 'noWayIn'
  | 'housekeepingReach'
  | 'noHousekeeping'
  | 'wasteNoCenter'
  | 'wasteReach'
  | 'wasteBehind'
  | 'moveOut';

/** What a row's button does: center the camera on a place, and open an elevator's or a room's card. */
export interface ProblemAction {
  label: string;
  at: { floor: number; x: number };
  /** Open this card too, after the camera moves. */
  select?: { shaftId: Id } | { roomId: Id };
}

export interface TowerProblem {
  kind: ProblemKind;
  /** Stable while the problem lasts, so the page keeps the row (and its focus) in place. */
  key: string;
  /** The floors it is on, lowest first. */
  floors: number[];
  /** How many people or rooms it is about. */
  count: number;
  /** The longest wait, in minutes, for an elevator problem. */
  minutes?: number;
  /** The room it is about, for a move-out countdown. */
  roomId?: Id;
  /** The worst shaft, for an elevator wait. */
  shaftId?: Id;
  text: string;
  actions: ProblemAction[];
}

/** Each kind with a list per floor or room shows this many, then one "and N more" row. */
export const PROBLEM_ROWS_PER_KIND = 3;

export const SHOW_FLOOR = 'Show the floor';
export const SHOW_ROOM = 'Show the room';
export const OPEN_ELEVATOR = 'Open the elevator';
export const OPEN_CENTER = 'Open the recycling center';

const LAST_HOUR = 60;
/** The rooms people come to: a room of these kinds with no way in from the lobby is a problem. */
const VISITED: ReadonlySet<RoomKind> = new Set<RoomKind>(['office', 'condo', 'hotelSingle', 'hotelTwin', 'hotelSuite', 'fastFood', 'restaurant', 'shop', 'cinema', 'partyHall']);
/** The rooms people live, work or stay in: the ones whose tenants can move out. */
const HOMES: ReadonlySet<RoomKind> = new Set<RoomKind>(['office', 'condo', 'hotelSingle', 'hotelTwin', 'hotelSuite']);

// ------------------------------------------------------------------ words

function floorName(floor: number): string {
  return floor < 0 ? `basement ${-floor}` : `floor ${floor}`;
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "floor 7", "floors 7 and 9", "floors 3, 7 and 9". */
export function floorList(floors: readonly number[]): string {
  const names = floors.map(floorName);
  if (names.length <= 1) return names[0] ?? '';
  const plain = floors.map((f) => (f < 0 ? `basement ${-f}` : String(f)));
  const words = floors.every((f) => f > 0) ? plain : names;
  const head = floors.every((f) => f > 0) ? 'floors ' : '';
  return `${head}${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

function people(n: number): string {
  return n === 1 ? '1 person' : `${formatCount(n)} people`;
}

function rooms(n: number, what = 'room'): string {
  return n === 1 ? `1 ${what}` : `${formatCount(n)} ${what}s`;
}

function minutes(n: number): string {
  return n === 1 ? '1 minute' : `${formatCount(n)} minutes`;
}

function label(kind: RoomKind): string {
  return ROOMS[kind].label.toLowerCase();
}

/**
 * How long a room on the move-out countdown has left, in plain words with no day numbers: the
 * hourly evaluation moves its people out once it has been rated too low for EVAL.leaveAfterMinutes.
 */
export function timeLeftWords(now: number, lowSince: number): string {
  const left = lowSince + EVAL.leaveAfterMinutes - now;
  if (left <= 60) return 'within the hour';
  const hours = Math.round(left / 60);
  if (hours >= 36) return 'in more than a day';
  if (hours >= 22) return 'in about a day';
  return hours === 1 ? 'in about an hour' : `in about ${hours} hours`;
}

// ------------------------------------------------------------------ places

function middle(room: Room): { floor: number; x: number } {
  return { floor: room.floor, x: Math.floor(room.x + room.width / 2) };
}

/** Somewhere to center the camera on a floor: a shaft that stops there, a room on it, the lobby, the middle. */
function floorPoint(world: World, floor: number): { floor: number; x: number } {
  const shaft = shaftsOnFloor(world, floor).find((s) => s.stops.has(floor)) ?? shaftsOnFloor(world, floor)[0];
  if (shaft) return { floor, x: shaft.x };
  const room = roomsOnFloor(world, floor)[0];
  if (room) return { floor, x: middle(room).x };
  const lobby = groundLobby(world);
  return { floor, x: lobby ? middle(lobby).x : Math.floor(TOWER_WIDTH / 2) };
}

function showFloor(world: World, floor: number): ProblemAction {
  return { label: SHOW_FLOOR, at: floorPoint(world, floor) };
}

function showRoom(room: Room): ProblemAction {
  return { label: SHOW_ROOM, at: middle(room) };
}

/**
 * The worst rows of a list, then one row for the rest, so a large tower's problems stay readable:
 * `more` turns the rest into that row.
 */
function capped<T>(items: readonly T[], one: (item: T) => TowerProblem, more: (rest: readonly T[]) => TowerProblem): TowerProblem[] {
  if (items.length <= PROBLEM_ROWS_PER_KIND + 1) return items.map(one);
  return [...items.slice(0, PROBLEM_ROWS_PER_KIND).map(one), more(items.slice(PROBLEM_ROWS_PER_KIND))];
}

// ------------------------------------------------------------------ elevator waits

interface FloorWait {
  floor: number;
  people: number;
  waited: number;
  shaftId: Id;
}

/** Floors where someone has waited past the long-wait mark, worst first: the wait view's own data. */
function longWaitFloors(world: World): FloorWait[] {
  const queues = hallQueues(world);
  const worst = floorWaits(world, queues);
  const out: FloorWait[] = [];
  for (const [floor, waited] of worst) {
    if (waited <= LONG_WAIT_MINUTES) continue;
    let count = 0;
    let shaftId: Id = -1;
    let oldest = Number.POSITIVE_INFINITY;
    for (const [id, byFloor] of queues) {
      const queue = byFloor.get(floor);
      if (!queue) continue;
      count += queue.count;
      if (queue.since < oldest || (queue.since === oldest && id < shaftId)) {
        oldest = queue.since;
        shaftId = id;
      }
    }
    out.push({ floor, people: count, waited: Math.floor(waited), shaftId });
  }
  return out.sort((a, b) => b.waited - a.waited || b.people - a.people || a.floor - b.floor);
}

function waitProblems(world: World): TowerProblem[] {
  const one = (f: FloorWait): TowerProblem => {
    const shaft = world.shafts.get(f.shaftId);
    const actions: ProblemAction[] = [];
    if (shaft) actions.push({ label: OPEN_ELEVATOR, at: { floor: f.floor, x: shaft.x }, select: { shaftId: shaft.id } });
    actions.push(showFloor(world, f.floor));
    return {
      kind: 'wait',
      key: `wait:${f.floor}`,
      floors: [f.floor],
      count: f.people,
      minutes: f.waited,
      shaftId: f.shaftId,
      text: `${capital(floorName(f.floor))}: ${people(f.people)} waiting for an elevator, the longest for ${minutes(f.waited)}.`,
      actions,
    };
  };
  const more = (rest: readonly FloorWait[]): TowerProblem => {
    const worst = rest[0] as FloorWait;
    const count = rest.reduce((n, f) => n + f.people, 0);
    return {
      kind: 'wait',
      key: 'wait:more',
      floors: rest.map((f) => f.floor).sort((a, b) => a - b),
      count,
      minutes: worst.waited,
      text: `And ${formatCount(rest.length)} more floors where people have waited over ${minutes(LONG_WAIT_MINUTES)}, the worst on ${floorName(worst.floor)}.`,
      actions: [showFloor(world, worst.floor)],
    };
  };
  return capped(longWaitFloors(world), one, more);
}

// ------------------------------------------------------------------ give-ups

const GAVE_UP = /^Gave up waiting for an elevator on floor (B?)(\d+)\b/;

/**
 * People who gave up waiting in the last game hour, read from the log's give-up lines. The log is
 * the exact source: one warn line per give-up, with its floor. The story beats are not, since a
 * person nobody follows gets a beat at most once per gap.
 */
export function giveUpsInLastHour(world: World): { count: number; byFloor: Map<number, number> } {
  const since = (world.time?.minute ?? 0) - LAST_HOUR;
  const byFloor = new Map<number, number>();
  let count = 0;
  const log = world.log ?? [];
  for (let i = log.length - 1; i >= 0; i -= 1) {
    const line = log[i];
    if (!line || line.minute <= since) break;
    if (line.level !== 'warn') continue;
    const match = GAVE_UP.exec(line.text);
    if (!match) continue;
    const floor = Number(match[2]) * (match[1] ? -1 : 1);
    byFloor.set(floor, (byFloor.get(floor) ?? 0) + 1);
    count += 1;
  }
  return { count, byFloor };
}

function gaveUpProblems(world: World): TowerProblem[] {
  const { count, byFloor } = giveUpsInLastHour(world);
  if (count === 0) return [];
  const [floor] = [...byFloor].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0] as [number, number];
  const floors = [...byFloor.keys()].sort((a, b) => a - b);
  // A few floors are named; more than that, the floor with the most.
  const where = floors.length <= PROBLEM_ROWS_PER_KIND ? `on ${floorList(floors)}` : `most on ${floorName(floor)}`;
  return [
    {
      kind: 'gaveUp',
      key: 'gaveUp',
      floors,
      count,
      text: `${capital(people(count))} gave up waiting for an elevator in the last hour, ${where}. More cars or another elevator would help.`,
      actions: [showFloor(world, floor)],
    },
  ];
}

// ------------------------------------------------------------------ no way in

function noWayInProblems(world: World): TowerProblem[] {
  const cut = [...world.rooms.values()].filter((r) => VISITED.has(r.kind));
  if (cut.length === 0) return [];
  if (!groundLobby(world)) {
    const first = [...cut].sort((a, b) => a.floor - b.floor || a.id - b.id)[0] as Room;
    return [
      {
        kind: 'noWayIn',
        key: 'noWayIn:lobby',
        floors: [...new Set(cut.map((r) => r.floor))].sort((a, b) => a - b),
        count: cut.length,
        text: `There is no lobby, so nobody can get into the tower. Build a lobby on floor 1.`,
        actions: [showRoom(first)],
      },
    ];
  }
  const byFloor = new Map<number, Room[]>();
  for (const room of cut) {
    if (isReachableFromLobby(world, room.floor, Math.floor(room.x + room.width / 2))) continue;
    const list = byFloor.get(room.floor) ?? [];
    list.push(room);
    byFloor.set(room.floor, list);
  }
  const floors = [...byFloor.keys()].sort((a, b) => a - b);
  const one = (floor: number): TowerProblem => {
    const list = (byFloor.get(floor) ?? []).sort((a, b) => a.x - b.x);
    return {
      kind: 'noWayIn',
      key: `noWayIn:${floor}`,
      floors: [floor],
      count: list.length,
      text: `${capital(floorName(floor))}: ${rooms(list.length)} with no way in from the lobby. Give the floor an elevator stop or stairs.`,
      actions: [showFloor(world, floor)],
    };
  };
  const more = (rest: readonly number[]): TowerProblem => ({
    kind: 'noWayIn',
    key: 'noWayIn:more',
    floors: [...rest],
    count: rest.reduce((n, f) => n + (byFloor.get(f)?.length ?? 0), 0),
    text: `And ${formatCount(rest.length)} more floors with rooms nobody can get to, starting at ${floorName(rest[0] as number)}.`,
    actions: [showFloor(world, rest[0] as number)],
  });
  return capped(floors, one, more);
}

// ------------------------------------------------------------------ housekeeping

/** Can a housekeeper get from some housekeeping office to this room? The route a keeper would take. */
export function housekeepingReaches(world: World, room: Room): boolean {
  return roomsOfKind(world, 'housekeeping').some(
    (office) =>
      findRoute(world, middle(office), middle(room), { staff: true, riderClass: 'hotel' }) !== null,
  );
}

const HOTEL: ReadonlySet<RoomKind> = new Set<RoomKind>(['hotelSingle', 'hotelTwin', 'hotelSuite']);

/**
 * The hotel rooms, clean or not, this one housekeeping office has no route to, lowest floor first:
 * what its card says it cannot reach. A floor turns on the floor alone, so one route per floor.
 */
export function hotelRoomsOfficeCannotReach(world: World, office: Room): Room[] {
  const byFloor = new Map<number, boolean>();
  const out: Room[] = [];
  for (const room of world.rooms.values()) {
    if (!HOTEL.has(room.kind)) continue;
    let reached = byFloor.get(room.floor);
    if (reached === undefined) {
      reached = findRoute(world, middle(office), middle(room), { staff: true, riderClass: 'hotel' }) !== null;
      byFloor.set(room.floor, reached);
    }
    if (!reached) out.push(room);
  }
  return out.sort((a, b) => a.floor - b.floor || a.id - b.id);
}

/** "None", or "2 hotel rooms on floors 3 and 4": the housekeeping card's Cannot reach row. */
export function officeCannotReachWords(world: World, office: Room): string {
  const cut = hotelRoomsOfficeCannotReach(world, office);
  if (cut.length === 0) return 'None';
  return `${rooms(cut.length, 'hotel room')} on ${floorList([...new Set(cut.map((r) => r.floor))])}`;
}

function housekeepingProblems(world: World): TowerProblem[] {
  const offices = roomsOfKind(world, 'housekeeping');
  if (offices.length === 0) {
    const dirty = dirtyHotelRooms(world).filter((r) => r.dirty).sort((a, b) => a.floor - b.floor || a.id - b.id);
    const first = dirty[0];
    if (!first) return [];
    const floors = [...new Set(dirty.map((r) => r.floor))].sort((a, b) => a - b);
    return [
      {
        kind: 'noHousekeeping',
        key: 'noHousekeeping',
        floors,
        count: dirty.length,
        text: `${capital(rooms(dirty.length, 'hotel room'))} ${dirty.length === 1 ? 'needs' : 'need'} cleaning and there is no housekeeping. Build a housekeeping office.`,
        actions: [showRoom(first)],
      },
    ];
  }
  const cut = hotelRoomsHousekeepingCannotReach(world);
  const first = cut[0];
  if (!first) return [];
  const floors = [...new Set(cut.map((r) => r.floor))].sort((a, b) => a - b);
  return [
    {
      kind: 'housekeepingReach',
      key: 'housekeepingReach',
      floors,
      count: cut.length,
      text: `Housekeeping cannot get to ${rooms(cut.length, 'hotel room')} on ${floorList(floors)}, so ${cut.length === 1 ? 'it stays' : 'they stay'} dirty. Give housekeeping an elevator to ${floors.length === 1 ? 'that floor' : 'those floors'}.`,
      actions: [showFloor(world, first.floor), { label: 'Open housekeeping', at: middle(offices[0] as Room), select: { roomId: (offices[0] as Room).id } }],
    },
  ];
}

// ------------------------------------------------------------------ waste

function wasteProblems(world: World): TowerProblem[] {
  const centers = recyclingCenters(world);
  const backlog = [...world.rooms.values()].filter((r) => inWasteBacklog(r)).sort((a, b) => (a.wasteBacklogSince ?? 0) - (b.wasteBacklogSince ?? 0) || a.id - b.id);
  if (centers.length === 0) {
    if (!world.hadRecycling) return [];
    const first = backlog[0];
    const piling = backlog.length > 0 ? ` It is already piling up in ${rooms(backlog.length)}.` : '';
    return [
      {
        kind: 'wasteNoCenter',
        key: 'wasteNoCenter',
        floors: [...new Set(backlog.map((r) => r.floor))].sort((a, b) => a - b),
        count: backlog.length,
        text: `There is no recycling center now, so nobody collects the waste and rooms get dirty.${piling} Build a recycling center.`,
        actions: first ? [showRoom(first)] : [],
      },
    ];
  }
  const out: TowerProblem[] = [];
  const sum = centerSummary(world, centers[0] as Room);
  // Worked out now from the workers' own routes, not the day's record of failed trips, so the
  // row goes the moment the player gives the collectors a way and comes the moment one is cut.
  const cutFloors = new Set(floorsCollectorsCannotReach(world));
  if (cutFloors.size > 0) {
    const floors = [...cutFloors].sort((a, b) => a - b);
    const stuck = backlog.filter((r) => cutFloors.has(r.floor)).length;
    const piling = stuck > 0 ? ` Waste is piling up in ${rooms(stuck)} there.` : '';
    const center = centers[0] as Room;
    out.push({
      kind: 'wasteReach',
      key: 'wasteReach',
      floors,
      count: stuck,
      text: `The waste collectors cannot get to ${floorList(floors)}.${piling} Give the recycling center a way to ${floors.length === 1 ? 'that floor' : 'those floors'}.`,
      actions: [showFloor(world, floors[0] as number), { label: OPEN_CENTER, at: middle(center), select: { roomId: center.id } }],
    });
  }
  // Rooms piling up on floors the collectors can get to: collection is behind.
  const behind = backlog.filter((r) => !cutFloors.has(r.floor));
  const first = behind[0];
  if (first) {
    const atMost = centers.length >= (ROOMS.recycling.maxCount ?? Number.POSITIVE_INFINITY);
    const made = sum.madeToday;
    const took = sum.collectedToday;
    const units = (n: number): string => (n === 1 ? '1 unit' : `${formatCount(n)} units`);
    const tally = made > 0 || took > 0 ? ` Today the tower made ${units(made)} of waste and the collectors took ${units(took)}.` : '';
    const fix =
      took > 0 && took >= made
        ? 'The collectors are catching up.'
        : atMost
          ? 'If this keeps up, more elevators will help the collectors get around faster.'
          : 'If this keeps up, build another recycling center.';
    out.push({
      kind: 'wasteBehind',
      key: 'wasteBehind',
      floors: [...new Set(behind.map((r) => r.floor))].sort((a, b) => a - b),
      count: behind.length,
      text: `Waste is piling up in ${rooms(behind.length)}, the oldest on ${floorName(first.floor)}.${tally} ${fix}`,
      actions: [showRoom(first)],
    });
  }
  return out;
}

// ------------------------------------------------------------------ move-out countdown

/** The biggest reason a room's rating is low, in the present tense, by the evaluation's own weights. */
export function lowRatingReason(world: World, room: Room): string {
  const quiet = ROOMS[room.kind].quiet;
  const noisy = quiet ? noisyNeighborsOf(world, room) : [];
  const reasons: { weight: number; text: string }[] = [
    { weight: room.infested ? EVAL.infestedPenalty : 0, text: 'it has cockroaches' },
    { weight: room.dirty ? EVAL.dirtyPenalty : 0, text: inWasteBacklog(room) ? 'nobody has taken its trash away' : 'it needs cleaning' },
    { weight: EVAL.noisePenaltyPerNeighbor * noisy.length, text: noisy[0] ? `it is too loud next to the ${label(noisy[0].kind)}` : '' },
    { weight: quiet ? EVAL.stressWeight * averageTenantStress(world, room) : 0, text: 'people wait too long for an elevator' },
    { weight: takesRent(room.kind) ? (Math.max(0, room.rent - RENT.default) / RENT.default) * RENT.evalWeight : 0, text: 'the rent is too high' },
  ];
  let best: { weight: number; text: string } | null = null;
  for (const r of reasons) if (r.text !== '' && r.weight > 0 && (!best || r.weight > best.weight)) best = r;
  return best ? best.text : 'it is not worth the rent';
}

function moveOutProblems(world: World): TowerProblem[] {
  const now = world.time?.minute ?? 0;
  const counting = [...world.rooms.values()]
    .filter((r) => HOMES.has(r.kind) && r.lowEvalSinceMinute !== null && r.tenants.length > 0)
    .filter((r) => !r.tenants.every((id) => world.sims.get(id)?.kind === 'vip'))
    .sort((a, b) => (a.lowEvalSinceMinute ?? 0) - (b.lowEvalSinceMinute ?? 0) || a.id - b.id);
  const who = (room: Room): string => (room.kind === 'condo' ? 'owners' : room.kind === 'office' ? 'tenants' : 'guests');
  const one = (room: Room): TowerProblem => ({
    kind: 'moveOut',
    key: `moveOut:${room.id}`,
    floors: [room.floor],
    count: 1,
    roomId: room.id,
    text: `The ${label(room.kind)} on ${floorName(room.floor)} is rated too low. Its ${who(room)} will move out ${timeLeftWords(now, room.lowEvalSinceMinute ?? now)} unless it gets better. The main reason: ${lowRatingReason(world, room)}.`,
    actions: [showRoom(room)],
  });
  const more = (rest: readonly Room[]): TowerProblem => ({
    kind: 'moveOut',
    key: 'moveOut:more',
    floors: [...new Set(rest.map((r) => r.floor))].sort((a, b) => a - b),
    count: rest.length,
    text: `And ${formatCount(rest.length)} more rooms whose people will move out unless their rating gets better.`,
    actions: [showRoom(rest[0] as Room)],
  });
  return capped(counting, one, more);
}

// ------------------------------------------------------------------ all of it

/**
 * Every problem true in the tower right now, in the order Stories lists them. The folded warning
 * toast (ui.ts) counts this once, when it shows: a snapshot by design; the page counts again when opened.
 */
export function towerProblems(world: World): TowerProblem[] {
  return [
    ...waitProblems(world),
    ...gaveUpProblems(world),
    ...noWayInProblems(world),
    ...housekeepingProblems(world),
    ...wasteProblems(world),
    ...moveOutProblems(world),
  ];
}
