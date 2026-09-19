// World construction and the small set of helpers every sim module shares.
// Keep this file boring: no gameplay rules here, only bookkeeping.

import { createRng } from './rng';
import { LIMITS } from './rules';
import type { FloorIndex, Id, LogEntry, Room, Shaft, Sim, World } from './types';

export function createWorld(seed: number): World {
  return {
    seed,
    rng: createRng(seed),
    time: { minute: 6 * 60 }, // a new game opens at 06:00 on the first weekday
    cash: LIMITS.startingCash,
    stars: 1,
    population: 0,
    rooms: new Map(),
    shafts: new Map(),
    sims: new Map(),
    nextId: 1,
    log: [],
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
    gameOver: null,
  };
}

export function allocId(world: World): Id {
  return world.nextId++;
}

export function log(world: World, text: string, level: LogEntry['level'] = 'info', extra: { roomId?: Id; simId?: Id } = {}): void {
  world.log.push({ minute: world.time.minute, text, level, ...extra });
  if (world.log.length > 2000) world.log.splice(0, world.log.length - 2000);
}

export function addRoom(world: World, room: Room): void {
  world.rooms.set(room.id, room);
  world.routingDirty = true;
  rebuildFloorIndex(world);
}

export function removeRoom(world: World, roomId: Id): void {
  world.rooms.delete(roomId);
  world.routingDirty = true;
  rebuildFloorIndex(world);
}

export function addShaft(world: World, shaft: Shaft): void {
  world.shafts.set(shaft.id, shaft);
  world.routingDirty = true;
  rebuildFloorIndex(world);
}

export function removeShaft(world: World, shaftId: Id): void {
  world.shafts.delete(shaftId);
  world.routingDirty = true;
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
    for (let f = room.floor; f < room.floor + room.height; f++) {
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
