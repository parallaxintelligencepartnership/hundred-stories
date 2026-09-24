/**
 * Waste and the people who collect it.
 *
 * Waste is one number per room, never one item per piece of trash. It accrues only while a
 * recycling center stands, at the 06:00 roll: a room anyone used since the last roll gains
 * min(WASTE.dailyCap, ceil(people / WASTE.perLoad)) units, up to WASTE.roomCap. A room at or
 * above WASTE.backlogAt for WASTE.graceDays rolls in a row is in backlog: its dirty flag is
 * held (the same EVAL.dirtyPenalty an uncleaned hotel room takes) until a collector empties
 * it, and lets go at the next roll after.
 *
 * Every center staffs WASTE.workersPerCenter collectors, hired the tick after it goes up (and
 * again for an older save's center on load, from its id, so a replay stays equal) and removed
 * with it, as security.ts does for guards. On shift a worker takes the nearest room with waste
 * the other is not already after, walks there by the normal routes and elevators, collects,
 * goes on while the load is under WASTE.workerCapacity, then unloads at the center. A room with
 * no route is skipped and its floor logged once a day. Off shift the worker waits in the center.
 *
 * Nothing here draws from world.rng: rooms are taken nearest first and every tie breaks by id.
 * A worker in the center does not count toward its occupancy and is not population.
 */

import { findRoute } from './routing';
import { ROOMS, WASTE } from './rules';
import { clockOf, riderClassOf } from './types';
import type { CollectorState, Id, Leg, Room, RoomKind, Sim, World } from './types';
import { addSim, allocId, log, removeSim, roomsOfKind } from './world';

/** Preference weight only: one floor away counts as this many tiles when picking the nearest room. */
const FLOOR_PREFERENCE_TILES = 10;

const PRODUCERS = new Set<RoomKind>(WASTE.producers);
const HOTEL_KINDS = new Set<RoomKind>(['hotelSingle', 'hotelTwin', 'hotelSuite']);

export function producesWaste(kind: RoomKind): boolean {
  return PRODUCERS.has(kind);
}

function roomCenter(room: Room): number {
  return room.x + Math.floor(room.width / 2);
}

function floorText(floor: number): string {
  return floor < 0 ? `floor B${-floor}` : `floor ${floor}`;
}

function describe(room: Room): string {
  return `${ROOMS[room.kind].label.toLowerCase()} on ${floorText(room.floor)}`;
}

function withoutStandingRides(legs: Leg[]): Leg[] {
  return legs.filter((leg) => leg.kind !== 'ride' || leg.fromFloor !== leg.toFloor);
}

function routeOpts(sim: Sim): { staff: boolean; riderClass: ReturnType<typeof riderClassOf> } {
  return { staff: true, riderClass: riderClassOf(sim.kind) };
}

/** Recycling centers in id order, so staffing never depends on map order. */
export function recyclingCenters(world: World): Room[] {
  return roomsOfKind(world, 'recycling').sort((a, b) => a.id - b.id);
}

export function onCollectionShift(minuteOfDay: number): boolean {
  return minuteOfDay >= WASTE.shiftStart && minuteOfDay < WASTE.shiftEnd;
}

/** The minute the current waste day began: the last 06:00 roll at or before now. */
export function wasteDayStart(minute: number): number {
  const minuteOfDay = clockOf(minute).minuteOfDay;
  return minute - ((minuteOfDay - WASTE_ROLL_MINUTE_OF_DAY + 1440) % 1440);
}

/** Kept equal to events.ts EVENT_ROLL_MINUTE_OF_DAY, which calls rollWaste. */
const WASTE_ROLL_MINUTE_OF_DAY = 6 * 60;

function newCollectorState(): CollectorState {
  return { task: 'center', roomId: null, load: 0, until: null };
}

/** The workers of one center, in the order they were hired. */
export function collectorsOf(world: World, center: Room): Sim[] {
  const out: Sim[] = [];
  for (const id of center.tenants) {
    const sim = world.sims.get(id);
    if (sim && sim.kind === 'collector') out.push(sim);
  }
  return out;
}

/** How many collectors this center staffs: set at each roll, WASTE.workersPerCenter until the first. */
export function workerTarget(center: Room): number {
  return center.wasteWorkers ?? WASTE.workersPerCenter;
}

/** The count a roll sets: one more worker per WASTE.roomsPerWorker rooms that gained waste, within the bounds. */
export function workersFor(wasteRooms: number): number {
  const wanted = WASTE.workersPerCenter + Math.floor(wasteRooms / WASTE.roomsPerWorker);
  return Math.max(WASTE.workersPerCenter, Math.min(WASTE.maxWorkers, wanted));
}

/** Let the newest workers go (highest ids first) until the center is down to its count. */
function dismissExtra(world: World, center: Room): void {
  const target = workerTarget(center);
  if (center.tenants.length <= target) return;
  const keep = [...center.tenants].sort((a, b) => a - b).slice(0, target);
  for (const id of center.tenants) {
    if (keep.includes(id)) continue;
    const sim = world.sims.get(id);
    if (sim && sim.inCarId !== null) {
      for (const shaft of world.shafts.values()) {
        for (const car of shaft.cars) car.passengers = car.passengers.filter((p) => p !== id);
      }
    }
    removeSim(world, id);
  }
  center.tenants = center.tenants.filter((id) => keep.includes(id));
}

function staffCenter(world: World, center: Room): void {
  while (center.tenants.length < workerTarget(center)) {
    const worker: Sim = {
      id: allocId(world),
      kind: 'collector',
      homeRoomId: center.id,
      pos: { floor: center.floor, x: roomCenter(center) },
      inCarId: null,
      inRoomId: center.id,
      route: [],
      state: 'inRoom',
      stress: 0,
      waitStart: null,
      schedule: [],
      nextScheduleIndex: 0,
      stayUntil: null,
      wallet: 0,
      leaveReason: null,
      collector: newCollectorState(),
    };
    addSim(world, worker);
    center.tenants.push(worker.id);
  }
}

// ---------------------------------------------------------------- the round

function sendAlong(sim: Sim, legs: Leg[]): void {
  sim.route = withoutStandingRides(legs);
  sim.state = 'walking';
  sim.waitStart = null;
  sim.inRoomId = null;
}

function enterCenter(sim: Sim, center: Room, c: CollectorState, minute: number): void {
  sim.state = 'inRoom';
  sim.inRoomId = center.id;
  sim.pos = { floor: center.floor, x: roomCenter(center) };
  sim.route = [];
  sim.waitStart = null;
  c.roomId = null;
  if (c.load > 0) {
    c.task = 'unloading';
    c.until = minute + WASTE.unloadMinutes;
  } else {
    c.task = 'center';
    c.until = null;
  }
}

function headToCenter(world: World, sim: Sim, center: Room, c: CollectorState): void {
  if (sim.state === 'inRoom' && sim.inRoomId === center.id) {
    enterCenter(sim, center, c, world.time.minute);
    return;
  }
  const legs = findRoute(world, sim.pos, { floor: center.floor, x: roomCenter(center) }, routeOpts(sim));
  if (!legs) {
    // Stranded (the floor under them lost its last way out): the round still ends.
    enterCenter(sim, center, c, world.time.minute);
    return;
  }
  c.task = 'toCenter';
  c.roomId = null;
  c.until = null;
  sendAlong(sim, legs);
}

/** Rooms another worker is walking to or collecting from. */
function claimedRooms(world: World, except: Sim): Set<Id> {
  const claimed = new Set<Id>();
  for (const center of recyclingCenters(world)) {
    for (const other of collectorsOf(world, center)) {
      if (other.id === except.id || !other.collector) continue;
      const t = other.collector.task;
      if ((t === 'toRoom' || t === 'collecting') && other.collector.roomId !== null) claimed.add(other.collector.roomId);
    }
  }
  return claimed;
}

/** Log a floor no worker can reach, once a day per floor. */
function noteUnreachable(world: World, center: Room, floor: number): void {
  for (const other of recyclingCenters(world)) if (other.wasteUnreachable?.includes(floor)) return;
  const list = center.wasteUnreachable ?? [];
  list.push(floor);
  list.sort((a, b) => a - b);
  center.wasteUnreachable = list;
  log(world, `Collection could not reach ${floorText(floor)}.`, 'warn', { roomId: center.id });
}

function noteReachable(world: World, floor: number): void {
  for (const center of recyclingCenters(world)) {
    const list = center.wasteUnreachable;
    if (!list || !list.includes(floor)) continue;
    center.wasteUnreachable = list.filter((f) => f !== floor);
  }
}

/** The nearest room with waste nobody else has claimed, that has a route. True when the worker set off. */
function startNextRoom(world: World, sim: Sim, center: Room, c: CollectorState): boolean {
  const claimed = claimedRooms(world, sim);
  const from = sim.pos;
  const candidates: { room: Room; cost: number }[] = [];
  for (const room of world.rooms.values()) {
    if (!((room.waste ?? 0) > 0) || room.onFire || claimed.has(room.id)) continue;
    const cost = Math.abs(room.floor - from.floor) * FLOOR_PREFERENCE_TILES + Math.abs(roomCenter(room) - from.x);
    candidates.push({ room, cost });
  }
  if (candidates.length === 0) return false;
  candidates.sort((a, b) => a.cost - b.cost || a.room.id - b.room.id);
  const deadFloors = new Set<number>();
  for (const { room } of candidates) {
    if (deadFloors.has(room.floor)) continue;
    const legs = findRoute(world, from, { floor: room.floor, x: roomCenter(room) }, routeOpts(sim));
    if (!legs) {
      deadFloors.add(room.floor);
      noteUnreachable(world, center, room.floor);
      continue;
    }
    noteReachable(world, room.floor);
    c.task = 'toRoom';
    c.roomId = room.id;
    c.until = null;
    sendAlong(sim, legs);
    return true;
  }
  return false;
}

/** After a room: another if there is room in the cart and time on the shift, else back to unload. */
function nextMove(world: World, sim: Sim, center: Room, c: CollectorState): void {
  const onShift = onCollectionShift(clockOf(world.time.minute).minuteOfDay);
  if (onShift && c.load < WASTE.workerCapacity && startNextRoom(world, sim, center, c)) return;
  headToCenter(world, sim, center, c);
}

function collect(world: World, center: Room, c: CollectorState): void {
  const room = c.roomId === null ? undefined : world.rooms.get(c.roomId);
  if (!room) return;
  const take = Math.min(room.waste ?? 0, Math.max(0, WASTE.workerCapacity - c.load));
  if (take <= 0) return;
  room.waste = (room.waste ?? 0) - take;
  room.wasteCollectedAt = world.time.minute;
  c.load += take;
  center.wasteCollectedToday = (center.wasteCollectedToday ?? 0) + take;
}

/** One worker's minute: only when standing still does the worker choose what to do next. */
function tickCollector(world: World, sim: Sim, center: Room): void {
  if (!sim.collector) sim.collector = newCollectorState();
  const c = sim.collector;
  if (sim.state === 'leaving' || sim.state === 'gone' || sim.exiting) return;
  if (sim.state === 'waiting' || sim.state === 'riding') return;
  const minute = world.time.minute;
  const onShift = onCollectionShift(clockOf(minute).minuteOfDay);
  if (sim.route.length > 0) {
    // The shift ended on the way out, empty handed: turn back.
    if (!onShift && c.task === 'toRoom') headToCenter(world, sim, center, c);
    return;
  }
  switch (c.task) {
    case 'toRoom': {
      const room = c.roomId === null ? undefined : world.rooms.get(c.roomId);
      if (!room || room.onFire || !((room.waste ?? 0) > 0) || sim.pos.floor !== room.floor) {
        c.roomId = null;
        nextMove(world, sim, center, c);
        return;
      }
      c.task = 'collecting';
      c.until = minute + WASTE.collectMinutes;
      return;
    }
    case 'collecting':
      if (c.until !== null && minute < c.until) return;
      collect(world, center, c);
      c.roomId = null;
      c.until = null;
      nextMove(world, sim, center, c);
      return;
    case 'toCenter':
      if (sim.pos.floor !== center.floor) {
        headToCenter(world, sim, center, c); // lost the way (a shaft went): plan again from here
        return;
      }
      enterCenter(sim, center, c, minute);
      return;
    case 'unloading':
      if (c.until !== null && minute < c.until) return;
      c.load = 0;
      c.task = 'center';
      c.until = null;
      return;
    case 'center': {
      const inside = sim.state === 'inRoom' && sim.inRoomId === center.id;
      if (!onShift) {
        if (!inside) headToCenter(world, sim, center, c);
        return;
      }
      if (c.until !== null && minute < c.until) return;
      c.until = null;
      if (startNextRoom(world, sim, center, c)) return;
      if (!inside) headToCenter(world, sim, center, c);
      else c.until = minute + WASTE.recheckMinutes; // nothing reachable: look again in a while
      return;
    }
  }
}

/** Remember how many people used each producing room today; it sizes tomorrow's load. */
function samplePeaks(world: World): void {
  for (const room of world.rooms.values()) {
    if (!PRODUCERS.has(room.kind)) continue;
    if (room.occupancy > (room.wastePeak ?? 0)) room.wastePeak = room.occupancy;
  }
}

/** Called by tickPeople each minute: staff every center, note who is inside, move every worker. */
export function runCollectors(world: World): void {
  const centers = recyclingCenters(world);
  if (centers.length === 0) return;
  for (const center of centers) staffCenter(world, center);
  samplePeaks(world);
  for (const center of centers) {
    for (const sim of collectorsOf(world, center)) tickCollector(world, sim, center);
  }
}

/** A worker lost the car it was waiting for (the shaft went): the next tick plans again. */
export function collectorLostRoute(sim: Sim): void {
  sim.route = [];
  sim.state = 'walking';
  sim.waitStart = null;
}

// ---------------------------------------------------------------- the daily roll

function holdDirty(room: Room): void {
  room.dirty = true;
}

/**
 * Backlog over: the dirty flag goes, unless something else still has it. A hotel room with no
 * guest waits for housekeeping like any checked out room; a room a thief left a mess tidies on
 * the theft's own timer (events.ts).
 */
function releaseDirty(room: Room): void {
  if (HOTEL_KINDS.has(room.kind)) {
    if (room.tenants.length === 0) return;
    room.dirty = false;
    room.dirtySinceMinute = null;
    return;
  }
  if (room.dirtySinceMinute != null) return;
  room.dirty = false;
}

function clearWasteState(room: Room): void {
  if (room.wasteBacklogSince != null) releaseDirty(room);
  delete room.waste;
  delete room.wasteDays;
  delete room.wasteBacklogSince;
  delete room.wastePeak;
  delete room.wasteCollectedAt;
}

function hasWasteState(room: Room): boolean {
  return (
    room.waste !== undefined ||
    room.wasteDays !== undefined ||
    room.wasteBacklogSince !== undefined ||
    room.wastePeak !== undefined ||
    room.wasteCollectedAt !== undefined
  );
}

export interface WasteRoll {
  backlog: Id[];
  cleared: Id[];
}

/**
 * The 06:00 roll (events.ts calls it after the theft tidy, which records the story beats).
 * Without a center nothing accrues and any waste left from a demolished one is let go, so a
 * tower without a center carries no sanitation penalty and a tower that never had one is
 * untouched.
 */
export function rollWaste(world: World): WasteRoll {
  const out: WasteRoll = { backlog: [], cleared: [] };
  const centers = recyclingCenters(world);
  const rooms = [...world.rooms.values()].sort((a, b) => a.id - b.id);
  if (centers.length === 0) {
    for (const room of rooms) if (hasWasteState(room)) clearWasteState(room);
    return out;
  }
  const minute = world.time.minute;
  for (const center of centers) {
    center.wasteCollectedToday = 0;
    center.wasteUnreachable = [];
  }
  let wasteRooms = 0;
  for (const room of rooms) {
    if (!PRODUCERS.has(room.kind)) continue;
    if (room.wasteBacklogSince != null && !((room.waste ?? 0) > 0)) {
      room.wasteBacklogSince = null;
      releaseDirty(room);
      out.cleared.push(room.id);
      log(world, `The ${describe(room)} is clean again now its waste is collected.`, 'info', { roomId: room.id });
    }
    const people = Math.max(room.wastePeak ?? 0, room.tenants.length);
    if (people > 0 && !room.onFire) {
      const load = Math.min(WASTE.dailyCap, Math.ceil(people / WASTE.perLoad));
      room.waste = Math.min(WASTE.roomCap, (room.waste ?? 0) + load);
      wasteRooms += 1;
    }
    room.wastePeak = room.occupancy;
    room.wasteDays = (room.waste ?? 0) >= WASTE.backlogAt ? (room.wasteDays ?? 0) + 1 : 0;
    if (room.wasteDays >= WASTE.graceDays && room.wasteBacklogSince == null) {
      room.wasteBacklogSince = minute;
      out.backlog.push(room.id);
      log(world, `Waste is piling up in the ${describe(room)}. Nobody has collected it for ${WASTE.graceDays} days.`, 'warn', { roomId: room.id });
    }
    if (room.wasteBacklogSince != null) holdDirty(room);
  }
  // Collection grows with the tower: the next tick hires up to the count, and the extra go now.
  const workers = workersFor(wasteRooms);
  for (const center of centers) {
    center.wasteWorkers = workers;
    dismissExtra(world, center);
  }
  return out;
}

/** Is this room held dirty by uncollected waste? Housekeeping cannot clean that away. */
export function inWasteBacklog(room: Room): boolean {
  return room.wasteBacklogSince != null;
}

// ---------------------------------------------------------------- words for the panels

/** "In the center", "Collecting on floor 7", "Returning to the center", "Unloading", "Off shift". */
export function collectorStatus(world: World, sim: Sim): string {
  const c = sim.collector;
  if (!c) return 'In the center';
  const room = c.roomId === null ? undefined : world.rooms.get(c.roomId);
  if ((c.task === 'toRoom' || c.task === 'collecting') && room) return `Collecting on ${floorText(room.floor)}`;
  if (c.task === 'toCenter') return 'Returning to the center';
  if (c.task === 'unloading') return 'Unloading';
  if (!onCollectionShift(clockOf(world.time.minute).minuteOfDay)) return 'Off shift';
  return 'In the center';
}

export interface CenterSummary {
  workers: number;
  collectedToday: number;
  backlogRooms: number;
  unreachableFloors: number[];
}

export function centerSummary(world: World, center: Room): CenterSummary {
  let backlogRooms = 0;
  for (const room of world.rooms.values()) if (room.wasteBacklogSince != null) backlogRooms += 1;
  return {
    workers: workerTarget(center),
    collectedToday: center.wasteCollectedToday ?? 0,
    backlogRooms,
    unreachableFloors: [...(center.wasteUnreachable ?? [])],
  };
}
