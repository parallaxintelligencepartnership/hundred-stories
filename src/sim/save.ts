// Save, load, and hash the world.
//
// rng.ts note: createRng only exposes `state()` to read the internal counter; there is
// no `restore`/`setState` export. But the mulberry32 implementation in rng.ts advances
// a single 32-bit counter (`state = (state + 0x6d2b79f5) >>> 0`) and derives every output
// from that counter's current value only, never from history. So calling
// `createRng(savedState)` reproduces the exact same future sequence as the original rng
// at the moment it was saved, because `createRng`'s internal `state` variable is seeded
// to that same counter value. We rely on this instead of adding a restore() to rng.ts,
// which we are not allowed to touch.

import { createRng } from './rng';
import { createWorld, rebuildFloorIndex } from './world';
import type { Car, LogEntry, Room, Shaft, Sim, World } from './types';

export const SAVE_VERSION = 1;

const LOG_LIMIT = 200;

interface SaveCar {
  id: number;
  shaftId: number;
  y: number;
  dir: -1 | 0 | 1;
  state: Car['state'];
  doorTimer: number;
  idleSince: number | null;
  passengers: number[];
  calls: number[];
}

interface SaveShaft {
  id: number;
  kind: Shaft['kind'];
  x: number;
  width: number;
  floorMin: number;
  floorMax: number;
  stops: number[];
  homeFloor: number;
  cars: SaveCar[];
  hallCalls: [number, { up: boolean; down: boolean }][];
}

interface SaveData {
  version: number;
  seed: number;
  minute: number;
  cash: number;
  stars: World['stars'];
  population: number;
  nextId: number;
  rngState: number;
  rooms: Room[];
  shafts: SaveShaft[];
  sims: Sim[];
  events: World['events'];
  stats: World['stats'];
  gameOver: World['gameOver'];
  log: LogEntry[];
}

function shaftToSave(shaft: Shaft): SaveShaft {
  return {
    id: shaft.id,
    kind: shaft.kind,
    x: shaft.x,
    width: shaft.width,
    floorMin: shaft.floorMin,
    floorMax: shaft.floorMax,
    stops: Array.from(shaft.stops),
    homeFloor: shaft.homeFloor,
    cars: shaft.cars.map((car) => ({
      id: car.id,
      shaftId: car.shaftId,
      y: car.y,
      dir: car.dir,
      state: car.state,
      doorTimer: car.doorTimer,
      idleSince: car.idleSince,
      passengers: [...car.passengers],
      calls: Array.from(car.calls),
    })),
    hallCalls: Array.from(shaft.hallCalls.entries()),
  };
}

function buildSaveData(world: World): SaveData {
  return {
    version: SAVE_VERSION,
    seed: world.seed,
    minute: world.time.minute,
    cash: world.cash,
    stars: world.stars,
    population: world.population,
    nextId: world.nextId,
    rngState: world.rng.state(),
    rooms: Array.from(world.rooms.values()),
    shafts: Array.from(world.shafts.values()).map(shaftToSave),
    sims: Array.from(world.sims.values()),
    events: world.events,
    stats: world.stats,
    gameOver: world.gameOver,
    log: world.log.slice(-LOG_LIMIT),
  };
}

export function serialize(world: World): string {
  return JSON.stringify(buildSaveData(world));
}

const NOT_A_SAVE_REASON = 'This file is not a Hundred Stories save.';
const WRONG_VERSION_REASON = 'This save is from a different version of the game.';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasShape(data: unknown): data is SaveData {
  if (!isPlainObject(data)) return false;
  const d = data;
  if (typeof d.version !== 'number') return false;
  if (typeof d.seed !== 'number') return false;
  if (typeof d.minute !== 'number') return false;
  if (typeof d.cash !== 'number') return false;
  if (typeof d.stars !== 'number') return false;
  if (typeof d.population !== 'number') return false;
  if (typeof d.nextId !== 'number') return false;
  if (typeof d.rngState !== 'number') return false;
  if (!Array.isArray(d.rooms)) return false;
  if (!Array.isArray(d.shafts)) return false;
  if (!Array.isArray(d.sims)) return false;
  if (!Array.isArray(d.events)) return false;
  if (!isPlainObject(d.stats)) return false;
  if (d.gameOver !== null && !isPlainObject(d.gameOver)) return false;
  if (!Array.isArray(d.log)) return false;
  return true;
}

export function deserialize(text: string): { ok: true; world: World } | { ok: false; reason: string } {
  try {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, reason: NOT_A_SAVE_REASON };
    }

    if (!hasShape(parsed)) {
      return { ok: false, reason: NOT_A_SAVE_REASON };
    }

    if (parsed.version !== SAVE_VERSION) {
      return { ok: false, reason: WRONG_VERSION_REASON };
    }

    const world = createWorld(parsed.seed);
    world.time.minute = parsed.minute;
    world.cash = parsed.cash;
    world.stars = parsed.stars;
    world.population = parsed.population;
    world.nextId = parsed.nextId;
    world.rng = createRng(parsed.rngState);

    world.rooms = new Map(parsed.rooms.map((room) => [room.id, room]));

    world.shafts = new Map(
      parsed.shafts.map((saved) => {
        const shaft: Shaft = {
          id: saved.id,
          kind: saved.kind,
          x: saved.x,
          width: saved.width,
          floorMin: saved.floorMin,
          floorMax: saved.floorMax,
          stops: new Set(saved.stops),
          homeFloor: saved.homeFloor,
          cars: saved.cars.map((car) => ({
            id: car.id,
            shaftId: car.shaftId,
            y: car.y,
            dir: car.dir,
            state: car.state,
            doorTimer: car.doorTimer,
            idleSince: car.idleSince,
            passengers: [...car.passengers],
            calls: new Set(car.calls),
          })),
          hallCalls: new Map(saved.hallCalls),
        };
        return [shaft.id, shaft];
      })
    );

    world.sims = new Map(parsed.sims.map((sim) => [sim.id, sim]));
    world.events = parsed.events;
    world.stats = parsed.stats;
    world.gameOver = parsed.gameOver;
    world.log = parsed.log.slice(-LOG_LIMIT);

    rebuildFloorIndex(world);
    world.routingDirty = true;

    return { ok: true, world };
  } catch {
    return { ok: false, reason: NOT_A_SAVE_REASON };
  }
}

// Recursively sort object keys so the hash does not depend on property insertion order.
// Arrays keep their element order (order is meaningful there).
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (isPlainObject(value)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = canonicalize(value[key]);
    }
    return sorted;
  }
  return value;
}

function fnv1a32Hex(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function hashWorld(world: World): string {
  const data = buildSaveData(world) as unknown as Record<string, unknown>;
  const { log: _log, ...withoutLog } = data;
  const canonical = canonicalize(withoutLog);
  return fnv1a32Hex(JSON.stringify(canonical));
}
