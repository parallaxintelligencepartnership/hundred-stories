import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ECONOMY, ROOMS, SCHEDULES, STRESS } from '../../src/sim/rules';
import type { Car, Id, Leg, Room, RoomKind, Shaft, Sim, World } from '../../src/sim/types';
import { addRoom, addShaft, addSim, allocId, createWorld } from '../../src/sim/world';

const mocks = vi.hoisted(() => ({
  ensureRouting: vi.fn(),
  findRoute: vi.fn(),
  isReachableFromLobby: vi.fn(),
  entrances: vi.fn(),
  requestHallCall: vi.fn(),
  hallCallPending: vi.fn(),
  tickElevators: vi.fn(),
  spend: vi.fn(),
  onQuarterStart: vi.fn(),
  recordVisit: vi.fn(),
  recordHotelNight: vi.fn(),
  recordCondoSale: vi.fn(),
}));

vi.mock('../../src/sim/routing', () => ({
  ensureRouting: mocks.ensureRouting,
  findRoute: mocks.findRoute,
  isReachableFromLobby: mocks.isReachableFromLobby,
  entrances: mocks.entrances,
}));

vi.mock('../../src/sim/elevators', () => ({
  IDLE_RETURN_MINUTES: 10,
  requestHallCall: mocks.requestHallCall,
  tickElevators: mocks.tickElevators,
  hallCallPending: mocks.hallCallPending,
}));

vi.mock('../../src/sim/economy', () => ({
  spend: mocks.spend,
  onQuarterStart: mocks.onQuarterStart,
  recordVisit: mocks.recordVisit,
  recordHotelNight: mocks.recordHotelNight,
  recordCondoSale: mocks.recordCondoSale,
}));

import { stressBand, tickPeople, WALK_TILES_PER_MINUTE } from '../../src/sim/people';

const ENTRANCE = { floor: 1, x: 100 };
const SHAFT_X = 150;
/** Walks the fixtures below ask for: entrance to office, to hotel room, office to hotel room. */
const OFFICE_WALK = 104;
const HOTEL_WALK = 102;
const KEEPER_WALK = 105;
/** HALL_CALL_RETRY_MINUTES times RETRIES_BEFORE_REROUTE in people.ts: both are minutes, not distances. */
const SILENT_RETRY_MINUTES = 18;
/** How far apart the first and last worker of an office arrive. */
const ARRIVAL_SPREAD = SCHEDULES.worker.arriveEnd - SCHEDULES.worker.arriveStart;

type Point = { floor: number; x: number };

/** Every trip is one walk leg: lets tests watch arrivals without an elevator. */
function walkOnlyRoutes(): void {
  mocks.findRoute.mockImplementation((_w: World, _from: Point, to: Point): Leg[] => [{ kind: 'walk', toX: to.x }]);
}

/** Trips that change floor go through the shaft, so sims end up waiting. */
function shaftRoutes(shaftId: Id): void {
  mocks.findRoute.mockImplementation((_w: World, from: Point, to: Point): Leg[] => {
    if (from.floor === to.floor) return [{ kind: 'walk', toX: to.x }];
    return [
      { kind: 'walk', toX: SHAFT_X },
      { kind: 'ride', shaftId, fromFloor: from.floor, toFloor: to.floor },
      { kind: 'walk', toX: to.x },
    ];
  });
}

function makeRoom(world: World, kind: RoomKind, floor: number, x: number, over: Partial<Room> = {}): Room {
  const rule = ROOMS[kind];
  const room: Room = {
    id: allocId(world),
    kind,
    floor,
    x,
    width: rule.width,
    height: rule.height,
    eval: 0.8,
    tenants: [],
    occupancy: 0,
    builtAtMinute: world.time.minute,
    vacant: kind === 'office' || kind === 'condo',
    dirty: false,
    infested: false,
    lowEvalSinceMinute: null,
    onFire: false,
    rent: 100,
    ...over,
  };
  addRoom(world, room);
  return room;
}

function makeShaft(world: World, floorMin = 1, floorMax = 10): Shaft {
  const id = allocId(world);
  const car: Car = { id: allocId(world), shaftId: id, y: 1, dir: 0, state: 'idle', doorTimer: 0, idleSince: null, passengers: [], calls: new Set(), serves: 'any', range: null };
  const stops = new Set<number>();
  for (let f = floorMin; f <= floorMax; f++) stops.add(f);
  const shaft: Shaft = { id, kind: 'standard', x: SHAFT_X, width: 4, floorMin, floorMax, stops, homeFloor: 1, cars: [car], hallCalls: new Map() };
  addShaft(world, shaft);
  return shaft;
}

function makeSim(world: World, over: Partial<Sim> = {}): Sim {
  const sim: Sim = {
    id: allocId(world),
    kind: 'worker',
    homeRoomId: null,
    pos: { floor: 1, x: ENTRANCE.x },
    inCarId: null,
    inRoomId: null,
    route: [],
    state: 'walking',
    stress: 0,
    waitStart: null,
    schedule: [],
    nextScheduleIndex: 0,
    stayUntil: null,
    wallet: 0,
    leaveReason: null,
    ...over,
  };
  addSim(world, sim);
  return sim;
}

/** Day 0 and 1 are weekdays, day 2 is the weekend. */
function setTime(world: World, day: number, minuteOfDay: number): void {
  world.time.minute = day * 1440 + minuteOfDay;
}

function run(world: World, minutes: number): void {
  for (let i = 0; i < minutes; i++) {
    tickPeople(world);
    world.time.minute += 1;
  }
}

/**
 * Minutes a walk of this many tiles needs at the current speed, plus slack for the
 * leg handoffs at each end. Tick budgets derive from this so a speed retune in
 * people.ts cannot silently turn a timing into a fixed number of ticks.
 */
function walkMinutes(tiles: number, slack = 3): number {
  return Math.ceil(Math.abs(tiles) / WALK_TILES_PER_MINUTE) + slack;
}

/** Minutes from now to that minute of day, today when it is still ahead. */
function minutesUntil(world: World, minuteOfDay: number): number {
  const now = world.time.minute % 1440;
  return minuteOfDay >= now ? minuteOfDay - now : 1440 - now + minuteOfDay;
}

function simsOfKind(world: World, kind: Sim['kind']): Sim[] {
  return [...world.sims.values()].filter((s) => s.kind === kind);
}

function makeTower(seed = 7): World {
  const world = createWorld(seed);
  for (let x = 100; x < 140; x++) makeRoom(world, 'lobby', 1, x);
  return world;
}

function snapshot(world: World): string {
  const sims = [...world.sims.values()].map((s) => ({
    id: s.id, kind: s.kind, state: s.state, pos: s.pos, stress: Math.round(s.stress * 1000),
    inRoomId: s.inRoomId, stayUntil: s.stayUntil, idx: s.nextScheduleIndex, reason: s.leaveReason,
  }));
  const rooms = [...world.rooms.values()].map((r) => ({ id: r.id, occ: r.occupancy, dirty: r.dirty, vacant: r.vacant, tenants: r.tenants }));
  return JSON.stringify({ sims, rooms, rng: world.rng.state(), logs: world.log.length });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isReachableFromLobby.mockReturnValue(true);
  mocks.entrances.mockReturnValue([ENTRANCE]);
  walkOnlyRoutes();
});

describe('stressBand', () => {
  it('calls a fresh sim calm', () => {
    expect(stressBand(0)).toBe('calm');
    expect(stressBand(STRESS.pink - 0.01)).toBe('calm');
  });

  it('turns pink at the pink threshold', () => {
    expect(stressBand(STRESS.pink)).toBe('pink');
    expect(stressBand(STRESS.red - 0.01)).toBe('pink');
  });

  it('turns red at the red threshold and stays red at the give up point', () => {
    expect(stressBand(STRESS.red)).toBe('red');
    expect(stressBand(STRESS.giveUp)).toBe('red');
  });
});

describe('office intake', () => {
  it('fills a reachable office with six workers on a weekday morning', () => {
    const world = makeTower();
    const office = makeRoom(world, 'office', 2, 200);
    setTime(world, 0, SCHEDULES.worker.arriveStart);

    tickPeople(world);

    expect(office.tenants).toHaveLength(ROOMS.office.capacity);
    expect(office.vacant).toBe(false);
    expect(simsOfKind(world, 'worker')).toHaveLength(6);
  });

  it('leaves an unreachable office vacant', () => {
    const world = makeTower();
    const office = makeRoom(world, 'office', 2, 200);
    mocks.isReachableFromLobby.mockReturnValue(false);
    setTime(world, 0, SCHEDULES.worker.arriveStart);

    run(world, 60);

    expect(office.tenants).toHaveLength(0);
    expect(office.vacant).toBe(true);
    expect(world.sims.size).toBe(0);
  });

  it('does not lease an office on the weekend', () => {
    const world = makeTower();
    const office = makeRoom(world, 'office', 2, 200);
    setTime(world, 2, SCHEDULES.worker.arriveStart);

    run(world, 60);

    expect(office.vacant).toBe(true);
  });

  it('walks its workers in to the office by mid morning', () => {
    const world = makeTower();
    const office = makeRoom(world, 'office', 2, 200);
    setTime(world, 0, SCHEDULES.worker.arriveStart);

    run(world, ARRIVAL_SPREAD + walkMinutes(OFFICE_WALK));

    expect(office.occupancy).toBe(6);
    expect(simsOfKind(world, 'worker').every((s) => s.state === 'inRoom' && s.inRoomId === office.id)).toBe(true);
  });

  it('sends workers home in the evening and brings them back the next morning', () => {
    const world = makeTower();
    const office = makeRoom(world, 'office', 2, 200);
    setTime(world, 0, SCHEDULES.worker.arriveStart);
    run(world, ARRIVAL_SPREAD + walkMinutes(OFFICE_WALK));

    // Past the last leaving time, plus the walk out, and on into the small hours.
    run(world, SCHEDULES.worker.leaveEnd - SCHEDULES.worker.arriveEnd + walkMinutes(OFFICE_WALK) + 5 * 60);
    expect(simsOfKind(world, 'worker').every((s) => s.state === 'outside')).toBe(true);
    expect(office.occupancy).toBe(0);

    // On to the next weekday's last arrival, plus the walk in.
    run(world, minutesUntil(world, SCHEDULES.worker.arriveEnd) + walkMinutes(OFFICE_WALK));
    expect(office.occupancy).toBe(6);
    expect(simsOfKind(world, 'worker')).toHaveLength(6);
  });
});

describe('condo intake', () => {
  it('sells a condo that evaluates well and moves three residents in', () => {
    const world = makeTower();
    const condo = makeRoom(world, 'condo', 2, 200, { eval: ECONOMY.condoSaleEvalMin + 0.1 });
    setTime(world, 0, SCHEDULES.resident.leaveStart);

    tickPeople(world);

    expect(mocks.recordCondoSale).toHaveBeenCalledTimes(1);
    expect(mocks.recordCondoSale).toHaveBeenCalledWith(world, condo);
    expect(condo.tenants).toHaveLength(ROOMS.condo.capacity);
    expect(condo.occupancy).toBe(3);
  });

  it('holds a condo that evaluates below the sale threshold', () => {
    const world = makeTower();
    const condo = makeRoom(world, 'condo', 2, 200, { eval: ECONOMY.condoSaleEvalMin - 0.1 });
    setTime(world, 0, SCHEDULES.resident.leaveStart);

    run(world, 60);

    expect(mocks.recordCondoSale).not.toHaveBeenCalled();
    expect(condo.vacant).toBe(true);
    expect(condo.tenants).toHaveLength(0);
  });
});

describe('hotel guests', () => {
  it('checks a guest in during the evening', () => {
    const world = makeTower(7); // this seed books the room on the first roll
    const room = makeRoom(world, 'hotelSingle', 2, 200);
    setTime(world, 0, SCHEDULES.guest.checkInStart);

    run(world, SCHEDULES.guest.checkInEnd - SCHEDULES.guest.checkInStart + walkMinutes(HOTEL_WALK));

    expect(room.tenants).toHaveLength(1);
    expect(room.occupancy).toBe(1);
    expect(simsOfKind(world, 'guest')[0]?.state).toBe('inRoom');
  });

  it('checks the guest out in the morning, dirties the room and books the night', () => {
    const world = makeTower(7);
    const room = makeRoom(world, 'hotelSingle', 2, 200);
    setTime(world, 0, SCHEDULES.guest.checkInStart);

    run(world, 18 * 60); // evening through to 11:00 the next day

    expect(mocks.recordHotelNight).toHaveBeenCalledTimes(1);
    expect(mocks.recordHotelNight).toHaveBeenCalledWith(world, room);
    expect(room.dirty).toBe(true);
    expect(room.tenants).toHaveLength(0);
    expect(room.occupancy).toBe(0);
    expect(simsOfKind(world, 'guest')).toHaveLength(0);
  });

  it('leaves a dirty room empty overnight', () => {
    const world = makeTower(7);
    const room = makeRoom(world, 'hotelSingle', 2, 200, { dirty: true });
    setTime(world, 0, SCHEDULES.guest.checkInStart);

    run(world, 5 * 60);

    expect(room.tenants).toHaveLength(0);
    expect(simsOfKind(world, 'guest')).toHaveLength(0);
  });
});

describe('housekeeping', () => {
  it('sends a keeper to clean a dirty hotel room with a staff route', () => {
    const world = makeTower();
    const office = makeRoom(world, 'housekeeping', 1, 300);
    const room = makeRoom(world, 'hotelSingle', 2, 200, { dirty: true });
    setTime(world, 0, SCHEDULES.housekeeping.start);

    tickPeople(world);
    expect(office.tenants).toHaveLength(ROOMS.housekeeping.capacity);
    expect(mocks.findRoute).toHaveBeenCalledWith(world, expect.anything(), expect.anything(), {
      staff: true,
      riderClass: 'other',
    });

    run(world, walkMinutes(KEEPER_WALK) + SCHEDULES.housekeeping.minutesPerRoom + 5);

    expect(room.dirty).toBe(false);
  });

  it('keeps keepers in the office when nothing is dirty', () => {
    const world = makeTower();
    const office = makeRoom(world, 'housekeeping', 1, 300);
    makeRoom(world, 'hotelSingle', 2, 200);
    setTime(world, 0, SCHEDULES.housekeeping.start);

    run(world, 30);

    expect(simsOfKind(world, 'staff').every((s) => s.inRoomId === office.id)).toBe(true);
  });

  it('stamps dirtySinceMinute on checkout and clears it on cleaning', () => {
    const world = makeTower(7);
    const room = makeRoom(world, 'hotelSingle', 2, 200);
    setTime(world, 0, SCHEDULES.guest.checkInStart);

    // Check the guest in the evening, then step minute by minute through
    // checkout so we know exactly which minute dirtySinceMinute should record.
    // No housekeeping office exists yet, so nothing cleans the room out from
    // under us while we watch for the checkout minute.
    run(world, 5 * 60 + 30);
    expect(room.tenants).toHaveLength(1);

    let checkoutMinute: number | null = null;
    for (let i = 0; i < 18 * 60; i++) {
      tickPeople(world);
      if (room.dirty && checkoutMinute === null) checkoutMinute = world.time.minute;
      world.time.minute += 1;
    }

    expect(checkoutMinute).not.toBeNull();
    expect(room.dirtySinceMinute).toBe(checkoutMinute);

    // Now bring housekeeping online; cleaning clears dirtySinceMinute alongside dirty.
    makeRoom(world, 'housekeeping', 1, 300);
    setTime(world, 2, SCHEDULES.housekeeping.start);
    run(world, SCHEDULES.housekeeping.minutesPerRoom + 60);

    expect(room.dirty).toBe(false);
    expect(room.dirtySinceMinute).toBeNull();
  });
});

describe('commerce crowds', () => {
  it('spawns shoppers during opening hours and records the visit', () => {
    const world = makeTower();
    const shop = makeRoom(world, 'shop', 1, 110);
    setTime(world, 0, SCHEDULES.shopper.open);

    run(world, 120);

    expect(simsOfKind(world, 'shopper').length).toBeGreaterThan(0);
    expect(shop.occupancy).toBeGreaterThan(0);
    expect(mocks.recordVisit).toHaveBeenCalledWith(world, shop);
  });

  it('spawns nobody after the shops close', () => {
    const world = makeTower();
    makeRoom(world, 'shop', 1, 110);
    setTime(world, 0, SCHEDULES.shopper.close);

    run(world, 120);

    expect(simsOfKind(world, 'shopper')).toHaveLength(0);
  });

  it('draws a bigger crowd on the weekend than on a weekday', () => {
    const weekday = makeTower(21);
    makeRoom(weekday, 'shop', 1, 110);
    setTime(weekday, 0, SCHEDULES.shopper.open);
    run(weekday, 240);

    const weekend = makeTower(21);
    makeRoom(weekend, 'shop', 1, 110);
    setTime(weekend, 2, SCHEDULES.shopper.open);
    run(weekend, 240);

    expect(simsOfKind(weekend, 'shopper').length).toBeGreaterThan(simsOfKind(weekday, 'shopper').length);
  });

  it('fills a cinema at show time and empties it after the film', () => {
    const world = makeTower();
    const cinema = makeRoom(world, 'cinema', 1, 110);
    setTime(world, 0, SCHEDULES.cinema.showTimes[0] ?? 13 * 60);

    run(world, 30);
    const audience = cinema.occupancy;
    expect(audience).toBeGreaterThan(0);

    run(world, SCHEDULES.cinema.showMinutes + 30);
    expect(cinema.occupancy).toBe(0);
  });
});

describe('movement', () => {
  it('walks WALK_TILES_PER_MINUTE tiles a minute', () => {
    const world = makeTower();
    const sim = makeSim(world, { pos: { floor: 1, x: 100 }, route: [{ kind: 'walk', toX: 300 }] });

    tickPeople(world);

    expect(sim.pos.x).toBe(100 + WALK_TILES_PER_MINUTE);
  });

  it('charges stress per floor for a stairs leg', () => {
    const world = makeTower();
    const stairs = makeRoom(world, 'stairs', 1, 120);
    const sim = makeSim(world, {
      pos: { floor: 1, x: 120 },
      route: [
        { kind: 'stairs', roomId: stairs.id, toFloor: 2 },
        { kind: 'walk', toX: 200 },
      ],
    });

    tickPeople(world);

    expect(sim.pos.floor).toBe(2);
    expect(sim.stress).toBeCloseTo(STRESS.perStairFloor, 6);
  });

  it('calls no car until the sim reaches the shaft doors, then calls once', () => {
    const world = makeTower();
    const shaft = makeShaft(world);
    shaftRoutes(shaft.id);
    const sim = makeSim(world, {
      pos: { floor: 1, x: SHAFT_X - 10 },
      route: [{ kind: 'ride', shaftId: shaft.id, fromFloor: 1, toFloor: 5 }],
    });

    // A car sent to a sim standing ten tiles off would open on an empty floor and close again.
    let guard = 0;
    while (sim.state !== 'waiting' && guard < walkMinutes(10) + 2) {
      expect(mocks.requestHallCall).not.toHaveBeenCalled();
      tickPeople(world);
      world.time.minute += 1;
      guard += 1;
    }

    expect(sim.state).toBe('waiting');
    expect(sim.pos.x).toBe(SHAFT_X);
    expect(guard).toBe(walkMinutes(10, 0)); // it walked the ten tiles, it did not jump them
    expect(Math.abs(sim.pos.x - shaft.x)).toBeLessThanOrEqual(shaft.width + 1);
    expect(mocks.requestHallCall).toHaveBeenCalledTimes(1);
    expect(mocks.requestHallCall).toHaveBeenCalledWith(world, shaft.id, 1, 1, 'office');
  });

  it('drops a ride leg that goes nowhere instead of calling a car', () => {
    const world = makeTower();
    const shaft = makeShaft(world);
    const shop = makeRoom(world, 'shop', 1, 160);
    const sim = makeSim(world, {
      pos: { floor: 1, x: SHAFT_X },
      route: [
        { kind: 'ride', shaftId: shaft.id, fromFloor: 1, toFloor: 1 },
        { kind: 'walk', toX: 166 },
        { kind: 'enter', roomId: shop.id },
      ],
    });

    run(world, walkMinutes(166 - SHAFT_X));

    expect(mocks.requestHallCall).not.toHaveBeenCalled();
    expect(sim.inRoomId).toBe(shop.id);
  });

  it('asks routing again when three retries bring no car', () => {
    const world = makeTower();
    const shaft = makeShaft(world);
    shaftRoutes(shaft.id);
    const sim = makeSim(world, {
      pos: { floor: 1, x: SHAFT_X },
      route: [{ kind: 'ride', shaftId: shaft.id, fromFloor: 1, toFloor: 5 }],
    });

    run(world, 2);
    expect(sim.state).toBe('waiting');
    mocks.findRoute.mockClear();

    run(world, SILENT_RETRY_MINUTES);

    expect(mocks.findRoute).toHaveBeenCalled();
    expect(sim.state).toBe('waiting'); // routing offered the same shaft, so it waits again
  });

  it('requests one hall call when it reaches a ride leg', () => {
    const world = makeTower();
    const shaft = makeShaft(world);
    shaftRoutes(shaft.id);
    const sim = makeSim(world, {
      pos: { floor: 1, x: 130 },
      route: [
        { kind: 'walk', toX: SHAFT_X },
        { kind: 'ride', shaftId: shaft.id, fromFloor: 1, toFloor: 5 },
        { kind: 'walk', toX: 200 },
      ],
    });

    // Short slack on purpose: the waiting stretch has to stay inside the hall call
    // retry window, otherwise a second call is expected and this test asserts one.
    run(world, walkMinutes(SHAFT_X - 130, 2));

    expect(sim.state).toBe('waiting');
    expect(sim.pos.x).toBe(SHAFT_X);
    expect(mocks.requestHallCall).toHaveBeenCalledTimes(1);
    expect(mocks.requestHallCall).toHaveBeenCalledWith(world, shaft.id, 1, 1, 'office');
  });
});

describe('stress', () => {
  it('rises while a sim waits for a car', () => {
    const world = makeTower();
    const shaft = makeShaft(world);
    shaftRoutes(shaft.id); // a reroute after the silent retries puts it back at the doors
    const sim = makeSim(world, {
      pos: { floor: 1, x: SHAFT_X },
      route: [{ kind: 'ride', shaftId: shaft.id, fromFloor: 1, toFloor: 5 }],
    });

    run(world, 10);

    expect(sim.state).toBe('waiting');
    expect(sim.stress).toBeCloseTo(STRESS.perWaitingMinute * 10, 6);
    expect(stressBand(sim.stress)).toBe('calm');

    run(world, 10);
    expect(stressBand(sim.stress)).toBe('pink');
  });

  it('decays while a sim sits in a room', () => {
    const world = makeTower();
    const office = makeRoom(world, 'office', 1, 110, { vacant: false, occupancy: 1 });
    const sim = makeSim(world, { state: 'inRoom', inRoomId: office.id, stress: 0.5, pos: { floor: 1, x: 112 } });

    run(world, 10);

    expect(sim.stress).toBeCloseTo(0.5 - STRESS.decayPerMinuteInRoom * 10, 6);
  });

  it('gives up at the give up threshold with a reason naming the floor, then leaves', () => {
    const world = makeTower();
    const shaft = makeShaft(world);
    // This sim holds no lease, so giving up takes it out of the tower for good.
    const sim = makeSim(world, {
      pos: { floor: 3, x: SHAFT_X },
      stress: STRESS.giveUp - STRESS.perWaitingMinute,
      route: [{ kind: 'ride', shaftId: shaft.id, fromFloor: 3, toFloor: 10 }],
    });
    const id = sim.id;

    run(world, 1);
    expect(sim.state).toBe('leaving');
    expect(sim.leaveReason).toBe('Gave up waiting for an elevator on floor 3.');
    expect(sim.leaveReason).toContain('floor 3');

    run(world, walkMinutes(SHAFT_X - ENTRANCE.x));
    expect(world.sims.has(id)).toBe(false);
  });
});

describe('leaving', () => {
  it('sends a tenant who gives up home for the day and keeps the lease', () => {
    const world = makeTower();
    const shaft = makeShaft(world);
    shaftRoutes(shaft.id);
    const office = makeRoom(world, 'office', 5, 200, { vacant: false });
    const sim = makeSim(world, {
      kind: 'worker',
      homeRoomId: office.id,
      pos: { floor: 1, x: SHAFT_X },
      stress: STRESS.giveUp - STRESS.perWaitingMinute,
      route: [{ kind: 'ride', shaftId: shaft.id, fromFloor: 1, toFloor: 5 }],
      schedule: [
        { minuteOfDay: SCHEDULES.worker.arriveStart, days: ['weekday'], goal: { kind: 'room', roomId: office.id }, stayMinutes: 0 },
        { minuteOfDay: SCHEDULES.worker.leaveStart, days: ['weekday'], goal: { kind: 'exit' }, stayMinutes: 0 },
      ],
      nextScheduleIndex: 1,
    });
    office.tenants.push(sim.id);
    setTime(world, 0, SCHEDULES.worker.arriveStart + 30);

    run(world, 1);
    expect(sim.leaveReason).toBe('Gave up waiting for an elevator on floor 1 and went home.');
    expect(world.log.some((entry) => entry.text.endsWith('and went home.'))).toBe(true);

    run(world, walkMinutes(SHAFT_X - ENTRANCE.x));
    expect(sim.state).toBe('outside');
    expect(world.sims.has(sim.id)).toBe(true);
    expect(sim.homeRoomId).toBe(office.id);
    expect(office.tenants).toContain(sim.id);
    expect(office.vacant).toBe(false);
    expect(sim.stress).toBe(STRESS.giveUp); // the day's stress stands while it sits outside

    // Tomorrow it tries again, and the elevator it needs is working this time.
    walkOnlyRoutes();
    run(world, minutesUntil(world, SCHEDULES.worker.arriveStart) + walkMinutes(OFFICE_WALK));

    expect(sim.state).toBe('inRoom');
    expect(sim.inRoomId).toBe(office.id);
    expect(sim.leaveReason).toBeNull();
    expect(sim.stress).toBeLessThan(STRESS.pink);
  });

  it('logs a tenant give up once and waits for the ride home', () => {
    const world = makeTower();
    const shaft = makeShaft(world);
    shaftRoutes(shaft.id);
    const office = makeRoom(world, 'office', 5, 200, { vacant: false });
    const sim = makeSim(world, {
      kind: 'worker',
      homeRoomId: office.id,
      pos: { floor: 5, x: SHAFT_X },
      stress: STRESS.giveUp - STRESS.perWaitingMinute,
      route: [{ kind: 'ride', shaftId: shaft.id, fromFloor: 5, toFloor: 8 }],
    });
    office.tenants.push(sim.id);

    run(world, 1);
    expect(sim.leaveReason).toContain('went home');
    mocks.findRoute.mockClear();

    // The way home needs a car too. Giving up again here would clear that route every
    // minute and buy a new one on the next, which is a route per sim per tick.
    run(world, SILENT_RETRY_MINUTES - 1);

    expect(world.log.filter((entry) => entry.text.startsWith('Gave up'))).toHaveLength(1);
    expect(sim.state).toBe('waiting');
    expect(mocks.findRoute).not.toHaveBeenCalled();
  });

  it('removes a visitor who gives up', () => {
    const world = makeTower();
    const shaft = makeShaft(world);
    const sim = makeSim(world, {
      kind: 'shopper',
      pos: { floor: 3, x: SHAFT_X },
      stress: STRESS.giveUp - STRESS.perWaitingMinute,
      route: [{ kind: 'ride', shaftId: shaft.id, fromFloor: 3, toFloor: 10 }],
    });
    const id = sim.id;

    run(world, 1);
    expect(sim.state).toBe('leaving');
    expect(sim.leaveReason).toBe('Gave up waiting for an elevator on floor 3.');

    run(world, walkMinutes(SHAFT_X - ENTRANCE.x));
    expect(world.sims.has(id)).toBe(false);
  });

  it('does not give up a second time while waiting for the ride out', () => {
    const world = makeTower();
    const shaft = makeShaft(world);
    shaftRoutes(shaft.id);
    const sim = makeSim(world, {
      pos: { floor: 3, x: SHAFT_X },
      stress: STRESS.giveUp - STRESS.perWaitingMinute,
      route: [{ kind: 'ride', shaftId: shaft.id, fromFloor: 3, toFloor: 10 }],
    });

    run(world, 1);
    expect(sim.state).toBe('leaving');
    expect(sim.exiting).toBe(true);

    run(world, 1); // routed to the doors, now waiting for the car out
    expect(sim.state).toBe('waiting');
    mocks.findRoute.mockClear();

    // Giving up again here would clear the exit route every minute and ask routing
    // for a new one on the next, which costs a route per sim per tick forever.
    run(world, SILENT_RETRY_MINUTES - 1);

    expect(sim.state).toBe('waiting');
    expect(sim.stress).toBe(STRESS.giveUp);
    expect(mocks.findRoute).not.toHaveBeenCalled();
  });

  it('walks a leaving tenant to the entrance, removes it and frees the room', () => {
    const world = makeTower();
    const office = makeRoom(world, 'office', 1, 200, { vacant: false, occupancy: 1 });
    const sim = makeSim(world, {
      kind: 'worker',
      homeRoomId: office.id,
      state: 'leaving',
      inRoomId: office.id,
      pos: { floor: 1, x: 204 },
      leaveReason: 'Too noisy next to the fast food on floor 1.',
    });
    office.tenants.push(sim.id);
    const id = sim.id;

    run(world, walkMinutes(204 - ENTRANCE.x));

    expect(world.sims.has(id)).toBe(false);
    expect(office.occupancy).toBe(0);
    expect(office.tenants).toHaveLength(0);
    expect(office.vacant).toBe(true);
  });

  it('removes a visitor that rides an elevator on the way out', () => {
    const world = makeTower();
    const shaft = makeShaft(world);
    shaftRoutes(shaft.id);
    const shop = makeRoom(world, 'shop', 5, 200);
    const sim = makeSim(world, {
      kind: 'shopper',
      pos: { floor: 5, x: 206 },
      state: 'inRoom',
      inRoomId: shop.id,
      stayUntil: world.time.minute,
      schedule: [
        { minuteOfDay: 0, days: ['weekday', 'weekend'], goal: { kind: 'room', roomId: shop.id }, stayMinutes: SCHEDULES.shopper.visitMinutes },
      ],
      nextScheduleIndex: 1,
    });
    shop.occupancy = 1;
    const id = sim.id;

    run(world, 1); // the visit ends and the sim heads for the door
    expect(sim.exiting).toBe(true);

    run(world, walkMinutes(206 - SHAFT_X)); // routed to the shaft, now waiting for a car
    expect(sim.state).toBe('waiting');

    // elevators.ts owns these writes: boarding and alighting overwrite the state.
    sim.state = 'riding';
    sim.inCarId = shaft.cars[0]?.id ?? null;
    run(world, 1);
    sim.pos = { floor: 1, x: shaft.x };
    sim.inCarId = null;
    sim.state = 'walking';
    sim.route.shift();

    run(world, walkMinutes(SHAFT_X - ENTRANCE.x));

    expect(world.sims.has(id)).toBe(false);
    expect(shop.occupancy).toBe(0);
  });

  it('does not park visitors outside when they cannot be routed anywhere', () => {
    const world = makeTower();
    makeRoom(world, 'shop', 1, 110);
    mocks.findRoute.mockReturnValue(null);
    setTime(world, 0, SCHEDULES.shopper.open);

    run(world, 120);

    expect(simsOfKind(world, 'shopper')).toHaveLength(0);
    expect(world.sims.size).toBe(0);
  });

  it('removes a shopper once its visit is over', () => {
    const world = makeTower();
    makeRoom(world, 'shop', 1, 110);
    setTime(world, 0, SCHEDULES.shopper.open);

    run(world, 60);
    expect(simsOfKind(world, 'shopper').length).toBeGreaterThan(0);

    run(world, SCHEDULES.shopper.visitMinutes + 30);
    const stillInside = simsOfKind(world, 'shopper').filter((s) => s.state === 'inRoom' && (s.stayUntil ?? 0) < world.time.minute);
    expect(stillInside).toHaveLength(0);
  });
});

describe('determinism', () => {
  it('produces the same world twice from the same seed after 2000 ticks', () => {
    const build = (): World => {
      const world = makeTower(4242);
      makeRoom(world, 'office', 2, 200);
      makeRoom(world, 'condo', 3, 200, { eval: 0.9 });
      makeRoom(world, 'shop', 1, 110);
      makeRoom(world, 'fastFood', 1, 200);
      makeRoom(world, 'hotelSingle', 4, 200);
      makeRoom(world, 'housekeeping', 1, 300);
      setTime(world, 0, 6 * 60);
      return world;
    };

    const a = build();
    const b = build();
    run(a, 2000);
    run(b, 2000);

    expect(a.sims.size).toBeGreaterThan(0);
    expect(snapshot(a)).toBe(snapshot(b));
  });
});
