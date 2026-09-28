import { describe, expect, it } from 'vitest';
import { createWorld, addRoom, addShaft } from '../../src/sim/world';
import { ECONOMY, LIMITS, ROOMS, SHAFTS } from '../../src/sim/rules';
import {
  debitLoss,
  officeQuarterRent,
  onQuarterStart,
  quarterForecast,
  quarterUpkeepOf,
  recordCondoSale,
  recordHotelNight,
  recordVisit,
  spend,
} from '../../src/sim/economy';
import { applyCommand } from '../../src/sim/build';
import { deserialize, hashWorld, serialize } from '../../src/sim/save';
import { tick } from '../../src/sim/tick';
import { tickEvaluation } from '../../src/sim/evaluation';

function tickUntil(world: World, minute: number): void {
  while (world.time.minute < minute) tick(world);
}
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
    rent: 100,
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

describe('economy: officeRentEvalScale is read (audit A S9)', () => {
  it('pays the full rate at any eval when the flag is off', () => {
    const room = makeRoom({ kind: 'office', floor: 2, x: 100, eval: 0 });
    expect(officeQuarterRent(room)).toBe(ROOMS.office.incomePerQuarter * 0.5);
    ECONOMY.officeRentEvalScale = false;
    try {
      expect(officeQuarterRent(room)).toBe(ROOMS.office.incomePerQuarter);
    } finally {
      ECONOMY.officeRentEvalScale = true;
    }
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

  it('scales full-eval office rent by the room rent setting', () => {
    const full = createWorld(1);
    full.cash = 0;
    addRoom(full, makeRoom({ kind: 'office', floor: 2, x: 100, eval: 1, rent: 100 }));
    onQuarterStart(full);
    expect(full.stats.lastQuarter.income).toBe(ROOMS.office.incomePerQuarter);

    const half = createWorld(1);
    half.cash = 0;
    addRoom(half, makeRoom({ kind: 'office', floor: 2, x: 100, eval: 1, rent: 50 }));
    onQuarterStart(half);
    expect(half.stats.lastQuarter.income).toBe(Math.round(ROOMS.office.incomePerQuarter * 0.5));

    const premium = createWorld(1);
    premium.cash = 0;
    addRoom(premium, makeRoom({ kind: 'office', floor: 2, x: 100, eval: 1, rent: 150 }));
    onQuarterStart(premium);
    expect(premium.stats.lastQuarter.income).toBe(Math.round(ROOMS.office.incomePerQuarter * 1.5));
  });

  it('credits exactly officeQuarterRent for a half-eval office at 80% rent', () => {
    const world = createWorld(1);
    world.cash = 0;
    const room = makeRoom({ kind: 'office', floor: 2, x: 100, eval: 0.5, rent: 80 });
    addRoom(world, room);
    onQuarterStart(world);
    expect(world.stats.lastQuarter.income).toBe(officeQuarterRent(room));
    expect(officeQuarterRent(room)).toBe(6000);
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
    expect(world.stats.lastQuarter).toEqual({
      income,
      upkeep,
      losses: 0,
      net: income - upkeep,
      incomeByKind: { office: income },
      upkeepByKind: { security: upkeep },
      lossesByKind: {},
      upkeepCountByKind: { security: 1 },
    });
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
    expect(last?.text).toContain('The quarter is over.');
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
    expect(world.gameOver).toEqual({ at: world.time.minute, reason: 'The bank took the tower back.' });
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
    expect(loaded.gameOver).toEqual({ at: loaded.time.minute, reason: 'The bank took the tower back.' });
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

  it('a hotel night earns a third of the quarter rate: a twin at $9,000 a quarter earns $3,000 a night', () => {
    expect(ECONOMY.hotelNightlyIncomeFraction).toBe(1 / 3);
    const world = createWorld(1);
    recordHotelNight(world, makeRoom({ kind: 'hotelTwin', floor: 1, x: 0 }));
    expect(world.cash).toBe(LIMITS.startingCash + 3_000);
    expect(world.stats.incomeByKind.hotelTwin).toBe(3_000);
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

describe('economy: quarter summary money (audit A S8)', () => {
  it('writes a loss as -$30,000, through the real tick', () => {
    const world = createWorld(3);
    world.stars = 2;
    for (let x = 100; x < 120; x++) expect(applyCommand(world, { kind: 'build', room: 'lobby', floor: 1, x }).ok).toBe(true);
    expect(applyCommand(world, { kind: 'build', room: 'security', floor: 2, x: 100 }).ok).toBe(true);
    expect(applyCommand(world, { kind: 'shaft.build', shaft: 'standard', x: 110, floorMin: 1, floorMax: 3 }).ok).toBe(true);
    world.cash = 10_000; // below the upkeep: $20,000 for security plus $10,000 for the car
    let guard = 0;
    while (!world.log.some((l) => l.text.startsWith('The quarter is over')) && guard++ < 5 * 1440) tick(world);
    const summary = world.log.find((l) => l.text.startsWith('The quarter is over'))?.text ?? '';
    expect(summary).toBe('The quarter is over. Earned $0, spent $30,000 on running costs, profit -$30,000. Cash: -$20,000.');
    expect(summary).not.toContain('$-');
  });
});

describe('economy: event losses (review 2026-09-28 I2)', () => {
  it('debitLoss takes cash and books it under its kind', () => {
    const world = createWorld(1);
    world.cash = 1_000_000;
    debitLoss(world, 'bomb', 200_000);
    debitLoss(world, 'theft', 2_000);
    debitLoss(world, 'theft', 2_000);
    expect(world.cash).toBe(796_000);
    expect(world.stats.lossesByKind).toEqual({ bomb: 200_000, theft: 4_000 });
  });

  it('the settle counts losses in lastQuarter and net, keeps the three tables, and says what trouble cost', () => {
    const world = createWorld(1);
    world.cash = 1_000_000;
    addRoom(world, makeRoom({ kind: 'office', floor: 2, x: 100, eval: 1 }));
    addRoom(world, makeRoom({ kind: 'security', floor: 3, x: 100 }));
    debitLoss(world, 'fire', 40_000);
    onQuarterStart(world);
    const income = ROOMS.office.incomePerQuarter;
    const upkeep = ROOMS.security.upkeepPerQuarter;
    expect(world.stats.lastQuarter).toEqual({
      income,
      upkeep,
      losses: 40_000,
      net: income - upkeep - 40_000,
      incomeByKind: { office: income },
      upkeepByKind: { security: upkeep },
      lossesByKind: { fire: 40_000 },
      upkeepCountByKind: { security: 1 },
    });
    expect(world.stats.lossesByKind).toEqual({});
    expect(world.stats.incomeByKind).toEqual({});
    expect(world.stats.upkeepByKind).toEqual({});
    const summary = world.log.find((l) => l.text.startsWith('The quarter is over'))?.text;
    expect(summary).toBe('The quarter is over. Earned $10,000, spent $20,000 on running costs, lost $40,000 to trouble, profit -$50,000. Cash: $950,000.');
  });
});

describe('economy: quarter forecast (review 2026-09-28 I1)', () => {
  function fixedWorld(): World {
    const world = createWorld(7);
    world.cash = 5_000_000;
    world.stars = 3;
    for (let x = 100; x < 110; x++) addRoom(world, makeRoom({ kind: 'lobby', floor: 1, x }));
    addRoom(world, makeRoom({ kind: 'office', floor: 2, x: 100, eval: 1 }));
    addRoom(world, makeRoom({ kind: 'office', floor: 2, x: 110, eval: 0.5, rent: 120 }));
    addRoom(world, makeRoom({ kind: 'office', floor: 2, x: 120, vacant: true }));
    addRoom(world, makeRoom({ kind: 'security', floor: 3, x: 100 }));
    addRoom(world, makeRoom({ kind: 'housekeeping', floor: 4, x: 100 }));
    const standard = makeShaft({ kind: 'standard', x: 150, floorMin: 1, floorMax: 10, cars: [] });
    standard.cars = [makeCar(standard.id), makeCar(standard.id), makeCar(standard.id)];
    addShaft(world, standard);
    const express = makeShaft({ kind: 'express', x: 200, floorMin: 1, floorMax: 15, cars: [] });
    express.cars = [makeCar(express.id), makeCar(express.id)];
    addShaft(world, express);
    return world;
  }

  it('equals what the settle then credits and debits, and changes nothing', () => {
    const world = fixedWorld();
    tickEvaluation(world); // the 04:30 evaluation: nobody is in, so every office is at its resting rating
    const hash = hashWorld(world);
    const forecast = quarterForecast(world);
    expect(hashWorld(world)).toBe(hash);
    expect(forecast.vacantOffices).toBe(1);
    expect(forecast.upkeepByKind).toEqual({ lobby: 3_000, security: 20_000, housekeeping: 10_000, standard: 30_000, express: 40_000 });
    expect(forecast.upkeepCountByKind).toEqual({ lobby: 10, security: 1, housekeeping: 1, standard: 3, express: 2 });
    onQuarterStart(world);
    const last = world.stats.lastQuarter;
    expect(forecast.rent).toBe(last.income);
    expect(forecast.rentByKind).toEqual(last.incomeByKind);
    expect(forecast.upkeep).toBe(last.upkeep);
    expect(forecast.upkeepByKind).toEqual(last.upkeepByKind);
    expect(last.upkeepCountByKind).toEqual(forecast.upkeepCountByKind);
    // Full eval, then at 120% rent the resting rating is 1 - 0.2 x 0.6 = 0.88: 0.94 of the rate, times 1.2.
    expect(forecast.rent).toBe(10_000 + 11_280);
  });

  // Review I-2: the settle reads the 04:30 evaluation, taken with the workers home and their
  // stress faded; a forecast read at noon from the midday eval came in low.
  it('an office tower under heavy midday stress forecasts the rent the 5 AM settle then pays', () => {
    const world = createWorld(12345);
    world.cash = 50_000_000;
    const officeXs = [158, 185];
    const script = [
      ...Array.from({ length: 51 }, (_, i) => ({ kind: 'build' as const, room: 'lobby' as const, floor: 1, x: 150 + i })),
      { kind: 'shaft.build' as const, shaft: 'standard' as const, x: 176, floorMin: 1, floorMax: 6 },
    ];
    for (const floor of [2, 3, 4, 5]) for (const x of officeXs) script.push({ kind: 'build', room: 'office', floor, x } as never);
    for (const cmd of script) expect(applyCommand(world, cmd).ok).toBe(true);
    const offices = [...world.rooms.values()].filter((r) => r.kind === 'office');
    // To noon on the quarter's last day, then every office worker as stressed as a person gets.
    tickUntil(world, 2 * 1440 + 12 * 60 + 29);
    expect(offices.every((o) => !o.vacant && o.tenants.length > 0)).toBe(true);
    for (const office of offices) for (const id of office.tenants) world.sims.get(id)!.stress = 1;
    tickUntil(world, 2 * 1440 + 12 * 60 + 31); // through the 12:30 evaluation
    const forecast = quarterForecast(world);
    // The midday ratings are low, so rent read from them now would be well under the forecast.
    const atMiddayEval = offices.reduce((sum, o) => sum + officeQuarterRent(o), 0);
    expect(atMiddayEval).toBeLessThan(forecast.rent * 0.8);
    tickUntil(world, 3 * 1440 + 5 * 60 + 1); // through the 5 AM settle
    expect(world.stats.lastQuarter.incomeByKind.office).toBe(forecast.rentByKind.office);
    expect(forecast.rent).toBe(offices.length * ROOMS.office.incomePerQuarter);
  });

  it('quarterUpkeepOf prices one car or one room, lobby segments at the current stars', () => {
    const world = createWorld(1);
    world.stars = 3;
    expect(quarterUpkeepOf(world, 'standard')).toBe(10_000);
    expect(quarterUpkeepOf(world, 'express')).toBe(20_000);
    expect(quarterUpkeepOf(world, 'security')).toBe(20_000);
    expect(quarterUpkeepOf(world, 'lobby')).toBe(300);
    expect(quarterUpkeepOf(world, 'office')).toBe(0);
    world.stars = 1;
    expect(quarterUpkeepOf(world, 'lobby')).toBe(0);
  });
});

describe('economy: last quarter counts in the save (review A-2)', () => {
  it('round trips the counts, loads an older save without them, and refuses a table that is not numbers', () => {
    const world = createWorld(3);
    world.stars = 3;
    addRoom(world, makeRoom({ kind: 'lobby', floor: 1, x: 100 }));
    addRoom(world, makeRoom({ kind: 'lobby', floor: 1, x: 101 }));
    world.nextId = idCounter; // the rooms took ids from this file's counter
    onQuarterStart(world);
    expect(world.stats.lastQuarter.upkeepCountByKind).toEqual({ lobby: 2 });
    const text = serialize(world);
    const back = deserialize(text);
    if (!back.ok) throw new Error(back.reason);
    expect(back.ok && back.world.stats.lastQuarter.upkeepCountByKind).toEqual({ lobby: 2 });
    expect(back.ok && hashWorld(back.world)).toBe(hashWorld(world));

    const old = JSON.parse(text);
    delete old.stats.lastQuarter.upkeepCountByKind;
    const loaded = deserialize(JSON.stringify(old));
    expect(loaded.ok && 'upkeepCountByKind' in loaded.world.stats.lastQuarter).toBe(false);

    old.stats.lastQuarter.upkeepCountByKind = { lobby: 'two' };
    const bad = deserialize(JSON.stringify(old));
    expect(bad.ok).toBe(false);
  });
});

describe('economy: debt warnings (review 2026-09-28 I5)', () => {
  const DEBT = 'You are in debt: -$100,000. Nothing can be built until you have its price. Removing elevator cars or demolishing costly rooms lowers your running costs.';

  it('warns about debt as a notable alert when cash is below 0 after the settle', () => {
    const world = createWorld(1);
    world.cash = -100_000;
    onQuarterStart(world);
    const line = world.log.find((l) => l.text.startsWith('You are in debt'));
    expect(line).toMatchObject({ text: DEBT, level: 'alert', notable: true });
    expect(world.log.some((l) => l.text.startsWith('The bank gives you'))).toBe(false);
  });

  it('says nothing about debt when cash is 0 or more', () => {
    const world = createWorld(1);
    world.cash = 0;
    onQuarterStart(world);
    expect(world.log.some((l) => l.text.startsWith('You are in debt') || l.text.startsWith('The bank'))).toBe(false);
  });

  it('gives the bank deadline once, at the first quarter below the line, with the next settle in days, never a day number', () => {
    const world = createWorld(1);
    world.time.minute = 3 * 1440 + 5 * 60; // the settle on day 4
    world.cash = ECONOMY.bankruptAtCash - 1;
    onQuarterStart(world);
    const bank = world.log.filter((l) => l.text.startsWith('The bank gives you'));
    expect(bank).toHaveLength(1);
    expect(bank[0]).toMatchObject({
      text: 'The bank gives you one quarter. Get to -$500,000 or better by the next settle, 5 AM in 3 days, or the bank takes the tower.',
      level: 'alert',
      notable: true,
    });
    expect(world.log.some((l) => l.text === 'You are in debt: -$500,001. Nothing can be built until you have its price. Removing elevator cars or demolishing costly rooms lowers your running costs.')).toBe(true);
    world.time.minute += 3 * 1440;
    onQuarterStart(world); // second bad quarter: game over, no second deadline
    expect(world.log.filter((l) => l.text.startsWith('The bank gives you'))).toHaveLength(1);
    expect(world.gameOver).not.toBeNull();
  });
});
