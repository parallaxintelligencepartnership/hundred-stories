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
import { EVENTS, RENT, ROOMS, SHAFTS } from './rules';
import { VIP_PREFERENCES, vipPreference } from './identity';
import { createStoryState, sanitizeStory } from './story';
import { createWorld, rebuildFloorIndex } from './world';
import { MAX_FLOOR, MIN_FLOOR, TOWER_WIDTH } from './types';
import type { ActiveEvent, Car, LogEntry, RiderClass, Room, Shaft, Sim, SimKind, VipPhase, VipPreference, World } from './types';

/** v1 and pre-rent v2 saves have no `rent`; it is normalized to RENT.default on load. */
type SaveRoom = Omit<Room, 'rent'> & { rent?: number };

export const SAVE_VERSION = 4;

/**
 * Versions this loader understands. v1 has no per car settings and boolean hall calls.
 * v2 has no status bar baselines (quarterStartCash, dayStartPopulation): they load as null.
 * v1 to v3 have no story: they load with an empty one (identities need nothing stored).
 * A VIP visit from v4 or older has no phase: it loads as the notice or the stay (loadVipEvent).
 */
const READABLE_VERSIONS = [1, 2, 3, 4];

/**
 * The version the hash projection names. It stays at 2 because v3 only added the two display
 * baselines and v4 only the story, which the hash leaves out, so a v4 world hashes exactly as
 * it did under v2.
 */
const HASH_VERSION = 2;

/** A v1 hall call was one bit per direction: anyone waiting there was everyone. */
const ALL_CLASSES: readonly RiderClass[] = ['hotel', 'office', 'other'];

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
  serves: Car['serves']; // absent in v1: those cars carried everyone
  range: { lo: number; hi: number } | null;
}

/** v1 wrote `{ up: boolean, down: boolean }`; v2 writes the classes still waiting. */
type SaveHallCall =
  | { up: boolean; down: boolean }
  | { up: RiderClass[]; down: RiderClass[] };

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
  hallCalls: [number, SaveHallCall][];
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
  rooms: SaveRoom[];
  shafts: SaveShaft[];
  sims: Sim[];
  events: World['events'];
  stats: World['stats'];
  gameOver: World['gameOver'];
  log: LogEntry[];
  logTotal?: number;
  quarterStartCash?: number | null; // absent before v3
  dayStartPopulation?: number | null; // absent before v3
  story?: unknown; // absent before v4; checked by sanitizeStory, never a reason to refuse
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
      serves: car.serves,
      range: car.range === null ? null : { lo: car.range.lo, hi: car.range.hi },
    })),
    hallCalls: Array.from(shaft.hallCalls.entries()).map(([floor, call]) => [
      floor,
      { up: classList(call.up), down: classList(call.down) },
    ]),
  };
}

/** Classes in a fixed order, so the same world always serializes to the same bytes. */
function classList(classes: Set<RiderClass>): RiderClass[] {
  return ALL_CLASSES.filter((cls) => classes.has(cls));
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
    logTotal: world.logTotal,
    quarterStartCash: world.quarterStartCash,
    dayStartPopulation: world.dayStartPopulation,
    story: world.story,
  };
}

export function serialize(world: World): string {
  return JSON.stringify(buildSaveData(world));
}

const NOT_A_SAVE_REASON = 'This file is not a Hundred Stories save.';
const WRONG_VERSION_REASON = 'This save is from a different version of the game.';
const DAMAGED_REASON = 'This save is damaged and was not loaded.';

// Value tables for the string unions in types.ts, which only declares types.
// `satisfies Record<..., true>` makes a new kind or state a typecheck error here.
const SIM_KINDS = {
  worker: true,
  resident: true,
  guest: true,
  shopper: true,
  diner: true,
  staff: true,
  visitor: true,
  vip: true,
} satisfies Record<SimKind, true>;

const SIM_STATES = {
  inRoom: true,
  walking: true,
  waiting: true,
  riding: true,
  leaving: true,
  gone: true,
  outside: true,
} satisfies Record<Sim['state'], true>;

const CAR_STATES = { idle: true, moving: true, doorsOpen: true } satisfies Record<Car['state'], true>;

const CAR_SERVES = { any: true, hotel: true, office: true } satisfies Record<Car['serves'], true>;

const RIDER_CLASS_VALUES = { hotel: true, office: true, other: true } satisfies Record<RiderClass, true>;

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
  if (d.logTotal !== undefined && (typeof d.logTotal !== 'number' || !Number.isFinite(d.logTotal) || d.logTotal < 0)) return false;
  return true;
}

// Deep validation. hasShape only proves the top level types; a save can be correctly
// shaped and still be nonsense (a room on floor 0, a sim with an unknown kind, a
// negative minute), and loading that replaces the live game with junk. Every rule below
// returns the first field that breaks, which the reason quotes in parentheses.

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function inRange(value: unknown, min: number, max: number): boolean {
  return isFiniteNumber(value) && value >= min && value <= max;
}

/** Returns the first field that breaks a rule, or null when the save is sound. */
function firstInvalidField(d: SaveData): string | null {
  if (!isInteger(d.minute) || d.minute < 0) return 'minute';
  if (!isFiniteNumber(d.cash)) return 'cash';
  if (!isInteger(d.stars) || d.stars < 1 || d.stars > 6) return 'stars';
  if (!isInteger(d.nextId)) return 'nextId';
  if (d.quarterStartCash != null && !isFiniteNumber(d.quarterStartCash)) return 'quarterStartCash';
  if (d.dayStartPopulation != null && !isFiniteNumber(d.dayStartPopulation)) return 'dayStartPopulation';

  // Ids come from one counter in world.ts, so they are unique across rooms, shafts,
  // cars and sims alike, and nextId is always past the highest one handed out.
  const seen = new Set<number>();
  function takeId(value: unknown, field: string): string | null {
    if (!isInteger(value) || value < 1) return field;
    if (seen.has(value)) return field;
    if (value >= d.nextId) return 'nextId';
    seen.add(value);
    return null;
  }

  for (let i = 0; i < d.rooms.length; i++) {
    const at = `rooms[${i}]`;
    const room = d.rooms[i] as unknown;
    if (!isPlainObject(room)) return at;
    const bad = takeId(room.id, `${at}.id`);
    if (bad) return bad;
    if (typeof room.kind !== 'string' || !Object.hasOwn(ROOMS, room.kind)) return `${at}.kind`;
    if (!isInteger(room.floor) || room.floor === 0 || room.floor < MIN_FLOOR || room.floor > MAX_FLOOR) return `${at}.floor`;
    if (!isFiniteNumber(room.x) || room.x < 0 || room.x >= TOWER_WIDTH) return `${at}.x`;
    if (!isFiniteNumber(room.width) || room.width <= 0) return `${at}.width`;
    if (!isFiniteNumber(room.height) || room.height <= 0) return `${at}.height`;
    if (!inRange(room.eval, 0, 1)) return `${at}.eval`;
    if (
      room.rent !== undefined &&
      (!isInteger(room.rent) || room.rent < RENT.min || room.rent > RENT.max || (room.rent - RENT.min) % RENT.step !== 0)
    ) {
      return `${at}.rent`;
    }
  }

  for (let i = 0; i < d.shafts.length; i++) {
    const at = `shafts[${i}]`;
    const shaft = d.shafts[i] as unknown;
    if (!isPlainObject(shaft)) return at;
    const bad = takeId(shaft.id, `${at}.id`);
    if (bad) return bad;
    if (typeof shaft.kind !== 'string' || !Object.hasOwn(SHAFTS, shaft.kind)) return `${at}.kind`;
    if (!isInteger(shaft.floorMin) || shaft.floorMin < MIN_FLOOR || shaft.floorMin > MAX_FLOOR) return `${at}.floorMin`;
    if (!isInteger(shaft.floorMax) || shaft.floorMax < MIN_FLOOR || shaft.floorMax > MAX_FLOOR) return `${at}.floorMax`;
    if (shaft.floorMin > shaft.floorMax) return `${at}.floorMin`;
    if (!isFiniteNumber(shaft.x) || shaft.x < 0 || shaft.x >= TOWER_WIDTH) return `${at}.x`;
    if (!Array.isArray(shaft.stops)) return `${at}.stops`;
    for (const stop of shaft.stops) {
      if (!isInteger(stop) || stop < shaft.floorMin || stop > shaft.floorMax) return `${at}.stops`;
    }
    if (!Array.isArray(shaft.cars)) return `${at}.cars`;
    for (let c = 0; c < shaft.cars.length; c++) {
      const carAt = `${at}.cars[${c}]`;
      const car = shaft.cars[c] as unknown;
      if (!isPlainObject(car)) return carAt;
      const badCar = takeId(car.id, `${carAt}.id`);
      if (badCar) return badCar;
      if (!inRange(car.y, shaft.floorMin, shaft.floorMax)) return `${carAt}.y`;
      if (typeof car.state !== 'string' || !Object.hasOwn(CAR_STATES, car.state)) return `${carAt}.state`;
      // v1 cars have neither field; both default on load.
      if (car.serves !== undefined) {
        if (typeof car.serves !== 'string' || !Object.hasOwn(CAR_SERVES, car.serves)) {
          return `${carAt}.serves`;
        }
      }
      if (car.range !== undefined && car.range !== null) {
        const span = car.range as unknown;
        if (!isPlainObject(span)) return `${carAt}.range`;
        if (!isInteger(span.lo) || !isInteger(span.hi)) return `${carAt}.range`;
        if (span.lo > span.hi) return `${carAt}.range`;
        if (span.lo < shaft.floorMin || span.hi > shaft.floorMax) return `${carAt}.range`;
      }
    }
    if (!Array.isArray(shaft.hallCalls)) return `${at}.hallCalls`;
    for (const entry of shaft.hallCalls) {
      if (!Array.isArray(entry) || entry.length !== 2) return `${at}.hallCalls`;
      if (!isInteger(entry[0])) return `${at}.hallCalls`;
      const call = entry[1] as unknown;
      if (!isPlainObject(call)) return `${at}.hallCalls`;
      for (const side of [call.up, call.down]) {
        if (typeof side === 'boolean') continue; // v1
        if (!Array.isArray(side)) return `${at}.hallCalls`;
        for (const cls of side) {
          if (typeof cls !== 'string' || !Object.hasOwn(RIDER_CLASS_VALUES, cls)) {
            return `${at}.hallCalls`;
          }
        }
      }
    }
  }

  for (let i = 0; i < d.sims.length; i++) {
    const at = `sims[${i}]`;
    const sim = d.sims[i] as unknown;
    if (!isPlainObject(sim)) return at;
    const bad = takeId(sim.id, `${at}.id`);
    if (bad) return bad;
    if (typeof sim.kind !== 'string' || !Object.hasOwn(SIM_KINDS, sim.kind)) return `${at}.kind`;
    if (typeof sim.state !== 'string' || !Object.hasOwn(SIM_STATES, sim.state)) return `${at}.state`;
    if (!inRange(sim.stress, 0, 1)) return `${at}.stress`;
    if (!isPlainObject(sim.pos)) return `${at}.pos`;
    if (!isFiniteNumber(sim.pos.floor)) return `${at}.pos.floor`;
    if (!isFiniteNumber(sim.pos.x)) return `${at}.pos.x`;
  }

  return null;
}

const VIP_PHASES = { notice: true, route: true, stay: true, checkout: true } satisfies Record<VipPhase, true>;

function numberOr<T>(value: unknown, fallback: T): number | T {
  return isFiniteNumber(value) ? value : fallback;
}

/**
 * A VIP visit as saved. v4 and older wrote only the booking (sim, suite, arrival, departure):
 * before arrival that is the notice, after it the VIP was already in the suite, so the stay.
 * The preference comes from the identity hash, like the name. Anything missing gets its start
 * value, so an old visit carries on and is rated from here.
 */
function loadVipEvent(world: World, raw: Extract<ActiveEvent, { kind: 'vip' }>): Extract<ActiveEvent, { kind: 'vip' }> {
  const r = raw as unknown as Record<string, unknown>;
  const simId = raw.simId;
  const suiteId = isFiniteNumber(r.suiteId) ? r.suiteId : null;
  const arrivesAt = numberOr(r.arrivesAt, world.time.minute);
  const leavesAt = numberOr(r.leavesAt, arrivesAt + EVENTS.vip.stayMinutes);
  const savedPhase = typeof r.phase === 'string' && Object.hasOwn(VIP_PHASES, r.phase) ? (r.phase as VipPhase) : null;
  const phase: VipPhase = savedPhase ?? (world.time.minute < arrivesAt ? 'notice' : 'stay');
  const suite = suiteId === null ? undefined : world.rooms.get(suiteId);
  const inStay = phase === 'stay' || phase === 'checkout';
  const preference =
    typeof r.preference === 'string' && (VIP_PREFERENCES as readonly string[]).includes(r.preference)
      ? (r.preference as VipPreference)
      : vipPreference(world.seed, simId);
  return {
    kind: 'vip',
    simId,
    arrivesAt,
    leavesAt,
    score: numberOr(r.score, 0),
    suiteId,
    phase,
    preference,
    longestWait: numberOr(r.longestWait, 0),
    waitingSince: numberOr(r.waitingSince, null),
    checkInClean:
      typeof r.checkInClean === 'boolean' ? r.checkInClean : inStay && savedPhase === null ? (suite ? !suite.dirty && !suite.infested : true) : null,
    checkInEval: numberOr(r.checkInEval, inStay && savedPhase === null ? (suite ? suite.eval : 1) : null),
    incident: r.incident === true,
  };
}

/** A v1 direction bit means every class was waiting; v2 names them. */
function loadClasses(side: boolean | RiderClass[]): Set<RiderClass> {
  if (typeof side === 'boolean') return new Set(side ? ALL_CLASSES : []);
  return new Set(side);
}

function loadHallCall(call: SaveHallCall): { up: Set<RiderClass>; down: Set<RiderClass> } {
  return { up: loadClasses(call.up), down: loadClasses(call.down) };
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

    if (!READABLE_VERSIONS.includes(parsed.version)) {
      return { ok: false, reason: WRONG_VERSION_REASON };
    }

    const invalid = firstInvalidField(parsed);
    if (invalid !== null) {
      return { ok: false, reason: `${DAMAGED_REASON} (${invalid})` };
    }

    const world = createWorld(parsed.seed);
    world.time.minute = parsed.minute;
    world.cash = parsed.cash;
    world.stars = parsed.stars;
    world.population = parsed.population;
    // A save older than v3 never recorded them: unknown until the next boundary sets them.
    world.quarterStartCash = parsed.quarterStartCash ?? null;
    world.dayStartPopulation = parsed.dayStartPopulation ?? null;
    world.nextId = parsed.nextId;
    world.rng = createRng(parsed.rngState);

    world.rooms = new Map(
      parsed.rooms.map((room): [number, Room] => [room.id, { ...room, rent: room.rent ?? RENT.default }]),
    );

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
            serves: car.serves ?? 'any',
            range: car.range ?? null,
          })),
          hallCalls: new Map(saved.hallCalls.map(([floor, call]) => [floor, loadHallCall(call)])),
        };
        return [shaft.id, shaft];
      })
    );

    world.sims = new Map(
      parsed.sims.map((sim) => {
        // Story only: a start minute that is not a number is dropped, never a refusal.
        if (sim.storyTripStart !== undefined && !isFiniteNumber(sim.storyTripStart)) delete sim.storyTripStart;
        return [sim.id, sim];
      }),
    );
    world.story = parsed.version >= 4 ? sanitizeStory(parsed.story) : createStoryState();
    world.events = parsed.events.map((event) => (event.kind === 'vip' ? loadVipEvent(world, event) : event));
    world.stats = parsed.stats;
    world.gameOver = parsed.gameOver;
    world.log = parsed.log.slice(-LOG_LIMIT);
    world.logTotal = typeof parsed.logTotal === 'number' ? parsed.logTotal : world.log.length;

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

// The hash projection is written out field by field on purpose. Hashing buildSaveData
// would be self referential: a field the serializer forgets is also missing from the
// hash, so the round trip test would still pass. Listing every key of Room, Car, Shaft
// and Sim here, with `satisfies Record<keyof T, unknown>`, means a field added to
// types.ts later fails to compile until it is projected, and a field the serializer
// drops changes the hash.

function roomForHash(room: Room) {
  return {
    id: room.id,
    kind: room.kind,
    floor: room.floor,
    x: room.x,
    width: room.width,
    height: room.height,
    eval: room.eval,
    tenants: [...room.tenants],
    occupancy: room.occupancy,
    builtAtMinute: room.builtAtMinute,
    vacant: room.vacant,
    dirty: room.dirty,
    // optional in types.ts: normalize so an absent key and an explicit null hash alike
    dirtySinceMinute: room.dirtySinceMinute ?? null,
    infested: room.infested,
    lowEvalSinceMinute: room.lowEvalSinceMinute,
    onFire: room.onFire,
    rent: room.rent,
  } satisfies Record<keyof Room, unknown>;
}

function carForHash(car: Car) {
  return {
    id: car.id,
    shaftId: car.shaftId,
    y: car.y,
    dir: car.dir,
    state: car.state,
    doorTimer: car.doorTimer,
    idleSince: car.idleSince,
    passengers: [...car.passengers],
    calls: Array.from(car.calls).sort((a, b) => a - b),
    serves: car.serves,
    range: car.range === null ? null : { lo: car.range.lo, hi: car.range.hi },
  } satisfies Record<keyof Car, unknown>;
}

function shaftForHash(shaft: Shaft) {
  return {
    id: shaft.id,
    kind: shaft.kind,
    x: shaft.x,
    width: shaft.width,
    floorMin: shaft.floorMin,
    floorMax: shaft.floorMax,
    stops: Array.from(shaft.stops).sort((a, b) => a - b),
    homeFloor: shaft.homeFloor,
    cars: shaft.cars.map(carForHash), // creation order is meaningful, so it is kept
    hallCalls: Array.from(shaft.hallCalls.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([floor, call]) => [floor, { up: classList(call.up), down: classList(call.down) }]),
  } satisfies Record<keyof Shaft, unknown>;
}

/** Sim keys the hash leaves out on purpose: storyTripStart is story state, never read by the tick. */
type UnhashedSimKey = 'storyTripStart';

function simForHash(sim: Sim) {
  return {
    id: sim.id,
    kind: sim.kind,
    homeRoomId: sim.homeRoomId,
    pos: { floor: sim.pos.floor, x: sim.pos.x },
    inCarId: sim.inCarId,
    inRoomId: sim.inRoomId,
    route: sim.route.map((leg) => ({ ...leg })),
    state: sim.state,
    stress: sim.stress,
    waitStart: sim.waitStart,
    schedule: sim.schedule.map((entry) => ({ ...entry, days: [...entry.days], goal: { ...entry.goal } })),
    nextScheduleIndex: sim.nextScheduleIndex,
    stayUntil: sim.stayUntil,
    wallet: sim.wallet,
    leaveReason: sim.leaveReason,
    // optional in types.ts: normalize so an absent key and an explicit false hash alike
    exiting: sim.exiting ?? false,
  } satisfies Record<Exclude<keyof Sim, UnhashedSimKey>, unknown>;
}

// World keys the hash leaves out on purpose: the log is chatter, rng is hashed as its
// state number, floorIndex is derived from rooms and shafts, routingDirty is a cache
// flag, structureVersion is the renderer's change counter, longWaits is the goals card's
// counter of long hall waits, and time is hashed as `minute`.
// quarterStartCash and dayStartPopulation are the status bar's display baselines: nothing in
// the sim reads them, so they are saved but not hashed, and the bench hashes stay put.
// story is presentation state (src/sim/story.ts): saved from v4, never read by the tick.
type UnhashedWorldKey =
  | 'log'
  | 'logTotal'
  | 'rng'
  | 'floorIndex'
  | 'routingDirty'
  | 'structureVersion'
  | 'longWaits'
  | 'time'
  | 'quarterStartCash'
  | 'dayStartPopulation'
  | 'story';
type HashedWorldKey = Exclude<keyof World, UnhashedWorldKey> | 'minute' | 'rngState';

function byId<T extends { id: number }>(items: Iterable<T>): T[] {
  return Array.from(items).sort((a, b) => a.id - b.id);
}

export function hashWorld(world: World): string {
  const projection = {
    version: HASH_VERSION,
    seed: world.seed,
    minute: world.time.minute,
    cash: world.cash,
    stars: world.stars,
    population: world.population,
    nextId: world.nextId,
    rngState: world.rng.state(),
    rooms: byId(world.rooms.values()).map(roomForHash),
    shafts: byId(world.shafts.values()).map(shaftForHash),
    sims: byId(world.sims.values()).map(simForHash),
    events: world.events.map((event) => ({ ...event })),
    stats: world.stats,
    gameOver: world.gameOver,
  } satisfies Record<HashedWorldKey | 'version', unknown>;
  return fnv1a32Hex(JSON.stringify(canonicalize(projection)));
}
