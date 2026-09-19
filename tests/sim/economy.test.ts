import { describe, expect, it } from 'vitest';
import { createWorld, addRoom, addShaft } from '../../src/sim/world';
import { ECONOMY, LIMITS, ROOMS, SHAFTS } from '../../src/sim/rules';
import { onQuarterStart, recordCondoSale, recordHotelNight, recordVisit, spend } from '../../src/sim/economy';
import { deserialize, serialize } from '../../src/sim/save';
import type { Room, RoomKind, Shaft, ShaftKind, World } from '../../src/sim/types';

let idCounter = 1;

function makeRoom(overrides: Partial<Room> & { kind: RoomKind; floor: number; x: number }): Room {
  return {
    id: idCounter++,
    width: ROOMS[overrides.kind].width,
    height: ROOMS[overrides.kind].height,
    eval: 1,
    tenants: [],
    occupancy: 0,
    builtAtMinute: 0,
    vacant: false,
    dirty: false,
    infested: false,
    lowEvalSinceMinute: null,
    onFire: false,
    ...overrides,
  };
}

function makeShaft(overrides: Partial<Shaft> & { kind: ShaftKind; x: number; floorMin: number; floorMax: number; cars: Shaft['cars'] }): Shaft {
  return {
    id: idCounter++,
    width: SHAFTS[overrides.kind].width,
    stops: new Set([overrides.floorMin]),
    homeFloor: overrides.floorMin,
    hallCalls: new Map(),
    ...overrides,
  };
}

function makeCar(shaftId: number) {
  return { id: idCounter++, shaftId, y: 1, dir: 0 as const, state: 'idle' as const, doorTimer: 0, idleSince: null, passengers: [], calls: new Set<number>(), serves: 'any' as const, range: null };
}

describe('economy: spend', () => {
  it('refuses with the exact reason text when cash is short', () => {
    const world = createWorld(1);
    world.cash = 10_000;
    const result = spend(world, 40_000, 'Offices');
    expect(result).toEqual({ ok: false, reason: "Not enough cash. Offices costs $40,000." });
    expect(world.cash).toBe(10_000);
  });

  it('deducts cash and succeeds when funds are sufficient', () => {
    const world = createWorld(1);
    world.cash = 100_000;
    const result = spend(world, 40_000, 'Offices');
    expect(result).toEqual({ ok: true });
    expect(world.cash).toBe(60_000);
  });

  it('refuses exactly at the boundary when cash equals amount minus one', () => {
    const world = createWorld(1);
    world.cash = 39_999;
    const result = spend(world, 40_000, 'Offices');
    expect(result.ok).toBe(false);
  });

  it('succeeds when cash exactly equals the amount', () => {
    const world = createWorld(1);
    world.cash = 40_000;
    const result = spend(world, 40_000, 'Offices');
    expect(result).toEqual({ ok: true });
    expect(world.cash).toBe(0);
  });
});

describe('economy: onQuarterStart office rent', () => {
  it('scales full-eval office rent at the full rate', () => {
    const world = createWorld(1);
    world.cash = 0;
    addRoom(world, makeRoom({ kind: 'office', floor: 2, x: 100, eval: 1 }));
    onQuarterStart(world);
    expect(world.stats.lastQuarter.income).toBe(ROOMS.office.incomePerQuarter);
  });

  it('scales zero-eval office rent to half the full rate', () => {
    const world = createWorld(1);
    world.cash = 0;
    addRoom(world, makeRoom({ kind: 'office', floor: 2, x: 100, eval: 0 }));
    onQuarterStart(world);
    expect(world.stats.lastQuarter.income).toBe(ROOMS.office.incomePerQuarter * 0.5);
  });

  it('pays no rent for a vacant office', () => {
    const world = createWorld(1);
    world.cash = 0;
    addRoom(world, makeRoom({ kind: 'office', floor: 2, x: 100, eval: 1, vacant: true }));
    onQuarterStart(world);
    expect(world.stats.lastQuarter.income).toBe(0);
  });
});

describe('economy: onQuarterStart upkeep', () => {
  it('charges upkeep per room from ROOMS[kind].upkeepPerQuarter', () => {
    const world = createWorld(1);
    world.cash = 1_000_000;
    addRoom(world, makeRoom({ kind: 'security', floor: 2, x: 100 }));
    onQuarterStart(world);
    expect(world.stats.lastQuarter.upkeep).toBe(ROOMS.security.upkeepPerQuarter);
  });

  it('charges lobby upkeep per segment scaled by the current star rating', () => {
    const world = createWorld(1);
    world.cash = 1_000_000;
    world.stars = 3;
    addRoom(world, makeRoom({ kind: 'lobby', floor: 1, x: 100 }));
    addRoom(world, makeRoom({ kind: 'lobby', floor: 1, x: 101 }));
    onQuarterStart(world);
    expect(world.stats.lastQuarter.upkeep).toBe(LIMITS.lobbyUpkeepPerSegmentByStar[3] * 2);
  });

  it('charges no lobby upkeep at 1 or 2 stars', () => {
    const world = createWorld(1);
    world.cash = 1_000_000;
    world.stars = 1;
    addRoom(world, makeRoom({ kind: 'lobby', floor: 1, x: 100 }));
    onQuarterStart(world);
    expect(world.stats.lastQuarter.upkeep).toBe(0);
  });

  it('charges lobby upkeep for sky lobby rooms too', () => {
    const world = createWorld(1);
    world.cash = 1_000_000;
    world.stars = 4;
    addRoom(world, makeRoom({ kind: 'skyLobby', floor: 15, x: 100 }));
    onQuarterStart(world);
    expect(world.stats.lastQuarter.upkeep).toBe(LIMITS.lobbyUpkeepPerSegmentByStar[4]);
  });

  it('charges shaft upkeep per car', () => {
    const world = createWorld(1);
    world.cash = 1_000_000;
    const shaft = makeShaft({ kind: 'standard', x: 150, floorMin: 1, floorMax: 10, cars: [] });
    shaft.cars = [makeCar(shaft.id), makeCar(shaft.id), makeCar(shaft.id)];
    addShaft(world, shaft);
    onQuarterStart(world);
    expect(world.stats.lastQuarter.upkeep).toBe(SHAFTS.standard.upkeepPerQuarterPerCar * 3);
  });
});

describe('economy: onQuarterStart totals and reset', () => {
  it('rolls income, upkeep and net into stats.lastQuarter', () => {
    const world = createWorld(1);
    world.cash = 1_000_000;
    addRoom(world, makeRoom({ kind: 'office', floor: 2, x: 100, eval: 1 }));
    addRoom(world, makeRoom({ kind: 'security', floor: 3, x: 100 }));
    onQuarterStart(world);
    const income = ROOMS.office.incomePerQuarter;
    const upkeep = ROOMS.security.upkeepPerQuarter;
    expect(world.stats.lastQuarter).toEqual({ income, upkeep, net: income - upkeep });
  });

  it('resets incomeByKind and upkeepByKind after rolling up', () => {
    const world = createWorld(1);
    world.cash = 1_000_000;
    addRoom(world, makeRoom({ kind: 'office', floor: 2, x: 100, eval: 1 }));
    onQuarterStart(world);
    expect(world.stats.incomeByKind).toEqual({});
    expect(world.stats.upkeepByKind).toEqual({});
  });

  it('logs a one line quarter summary', () => {
    const world = createWorld(1);
    world.cash = 1_000_000;
    onQuarterStart(world);
    const last = world.log[world.log.length - 1];
    expect(last?.text).toContain('Quarter closed');
  });
});

describe('economy: bankruptcy', () => {
  it('does not foreclose after only one bad quarter', () => {
    const world = createWorld(1);
    world.cash = ECONOMY.bankruptAtCash - 1;
    onQuarterStart(world);
    expect(world.gameOver).toBeNull();
  });

  it('forecloses after the configured number of consecutive bad quarters', () => {
    const world = createWorld(1);
    world.cash = ECONOMY.bankruptAtCash - 1;
    for (let i = 0; i < ECONOMY.bankruptAfterQuarters; i++) onQuarterStart(world);
    expect(world.gameOver).toEqual({ at: world.time.minute, reason: 'The bank has foreclosed on the tower.' });
  });

  it('resets the bad quarter streak after a good quarter', () => {
    const world = createWorld(1);
    world.cash = ECONOMY.bankruptAtCash - 1;
    onQuarterStart(world); // bad quarter 1
    world.cash = 1_000_000; // recover
    onQuarterStart(world); // good quarter resets streak
    world.cash = ECONOMY.bankruptAtCash - 1;
    onQuarterStart(world); // bad quarter 1 again, not 2 in a row
    expect(world.gameOver).toBeNull();
  });

  it('keeps the bad quarter streak across a save and load, so it still forecloses', () => {
    const world = createWorld(1);
    world.cash = ECONOMY.bankruptAtCash - 1;
    onQuarterStart(world); // bad quarter 1
    expect(world.gameOver).toBeNull();

    const result = deserialize(serialize(world));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const loaded = result.world;

    loaded.cash = ECONOMY.bankruptAtCash - 1;
    onQuarterStart(loaded); // bad quarter 2, after reload
    expect(loaded.gameOver).toEqual({ at: loaded.time.minute, reason: 'The bank has foreclosed on the tower.' });
  });
});

describe('economy: record functions', () => {
  it('recordVisit credits shop income per visitor', () => {
    const world = createWorld(1);
    const room = makeRoom({ kind: 'shop', floor: 1, x: 0 });
    recordVisit(world, room);
    expect(world.cash).toBe(LIMITS.startingCash + ECONOMY.shopIncomePerVisitor);
  });

  it('recordVisit credits fast food income per visitor', () => {
    const world = createWorld(1);
    const room = makeRoom({ kind: 'fastFood', floor: 1, x: 0 });
    recordVisit(world, room);
    expect(world.cash).toBe(LIMITS.startingCash + ECONOMY.fastFoodIncomePerVisitor);
  });

  it('recordVisit credits restaurant income per visitor', () => {
    const world = createWorld(1);
    const room = makeRoom({ kind: 'restaurant', floor: 1, x: 0 });
    recordVisit(world, room);
    expect(world.cash).toBe(LIMITS.startingCash + ECONOMY.restaurantIncomePerVisitor);
  });

  it('recordVisit credits cinema income per viewer', () => {
    const world = createWorld(1);
    const room = makeRoom({ kind: 'cinema', floor: 1, x: 0 });
    recordVisit(world, room);
    expect(world.cash).toBe(LIMITS.startingCash + ECONOMY.cinemaIncomePerViewer);
  });

  it('recordVisit credits party hall income per event, not per visitor', () => {
    const world = createWorld(1);
    const room = makeRoom({ kind: 'partyHall', floor: 1, x: 0 });
    recordVisit(world, room);
    expect(world.cash).toBe(LIMITS.startingCash + ECONOMY.partyHallIncomePerEvent);
  });

  it('recordVisit does nothing for kinds with no visit income', () => {
    const world = createWorld(1);
    const room = makeRoom({ kind: 'office', floor: 1, x: 0 });
    recordVisit(world, room);
    expect(world.cash).toBe(LIMITS.startingCash);
  });

  it('recordHotelNight adds incomePerQuarter times the nightly fraction', () => {
    const world = createWorld(1);
    const room = makeRoom({ kind: 'hotelSuite', floor: 1, x: 0 });
    recordHotelNight(world, room);
    expect(world.cash).toBe(LIMITS.startingCash + ROOMS.hotelSuite.incomePerQuarter * ECONOMY.hotelNightlyIncomeFraction);
  });

  it('recordCondoSale marks the room not vacant and adds the sale price', () => {
    const world = createWorld(1);
    const room = makeRoom({ kind: 'condo', floor: 1, x: 0, vacant: true });
    recordCondoSale(world, room);
    expect(room.vacant).toBe(false);
    expect(world.cash).toBe(LIMITS.startingCash + ECONOMY.condoSalePrice);
  });
});
