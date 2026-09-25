// World construction and the small set of helpers every sim module shares.
// Keep this file boring: no gameplay rules here, only bookkeeping.

import { createRng } from './rng';
import { GAME_START_MINUTE, LIMITS, STORY } from './rules';
import { createStoryState } from './story';
import { spanFloors } from './types';
import type { FloorIndex, Id, LogEntry, Room, Shaft, Sim, World } from './types';

/**
 * What a tower may start with besides its starting number. Empty is the standard start. The
 * daily tower (src/game/daily.ts) uses `cash` for its Tight money day; the build log keeps the
 * start beside the log so a replay begins from the same place (src/sim/buildlog.ts).
 */
export interface TowerStart {
  cash?: number;
}

export function createWorld(seed: number, start: TowerStart = {}): World {
  const cash = start.cash ?? LIMITS.startingCash;
  return {
    seed,
    rng: createRng(seed),
    time: { minute: GAME_START_MINUTE }, // a new game opens at 06:00 on the first weekday
    cash,
    quarterStartCash: cash, // a new game opens inside its first quarter
    stars: 1,
    population: 0,
    dayStartPopulation: 0,
    rooms: new Map(),
    shafts: new Map(),
    sims: new Map(),
    nextId: 1,
    log: [],
    logTotal: 0,
    events: [],
    stats: {
      incomeByKind: {},
      upkeepByKind: {},
      lastQuarter: { income: 0, upkeep: 0, net: 0 },
      vipRating: 'none',
      weddingsHeld: 0,
      avgWaitMinutes: 0,
      tenantsLeftReasons: {},
      badQuarterStreak: 0,
    },
    floorIndex: { rooms: new Map(), shafts: new Map(), builtFloors: new Set() },
    routingDirty: true,
    structureVersion: 0,
    longWaits: emptyLongWaits(),
    story: createStoryState(),
    gameOver: null,
  };
}

export function allocId(world: World): Id {
  return world.nextId++;
}

export function log(world: World, text: string, level: LogEntry['level'] = 'info', extra: { roomId?: Id; simId?: Id } = {}): void {
  world.logTotal += 1;
  world.log.push({ minute: world.time.minute, text, level, ...extra });
  if (world.log.length > 2000) world.log.splice(0, world.log.length - 2000);
}

/** A hall wait longer than this many minutes counts as a long wait (one number, in rules.ts). */
export const LONG_WAIT_MINUTES = STORY.longWaitMinutes;
const LONG_WAIT_SLOTS = 24;

function emptyLongWaits(): World['longWaits'] {
  return { hour: new Array<number>(LONG_WAIT_SLOTS).fill(-1), count: new Array<number>(LONG_WAIT_SLOTS).fill(0) };
}

/** Count one wait that just passed LONG_WAIT_MINUTES, in the current game hour. */
export function recordLongWait(world: World): void {
  const hour = Math.floor(world.time.minute / 60);
  const slot = hour % LONG_WAIT_SLOTS;
  const ring = world.longWaits;
  if (ring.hour[slot] !== hour) {
    ring.hour[slot] = hour;
    ring.count[slot] = 0;
  }
  ring.count[slot] = (ring.count[slot] ?? 0) + 1;
}

/** Long waits counted in one absolute game hour (minute / 60), or 0 once it left the ring. */
export function longWaitsInHour(world: Pick<World, 'longWaits'>, hour: number): number {
  const slot = ((hour % LONG_WAIT_SLOTS) + LONG_WAIT_SLOTS) % LONG_WAIT_SLOTS;
  return world.longWaits.hour[slot] === hour ? (world.longWaits.count[slot] ?? 0) : 0;
}

/** Tell the renderer the static tower changed. See World.structureVersion. */
export function markStructureChanged(world: World): void {
  world.structureVersion += 1;
}

/**
 * Set a room's head count. Only the empty or occupied bit shows on screen (a lit window
 * at night), so the structure version moves only when the count crosses zero.
 */
export function setOccupancy(world: World, room: Room, occupancy: number): void {
  if ((room.occupancy > 0) !== (occupancy > 0)) markStructureChanged(world);
  room.occupancy = occupancy;
}

/** Set or clear a room's fire, which tints the room. */
export function setOnFire(world: World, room: Room, onFire: boolean): void {
  if (room.onFire !== onFire) markStructureChanged(world);
  room.onFire = onFire;
}

export function addRoom(world: World, room: Room): void {
  world.rooms.set(room.id, room);
  world.routingDirty = true;
  markStructureChanged(world);
  rebuildFloorIndex(world);
}

export function removeRoom(world: World, roomId: Id): void {
  world.rooms.delete(roomId);
  world.routingDirty = true;
  markStructureChanged(world);
  rebuildFloorIndex(world);
}

export function addShaft(world: World, shaft: Shaft): void {
  world.shafts.set(shaft.id, shaft);
  world.routingDirty = true;
  markStructureChanged(world);
  rebuildFloorIndex(world);
}

export function removeShaft(world: World, shaftId: Id): void {
  world.shafts.delete(shaftId);
  world.routingDirty = true;
  markStructureChanged(world);
  rebuildFloorIndex(world);
}

export function addSim(world: World, sim: Sim): void {
  world.sims.set(sim.id, sim);
}

export function removeSim(world: World, simId: Id): void {
  world.sims.delete(simId);
}

export function rebuildFloorIndex(world: World): void {
  const index: FloorIndex = { rooms: new Map(), shafts: new Map(), builtFloors: new Set() };
  for (const room of world.rooms.values()) {
    for (const f of spanFloors(room.floor, room.height)) {
      let list = index.rooms.get(f);
      if (!list) index.rooms.set(f, (list = []));
      list.push(room);
      index.builtFloors.add(f);
    }
  }
  for (const list of index.rooms.values()) list.sort((a, b) => a.x - b.x);
  for (const shaft of world.shafts.values()) {
    for (const f of shaft.stops) {
      let list = index.shafts.get(f);
      if (!list) index.shafts.set(f, (list = []));
      list.push(shaft);
    }
  }
  for (const list of index.shafts.values()) list.sort((a, b) => a.x - b.x);
  world.floorIndex = index;
}

export function roomsOnFloor(world: World, floor: number): readonly Room[] {
  return world.floorIndex.rooms.get(floor) ?? [];
}

export function shaftsOnFloor(world: World, floor: number): readonly Shaft[] {
  return world.floorIndex.shafts.get(floor) ?? [];
}

export function roomAt(world: World, floor: number, x: number): Room | undefined {
  return roomsOnFloor(world, floor).find((r) => x >= r.x && x < r.x + r.width);
}

export function shaftAt(world: World, floor: number, x: number): Shaft | undefined {
  for (const s of world.shafts.values()) {
    if (floor >= s.floorMin && floor <= s.floorMax && x >= s.x && x < s.x + s.width) return s;
  }
  return undefined;
}

/** The ground lobby, if built. Sims enter and leave the tower through it. */
export function groundLobby(world: World): Room | undefined {
  return roomsOnFloor(world, 1).find((r) => r.kind === 'lobby');
}

export function roomsOfKind(world: World, kind: Room['kind']): Room[] {
  const out: Room[] = [];
  for (const r of world.rooms.values()) if (r.kind === kind) out.push(r);
  return out;
}
