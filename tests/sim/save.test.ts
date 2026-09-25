import { describe, expect, it } from 'vitest';
import { createWorld, addRoom, addShaft, addSim, log } from '../../src/sim/world';
import { serialize, deserialize, hashWorld, SAVE_VERSION } from '../../src/sim/save';
import { applyCommand } from '../../src/sim/build';
import { ROOMS } from '../../src/sim/rules';
import { tick } from '../../src/sim/tick';
import type { Car, CollectorState, Command, GuardState, RiderClass, Room, Shaft, Sim, World } from '../../src/sim/types';

function buildRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: 1,
    kind: 'office',
    floor: 2,
    x: 100,
    width: 10,
    height: 1,
    eval: 0.8,
    tenants: [],
    occupancy: 0,
    builtAtMinute: 0,
    vacant: true,
    dirty: false,
    infested: false,
    lowEvalSinceMinute: null,
    onFire: false,
    rent: 100,
    ...overrides,
  };
}

function buildShaft(overrides: Partial<Shaft> = {}): Shaft {
  return {
    id: 10,
    kind: 'standard',
    x: 150,
    width: 2,
    floorMin: 1,
    floorMax: 10,
    stops: new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
    homeFloor: 1,
    cars: [
      {
        id: 11,
        shaftId: 10,
        y: 1,
        dir: 0,
        state: 'idle',
        doorTimer: 0,
        idleSince: 0,
        passengers: [],
        calls: new Set([5]),
        serves: 'any',
        range: null,
      },
    ],
    hallCalls: new Map([[3, { up: new Set<RiderClass>(['office']), down: new Set<RiderClass>() }]]),
    ...overrides,
  };
}

function buildSim(overrides: Partial<Sim> = {}): Sim {
  return {
    id: 20,
    kind: 'worker',
    homeRoomId: 1,
    pos: { floor: 2, x: 105 },
    inCarId: null,
    inRoomId: 1,
    route: [{ kind: 'walk', toX: 110 }],
    state: 'inRoom',
    stress: 0.1,
    waitStart: null,
    schedule: [],
    nextScheduleIndex: 0,
    stayUntil: null,
    wallet: 0,
    leaveReason: null,
    ...overrides,
  };
}

function richWorld(): World {
  const world = createWorld(777);
  addRoom(world, buildRoom());
  addRoom(world, buildRoom({ id: 2, kind: 'lobby', floor: 1, x: 100, width: 40, height: 1, vacant: false }));
  addShaft(world, buildShaft());
  addSim(world, buildSim());
  world.events.push({ kind: 'santa', startedAt: 0, x: 0 });
  world.nextId = 21; // ids 1, 2, 10, 11 and 20 are handed out by hand above; nextId must sit past them
  world.cash = 123456;
  world.stars = 3;
  world.population = 6;
  log(world, 'Test event happened.');
  return world;
}

describe('save/deserialize round trip', () => {
  it('hashWorld matches after a full serialize/deserialize round trip', () => {
    const world = richWorld();
    const beforeHash = hashWorld(world);
    const text = serialize(world);
    const result = deserialize(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const afterHash = hashWorld(result.world);
    expect(afterHash).toBe(beforeHash);
  });

  it('restores rooms as a Map keyed by id', () => {
    const world = richWorld();
    const result = deserialize(serialize(world));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.world.rooms).toBeInstanceOf(Map);
    expect(result.world.rooms.get(1)?.kind).toBe('office');
    expect(result.world.rooms.get(2)?.kind).toBe('lobby');
  });

  it('keeps a non-default rent across a serialize/deserialize round trip', () => {
    const world = createWorld(1);
    addRoom(world, buildRoom({ rent: 70 }));
    world.nextId = 2;
    const result = deserialize(serialize(world));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.world.rooms.get(1)?.rent).toBe(70);
  });

  it('loads a save with the rent key deleted at the default rent', () => {
    const world = createWorld(1);
    addRoom(world, buildRoom({ rent: 70 }));
    world.nextId = 2;
    const parsed = JSON.parse(serialize(world));
    delete parsed.rooms[0].rent;
    const result = deserialize(JSON.stringify(parsed));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.world.rooms.get(1)?.rent).toBe(100);
  });

  it('restores shaft stops as a Set of numbers', () => {
    const world = richWorld();
    const result = deserialize(serialize(world));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const shaft = result.world.shafts.get(10);
    expect(shaft?.stops).toBeInstanceOf(Set);
    expect(Array.from(shaft?.stops ?? []).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('restores car calls as a Set and hallCalls as a Map', () => {
    const world = richWorld();
    const result = deserialize(serialize(world));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const shaft = result.world.shafts.get(10);
    expect(shaft?.cars[0]?.calls).toBeInstanceOf(Set);
    expect(shaft?.cars[0]?.calls.has(5)).toBe(true);
    expect(shaft?.hallCalls).toBeInstanceOf(Map);
    expect(shaft?.hallCalls.get(3)).toEqual({ up: new Set(['office']), down: new Set() });
  });

  it('restores sims as a Map keyed by id', () => {
    const world = richWorld();
    const result = deserialize(serialize(world));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.world.sims).toBeInstanceOf(Map);
    expect(result.world.sims.get(20)?.kind).toBe('worker');
  });

  it('caps the restored log at 200 entries even if more are saved', () => {
    const world = richWorld();
    for (let i = 0; i < 300; i++) log(world, `Line ${i}`);
    // world.log itself is capped at 500 by world.ts's log(); force a bigger array to
    // simulate a save file authored by another version with more history.
    const text = serialize(world);
    const data = JSON.parse(text);
    expect(data.log.length).toBeLessThanOrEqual(200);
    const result = deserialize(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.world.log.length).toBeLessThanOrEqual(200);
  });

  it('sets routingDirty true and rebuilds the floor index after loading', () => {
    const world = richWorld();
    const result = deserialize(serialize(world));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.world.routingDirty).toBe(true);
    expect(result.world.floorIndex.builtFloors.has(2)).toBe(true);
    expect(result.world.floorIndex.rooms.get(2)?.some((r) => r.id === 1)).toBe(true);
  });

  it('restores scalar fields exactly', () => {
    const world = richWorld();
    const result = deserialize(serialize(world));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.world.seed).toBe(777);
    expect(result.world.cash).toBe(123456);
    expect(result.world.stars).toBe(3);
    expect(result.world.population).toBe(6);
    expect(result.world.time.minute).toBe(world.time.minute);
  });

  it('restores the rng so future draws continue the original sequence', () => {
    const world = richWorld();
    // Advance the rng a bit before saving, so the saved state is not the initial seed.
    world.rng.next();
    world.rng.next();
    const text = serialize(world);
    // Continue drawing from the original rng: these are the values a fresh load
    // should reproduce.
    const expected = [world.rng.next(), world.rng.next(), world.rng.next()];

    const result = deserialize(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const actual = [result.world.rng.next(), result.world.rng.next(), result.world.rng.next()];
    expect(actual).toEqual(expected);
  });
});

describe('deserialize error handling', () => {
  it('reports a version reason for an unknown newer version', () => {
    const world = richWorld();
    for (const version of [SAVE_VERSION + 1, 6, 99]) {
      const data = JSON.parse(serialize(world));
      data.version = version;
      const result = deserialize(JSON.stringify(data));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('This save is from a different version of the game.');
    }
  });

  it('reports a plain reason for garbage text', () => {
    const result = deserialize('not even json {{{');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('This file is not a Hundred Stories save.');
  });

  it('reports a plain reason for JSON of the wrong shape', () => {
    const result = deserialize(JSON.stringify({ hello: 'world' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('This file is not a Hundred Stories save.');
  });

  it('never throws for null, arrays, or numbers as top level JSON', () => {
    expect(() => deserialize('null')).not.toThrow();
    expect(() => deserialize('[1,2,3]')).not.toThrow();
    expect(() => deserialize('42')).not.toThrow();
    expect(deserialize('null').ok).toBe(false);
    expect(deserialize('[1,2,3]').ok).toBe(false);
    expect(deserialize('42').ok).toBe(false);
  });
});

describe('hashWorld', () => {
  it('is stable across two serializations of the same world', () => {
    const world = richWorld();
    expect(hashWorld(world)).toBe(hashWorld(world));
  });

  it('changes when cash changes', () => {
    const world = richWorld();
    const before = hashWorld(world);
    world.cash += 1;
    const after = hashWorld(world);
    expect(after).not.toBe(before);
  });

  it('is not affected by log contents alone', () => {
    const worldA = richWorld();
    const worldB = richWorld();
    log(worldB, 'An extra unrelated log line.');
    expect(hashWorld(worldA)).toBe(hashWorld(worldB));
  });
});

// A save can be correctly shaped at the top level and still be junk inside. These cases all
// come back refused, with the first field that broke the rules named in the reason.
describe('deserialize deep validation', () => {
  const DAMAGED = 'This save is damaged and was not loaded.';

  /** Serialize a good world, break one thing in the JSON, and return the refusal reason. */
  function reasonFor(breakIt: (data: Record<string, any>) => void): string {
    const data = JSON.parse(serialize(richWorld())) as Record<string, any>;
    breakIt(data);
    const result = deserialize(JSON.stringify(data));
    expect(result.ok).toBe(false);
    return result.ok ? '' : result.reason;
  }

  it('accepts a sound save, so the cases below refuse for the field and not by accident', () => {
    const data = JSON.parse(serialize(richWorld())) as Record<string, any>;
    const result = deserialize(JSON.stringify(data));
    expect(result.ok).toBe(true);
  });

  it('refuses a room with a kind that is not in ROOMS', () => {
    expect(reasonFor((d) => (d.rooms[0].kind = 'sauna'))).toBe(`${DAMAGED} (rooms[0].kind)`);
  });

  it('refuses a room on floor 0, off the top, or on a fractional floor', () => {
    expect(reasonFor((d) => (d.rooms[0].floor = 0))).toBe(`${DAMAGED} (rooms[0].floor)`);
    expect(reasonFor((d) => (d.rooms[0].floor = 101))).toBe(`${DAMAGED} (rooms[0].floor)`);
    expect(reasonFor((d) => (d.rooms[0].floor = -11))).toBe(`${DAMAGED} (rooms[0].floor)`);
    expect(reasonFor((d) => (d.rooms[0].floor = 2.5))).toBe(`${DAMAGED} (rooms[0].floor)`);
  });

  it('refuses a room outside the tower width', () => {
    expect(reasonFor((d) => (d.rooms[0].x = -1))).toBe(`${DAMAGED} (rooms[0].x)`);
    expect(reasonFor((d) => (d.rooms[0].x = 375))).toBe(`${DAMAGED} (rooms[0].x)`);
  });

  it('refuses a room with no width or no height', () => {
    expect(reasonFor((d) => (d.rooms[0].width = 0))).toBe(`${DAMAGED} (rooms[0].width)`);
    expect(reasonFor((d) => (d.rooms[0].height = -2))).toBe(`${DAMAGED} (rooms[0].height)`);
  });

  it('refuses a room evaluation outside 0 to 1', () => {
    expect(reasonFor((d) => (d.rooms[0].eval = 1.5))).toBe(`${DAMAGED} (rooms[0].eval)`);
    expect(reasonFor((d) => (d.rooms[0].eval = -0.1))).toBe(`${DAMAGED} (rooms[0].eval)`);
    expect(reasonFor((d) => (d.rooms[0].eval = 'good'))).toBe(`${DAMAGED} (rooms[0].eval)`);
  });

  it('refuses a shaft with an unknown kind', () => {
    expect(reasonFor((d) => (d.shafts[0].kind = 'dumbwaiter'))).toBe(`${DAMAGED} (shafts[0].kind)`);
  });

  it('refuses a shaft whose span is upside down or fractional', () => {
    expect(reasonFor((d) => (d.shafts[0].floorMin = 20))).toBe(`${DAMAGED} (shafts[0].floorMin)`);
    expect(reasonFor((d) => (d.shafts[0].floorMax = 10.5))).toBe(`${DAMAGED} (shafts[0].floorMax)`);
  });

  it('refuses a stop outside the shaft span', () => {
    expect(reasonFor((d) => d.shafts[0].stops.push(44))).toBe(`${DAMAGED} (shafts[0].stops)`);
  });

  it('refuses a car parked outside the shaft span or with no number at all', () => {
    expect(reasonFor((d) => (d.shafts[0].cars[0].y = 99))).toBe(`${DAMAGED} (shafts[0].cars[0].y)`);
    expect(reasonFor((d) => (d.shafts[0].cars[0].y = null))).toBe(`${DAMAGED} (shafts[0].cars[0].y)`);
  });

  it('refuses a car in a state the sim never produces', () => {
    expect(reasonFor((d) => (d.shafts[0].cars[0].state = 'plummeting'))).toBe(`${DAMAGED} (shafts[0].cars[0].state)`);
  });

  it('refuses junk sims: unknown kind, unknown state, impossible stress, no position', () => {
    expect(reasonFor((d) => (d.sims[0].kind = 'dragon'))).toBe(`${DAMAGED} (sims[0].kind)`);
    expect(reasonFor((d) => (d.sims[0].state = 'dancing'))).toBe(`${DAMAGED} (sims[0].state)`);
    expect(reasonFor((d) => (d.sims[0].stress = 7))).toBe(`${DAMAGED} (sims[0].stress)`);
    expect(reasonFor((d) => (d.sims[0].pos = null))).toBe(`${DAMAGED} (sims[0].pos)`);
    expect(reasonFor((d) => (d.sims[0].pos = { floor: 'up', x: 10 }))).toBe(`${DAMAGED} (sims[0].pos.floor)`);
  });

  it('refuses a negative or fractional minute', () => {
    expect(reasonFor((d) => (d.minute = -1))).toBe(`${DAMAGED} (minute)`);
    expect(reasonFor((d) => (d.minute = 10.5))).toBe(`${DAMAGED} (minute)`);
  });

  it('refuses a star rating off the ladder', () => {
    expect(reasonFor((d) => (d.stars = 7))).toBe(`${DAMAGED} (stars)`);
    expect(reasonFor((d) => (d.stars = 0))).toBe(`${DAMAGED} (stars)`);
  });

  it('refuses nextId that is not past every id, which would hand out an id twice', () => {
    expect(reasonFor((d) => (d.nextId = 11))).toBe(`${DAMAGED} (nextId)`);
  });

  it('refuses ids that are used twice, across rooms, shafts, cars and sims alike', () => {
    expect(reasonFor((d) => (d.rooms[1].id = d.rooms[0].id))).toBe(`${DAMAGED} (rooms[1].id)`);
    expect(reasonFor((d) => (d.sims[0].id = d.shafts[0].cars[0].id))).toBe(`${DAMAGED} (sims[0].id)`);
  });

  it('leaves a sound save loading normally after all that', () => {
    const world = richWorld();
    const result = deserialize(serialize(world));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(hashWorld(result.world)).toBe(hashWorld(world));
  });
});

// The round trip is only as strong as the hash. hashWorld projects every field named in
// types.ts, so a field the serializer drops moves the hash instead of hiding in it.
describe('hashWorld covers every field in types.ts', () => {
  it('keeps every Room, Shaft, Car and Sim key across a round trip', () => {
    const world = richWorld();
    const result = deserialize(serialize(world));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const keys = (value: object): string[] => Object.keys(value).sort();

    const room = world.rooms.get(1) as Room;
    expect(keys(result.world.rooms.get(1) as Room)).toEqual(keys(room));
    const shaft = world.shafts.get(10) as Shaft;
    const loadedShaft = result.world.shafts.get(10) as Shaft;
    expect(keys(loadedShaft)).toEqual(keys(shaft));
    expect(keys(loadedShaft.cars[0] as object)).toEqual(keys(shaft.cars[0] as object));
    const sim = world.sims.get(20) as Sim;
    expect(keys(result.world.sims.get(20) as Sim)).toEqual(keys(sim));
  });

  it('moves when any single Room field moves', () => {
    // An explicit value per key: adding a field to Room fails this line until it is listed,
    // which is the point. id and tenants are covered by the shared checks below.
    const changes = {
      id: (r: Room) => (r.id = 5),
      kind: (r: Room) => (r.kind = 'shop'),
      floor: (r: Room) => (r.floor = 3),
      x: (r: Room) => (r.x = 101),
      width: (r: Room) => (r.width = 11),
      height: (r: Room) => (r.height = 2),
      eval: (r: Room) => (r.eval = 0.5),
      tenants: (r: Room) => r.tenants.push(20),
      occupancy: (r: Room) => (r.occupancy = 3),
      builtAtMinute: (r: Room) => (r.builtAtMinute = 99),
      vacant: (r: Room) => (r.vacant = !r.vacant),
      dirty: (r: Room) => (r.dirty = !r.dirty),
      dirtySinceMinute: (r: Room) => (r.dirtySinceMinute = 42),
      infested: (r: Room) => (r.infested = !r.infested),
      lowEvalSinceMinute: (r: Room) => (r.lowEvalSinceMinute = 7),
      onFire: (r: Room) => (r.onFire = !r.onFire),
      rent: (r: Room) => (r.rent = 110),
      waste: (r: Room) => (r.waste = 4),
      wasteDays: (r: Room) => (r.wasteDays = 1),
      wasteBacklogSince: (r: Room) => (r.wasteBacklogSince = 360),
      wastePeak: (r: Room) => (r.wastePeak = 5),
      wasteCollectedAt: (r: Room) => (r.wasteCollectedAt = 600),
      wasteCollectedToday: (r: Room) => (r.wasteCollectedToday = 7),
      wasteUnreachable: (r: Room) => (r.wasteUnreachable = [7]),
      wasteWorkers: (r: Room) => (r.wasteWorkers = 4),
    } satisfies Record<keyof Room, (room: Room) => unknown>;

    for (const [field, change] of Object.entries(changes)) {
      const world = richWorld();
      const before = hashWorld(world);
      change(world.rooms.get(1) as Room);
      expect(hashWorld(world), `Room.${field} is missing from the hash projection`).not.toBe(before);
    }
  });

  it('moves when any single Car field moves', () => {
    const changes = {
      id: (c: Car) => (c.id = 12),
      shaftId: (c: Car) => (c.shaftId = 13),
      y: (c: Car) => (c.y = 4),
      dir: (c: Car) => (c.dir = 1),
      state: (c: Car) => (c.state = 'moving'),
      doorTimer: (c: Car) => (c.doorTimer = 1),
      idleSince: (c: Car) => (c.idleSince = 99),
      passengers: (c: Car) => c.passengers.push(20),
      calls: (c: Car) => c.calls.add(9),
      serves: (c: Car) => (c.serves = 'hotel'),
      range: (c: Car) => (c.range = { lo: 2, hi: 6 }),
    } satisfies Record<keyof Car, (car: Car) => unknown>;

    for (const [field, change] of Object.entries(changes)) {
      const world = richWorld();
      const before = hashWorld(world);
      change((world.shafts.get(10) as Shaft).cars[0] as Car);
      expect(hashWorld(world), `Car.${field} is missing from the hash projection`).not.toBe(before);
    }
  });

  it('moves when a Sim field the serializer could forget moves', () => {
    const world = richWorld();
    const before = hashWorld(world);
    (world.sims.get(20) as Sim).exiting = true;
    expect(hashWorld(world)).not.toBe(before);
  });
});

describe('status bar baselines (save v3)', () => {
  it('writes the current version and round trips both baselines, set or not yet known', () => {
    expect(SAVE_VERSION).toBe(5);
    const world = richWorld();
    world.quarterStartCash = 100_000;
    world.dayStartPopulation = 42;
    const text = serialize(world);
    expect(JSON.parse(text).version).toBe(5);
    const result = deserialize(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.world.quarterStartCash).toBe(100_000);
    expect(result.world.dayStartPopulation).toBe(42);

    world.quarterStartCash = null;
    world.dayStartPopulation = null;
    const unknown = deserialize(serialize(world));
    expect(unknown.ok && unknown.world.quarterStartCash).toBe(null);
    expect(unknown.ok && unknown.world.dayStartPopulation).toBe(null);
  });

  it('loads a v2 save without the fields, and both baselines are unknown until a boundary', () => {
    const data = JSON.parse(serialize(richWorld()));
    data.version = 2;
    delete data.quarterStartCash;
    delete data.dayStartPopulation;
    const result = deserialize(JSON.stringify(data));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.world.quarterStartCash).toBe(null);
    expect(result.world.dayStartPopulation).toBe(null);
    expect(result.world.cash).toBe(123456);
  });

  it('refuses a v3 save whose baseline is not a number', () => {
    const data = JSON.parse(serialize(richWorld()));
    data.quarterStartCash = 'lots';
    const result = deserialize(JSON.stringify(data));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('(quarterStartCash)');
  });

  it('leaves both baselines out of the hash, and the hash projection at version 2', () => {
    const world = richWorld();
    world.quarterStartCash = 1;
    world.dayStartPopulation = 1;
    const before = hashWorld(world);
    world.quarterStartCash = 999_999;
    world.dayStartPopulation = null;
    expect(hashWorld(world)).toBe(before);
    world.cash += 1; // and the hash still sees real state
    expect(hashWorld(world)).not.toBe(before);
  });
});

// Audit 2026-09-25, lane D S5: a save with the right outer shape but bad insides used to load,
// then hang the tick loop or throw. Each mutation below is one from the verifier's s5.ts, run
// on the same kind of tower (seed 4242, five office floors, about 390 people, day 1 09:00).
describe('damaged insides are refused at load (audit D S5)', () => {
  const DAMAGED = 'This save is damaged and was not loaded.';
  let baseText = '';
  function baseSave(): Record<string, any> {
    if (!baseText) {
      const world = createWorld(4242);
      world.cash = 50_000_000;
      const ok = (c: Command) => {
        const result = applyCommand(world, c);
        if (!result.ok) throw new Error(result.reason);
      };
      for (let x = 0; x < 120; x++) ok({ kind: 'build', room: 'lobby', floor: 1, x });
      ok({ kind: 'shaft.build', shaft: 'standard', x: 20, floorMin: 1, floorMax: 6 });
      for (let f = 2; f <= 6; f++) {
        for (let x = 0; x + ROOMS.office.width <= 120; x += ROOMS.office.width) {
          const blocked = x < 24 && x + ROOMS.office.width > 20;
          if (!blocked) ok({ kind: 'build', room: 'office', floor: f, x });
        }
      }
      while (world.time.minute < 1440 + 9 * 60) tick(world);
      expect(world.sims.size).toBeGreaterThan(200);
      baseText = serialize(world);
    }
    return JSON.parse(baseText) as Record<string, any>;
  }
  function refusal(breakIt: (d: Record<string, any>) => void): string {
    const data = baseSave();
    breakIt(data);
    const result = deserialize(JSON.stringify(data));
    return result.ok ? 'loaded' : result.reason;
  }

  it('loads the base save untouched, so each refusal below is for its field', () => {
    expect(refusal(() => {})).toBe('loaded');
  });

  it('shaftWidth: a shaft with no width (the tick loop hung on it)', () => {
    expect(refusal((d) => delete d.shafts[0].width)).toBe(`${DAMAGED} (shafts[0].width)`);
  });

  it('statsIncomeByKind: stats with one table missing (threw at the quarter start)', () => {
    expect(refusal((d) => delete d.stats.incomeByKind)).toBe(`${DAMAGED} (stats.incomeByKind)`);
  });

  it('statsEmpty: stats with nothing in them', () => {
    expect(refusal((d) => (d.stats = {}))).toBe(`${DAMAGED} (stats.incomeByKind)`);
  });

  it('tenants: a room with no tenant list (threw at the evaluation)', () => {
    const d = baseSave();
    const last = d.rooms.length - 1;
    expect(refusal((data) => delete data.rooms[last].tenants)).toBe(`${DAMAGED} (rooms[${last}].tenants)`);
  });

  it('schedule: a person with no schedule (threw in the people pass)', () => {
    expect(refusal((d) => delete d.sims[0].schedule)).toBe(`${DAMAGED} (sims[0].schedule)`);
  });

  it('route: a person with no route (threw in the people pass)', () => {
    expect(refusal((d) => delete d.sims[0].route)).toBe(`${DAMAGED} (sims[0].route)`);
  });

  it('roomHeightBig: a room a billion floors tall is refused fast, for its height', () => {
    const d = baseSave();
    d.rooms[0].height = 1e9;
    const text = JSON.stringify(d);
    const started = performance.now();
    const result = deserialize(text);
    const took = performance.now() - started;
    expect(result.ok ? 'loaded' : result.reason).toBe(`${DAMAGED} (rooms[0].height)`);
    expect(took).toBeLessThan(250);
  });

  it('refuses a room wider than the lot', () => {
    expect(refusal((d) => (d.rooms[0].width = 1e9))).toBe(`${DAMAGED} (rooms[0].width)`);
  });

  it('refuses a leg or a schedule entry that is junk, and a guard or collector with no task', () => {
    expect(refusal((d) => (d.sims[0].route = [{ kind: 'fly' }]))).toBe(`${DAMAGED} (sims[0].route)`);
    expect(refusal((d) => (d.sims[0].schedule = [{ minuteOfDay: 'noon' }]))).toBe(`${DAMAGED} (sims[0].schedule)`);
    expect(refusal((d) => (d.sims[0].guard = { shift: 0 }))).toBe(`${DAMAGED} (sims[0].guard)`);
    expect(refusal((d) => (d.sims[0].collector = { load: 1 }))).toBe(`${DAMAGED} (sims[0].collector)`);
  });

  it('refuses an event of an unknown kind or with its numbers missing', () => {
    expect(refusal((d) => d.events.push({ kind: 'meteor' }))).toBe(`${DAMAGED} (events[0])`);
    expect(refusal((d) => d.events.push({ kind: 'fire', roomIds: [], startedAt: 0 }))).toBe(`${DAMAGED} (events[0])`);
  });
});

// Audit 2026-09-25, lane I S6: the hash sorts rooms by id, so a save with its rooms array
// reordered hashed equal at load and then diverged. deserialize now puts rooms in id order.
describe('room order, guards, collectors and fire events (audit I S6)', () => {
  function officeTower(): World {
    const world = createWorld(12345);
    world.cash = 50_000_000;
    const script: Command[] = [];
    for (let x = 0; x <= 60; x++) script.push({ kind: 'build', room: 'lobby', floor: 1, x });
    script.push({ kind: 'shaft.build', shaft: 'standard', x: 56, floorMin: 1, floorMax: 10 });
    for (let f = 2; f <= 8; f++) for (let i = 0; i < 6; i++) script.push({ kind: 'build', room: 'office', floor: f, x: i * 9 });
    for (let i = 0; i < 3; i++) script.push({ kind: 'build', room: 'fastFood', floor: 9, x: i * 16 });
    for (let i = 0; i < 3; i++) script.push({ kind: 'build', room: 'condo', floor: 10, x: i * 16 });
    for (const cmd of script) {
      const result = applyCommand(world, cmd);
      if (!result.ok) throw new Error(`${JSON.stringify(cmd)}: ${result.reason}`);
    }
    return world;
  }

  it('a save with the rooms array reversed runs the same as the tower it came from for 2 days', () => {
    const world = officeTower();
    while (world.time.minute < 1440 + 12 * 60 + 30) tick(world);
    const data = JSON.parse(serialize(world)) as Record<string, any>;
    data.rooms.reverse();
    const loaded = deserialize(JSON.stringify(data));
    if (!loaded.ok) throw new Error(loaded.reason);
    const reversed = loaded.world;
    expect(hashWorld(reversed)).toBe(hashWorld(world));
    for (let i = 0; i < 2 * 1440; i++) {
      tick(world);
      tick(reversed);
    }
    expect(hashWorld(reversed)).toBe(hashWorld(world));
  }, 60_000); // two days of a ten-floor tower: about 1 s alone, 17 to 42 s on a busy test host

  it("keeps a guard's state and a collector's round across serialize and deserialize", () => {
    const world = richWorld();
    const guard: GuardState = { shift: 1, task: 'respond', floor: 2, pauseUntil: null, respond: { kind: 'fire', roomId: 1, floor: 2, x: 105 }, routed: true };
    const collector: CollectorState = { task: 'toCenter', roomId: 1, load: 3, until: null };
    addSim(world, buildSim({ id: 21, kind: 'guard', homeRoomId: null, guard }));
    addSim(world, buildSim({ id: 22, kind: 'collector', homeRoomId: null, collector }));
    world.nextId = 23;
    const result = deserialize(serialize(world));
    if (!result.ok) throw new Error(result.reason);
    expect(result.world.sims.get(21)?.guard).toEqual(guard);
    expect(result.world.sims.get(22)?.collector).toEqual(collector);
    expect(hashWorld(result.world)).toBe(hashWorld(world));
  });

  it('moves the hash when a fire event is removed from the world', () => {
    const world = richWorld();
    world.events.push({ kind: 'fire', roomIds: [1], startedAt: 500, spreadAt: 530 });
    const withFire = hashWorld(world);
    world.events = world.events.filter((e) => e.kind !== 'fire');
    expect(hashWorld(world)).not.toBe(withFire);
  });
});

// Audit 2026-09-25, lane A S6 (the save validator half): a car range may not start or end on
// floor 0, which does not exist, and must span two real floors.
describe('car range on a shaft through the ground floor (audit A S6)', () => {
  function withRange(range: { lo: number; hi: number }): string {
    const data = JSON.parse(serialize(richWorld())) as Record<string, any>;
    data.shafts[0].floorMin = -1;
    data.shafts[0].cars[0].range = range;
    const result = deserialize(JSON.stringify(data));
    return result.ok ? 'loaded' : result.reason;
  }

  it('refuses {lo 0, hi 1} and a one-floor range, and accepts {lo -1, hi 1}', () => {
    expect(withRange({ lo: 0, hi: 1 })).toBe('This save is damaged and was not loaded. (shafts[0].cars[0].range)');
    expect(withRange({ lo: -1, hi: 0 })).toBe('This save is damaged and was not loaded. (shafts[0].cars[0].range)');
    expect(withRange({ lo: 2, hi: 2 })).toBe('This save is damaged and was not loaded. (shafts[0].cars[0].range)');
    expect(withRange({ lo: -1, hi: 1 })).toBe('loaded');
  });
});
