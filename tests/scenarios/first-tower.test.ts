/**
 * Scenario tests: whole towers, built the way a player builds them.
 *
 * Every room and shaft goes in through applyCommand, the clock runs through tick.ts,
 * and the assertions are about what the player would see: tenants, cash, stress,
 * stars and the save file. Nothing here reaches into the sim to stage state, with one
 * declared exception: the hotel scenario sets world.stars because earning the second
 * star needs a population of 300, which is a different scenario's worth of building.
 */

import { describe, expect, it } from 'vitest';

import { applyCommand } from '../../src/sim/build';
import { stressBand } from '../../src/sim/people';
import { deserialize, hashWorld, serialize } from '../../src/sim/save';
import { ECONOMY, LIMITS, ROOMS, SHAFTS, STRESS } from '../../src/sim/rules';
import { tickMany } from '../../src/sim/tick';
import { createWorld } from '../../src/sim/world';
import {
  at,
  atOnDay,
  averageStress,
  buildRow,
  buildTower,
  countRooms,
  countSims,
  lobbyRun,
  onlyShaft,
  roomsMatching,
  runDays,
  simsOfKind,
} from './helpers';
import type { Command, World } from '../../src/sim/types';

const SEED = 12345;

// The shaft stands inside the lobby run, so those four tiles stay clear of lobby
// segments: build.ts refuses a shaft that crosses a room and a room that crosses a shaft.
const SHAFT_X = 176;
const SHAFT_TILES: readonly [number, number] = [SHAFT_X, SHAFT_X + SHAFTS.standard.width - 1];

/** Scenario 2: a lobby, one standard shaft up to floor 6, two offices on floors 2 to 5. */
function firstTowerScript(officeXs: readonly number[] = [158, 185]): Command[] {
  return [
    ...lobbyRun(150, 200, [SHAFT_TILES]),
    { kind: 'shaft.build', shaft: 'standard', x: SHAFT_X, floorMin: 1, floorMax: 6 },
    ...buildRow('office', 2, officeXs),
    ...buildRow('office', 3, officeXs),
    ...buildRow('office', 4, officeXs),
    ...buildRow('office', 5, officeXs),
  ];
}

function firstTower(seed = SEED, officeXs?: readonly number[]): World {
  const world = createWorld(seed);
  buildTower(world, firstTowerScript(officeXs));
  return world;
}

/**
 * A thin tower: one shaft from the ground to floor 30 and a floor of offices on top.
 * Floors 2 to 29 only exist to satisfy the support rule, so they are cheap stairs
 * placed two floors apart and out of every route (no stair pair links floor f to f + 1
 * across the gaps, so nobody can walk up).
 */
function tallTower(cars: number, officeXs: readonly number[], seed = SEED): World {
  const world = createWorld(seed);
  const filler: Command[] = [];
  for (let floor = 2; floor <= 28; floor += 2) filler.push({ kind: 'build', room: 'stairs', floor, x: 300 });
  buildTower(world, [
    ...lobbyRun(160, 190, [SHAFT_TILES]),
    { kind: 'shaft.build', shaft: 'standard', x: SHAFT_X, floorMin: 1, floorMax: 30 },
    ...filler,
    ...buildRow('office', 30, officeXs),
  ]);
  const shaft = onlyShaft(world);
  for (let i = 1; i < cars; i++) {
    const added = applyCommand(world, { kind: 'shaft.addCar', shaftId: shaft.id });
    if (!added.ok) throw new Error(`Could not add car ${i + 1}: ${added.reason}`);
  }
  return world;
}

function xsFrom(start: number, count: number, step = ROOMS.office.width): number[] {
  return Array.from({ length: count }, (_, i) => start + i * step);
}

const TEN_OFFICES = xsFrom(200, 10);
const TWENTY_OFFICES = [...TEN_OFFICES, ...xsFrom(20, 10)];

describe('scenario: a bare lot', () => {
  it('does nothing at all for a whole day', () => {
    const world = createWorld(SEED);
    runDays(world, 1);

    expect(world.rooms.size).toBe(0);
    expect(world.shafts.size).toBe(0);
    expect(world.sims.size).toBe(0);
    expect(world.population).toBe(0);
    expect(world.stars).toBe(1);
    expect(world.cash).toBe(LIMITS.startingCash);
    expect(world.gameOver).toBeNull();
  });
});

describe('scenario: the first tower', () => {
  it('leases every office and puts the workers at their desks by 10:00', () => {
    const world = firstTower();
    at(world, 10, 0);

    expect(countRooms(world, 'office')).toBe(8);
    expect(countRooms(world, 'office', { vacant: true })).toBe(0);
    for (const office of roomsMatching(world, 'office')) {
      expect(office.tenants).toHaveLength(ROOMS.office.capacity);
    }

    const workers = simsOfKind(world, 'worker');
    expect(workers).toHaveLength(8 * ROOMS.office.capacity);
    for (const worker of workers) {
      expect(['inRoom', 'riding', 'waiting', 'walking']).toContain(worker.state);
    }
    expect(workers.filter((w) => w.state === 'inRoom').length).toBeGreaterThan(0);
    expect(world.population).toBe(48);
  });

  it('sends most of the workers home by 19:00', () => {
    const world = firstTower();
    at(world, 19, 0);

    const workers = simsOfKind(world, 'worker');
    const outside = workers.filter((w) => w.state === 'outside').length;
    expect(workers.length).toBeGreaterThan(0);
    expect(outside).toBeGreaterThan(workers.length / 2);
    expect(countRooms(world, 'office', { occupied: true })).toBe(0);
  });

  it('collects office rent less elevator and lobby upkeep at the quarter start', () => {
    const world = firstTower();
    // The first quarter boundary is 05:00 on day 3: a new game opens at 06:00 on day 0.
    atOnDay(world, 3, 5, 0);

    const offices = roomsMatching(world, 'office', { vacant: false });
    const rent = offices.reduce((total, office) => total + ROOMS.office.incomePerQuarter * (0.5 + office.eval / 2), 0);
    const lobbyUpkeep = countRooms(world, 'lobby') * LIMITS.lobbyUpkeepPerSegmentByStar[world.stars];
    const shaftUpkeep = SHAFTS.standard.upkeepPerQuarterPerCar * onlyShaft(world).cars.length;
    const cashBefore = world.cash;

    tickMany(world, 1); // the minute that runs onQuarterStart

    expect(offices).toHaveLength(8);
    expect(world.cash - cashBefore).toBeCloseTo(rent - lobbyUpkeep - shaftUpkeep, 6);
    expect(world.cash).toBeGreaterThan(cashBefore);
    expect(world.stats.lastQuarter.income).toBeCloseTo(rent, 6);
    expect(world.stats.lastQuarter.upkeep).toBeCloseTo(lobbyUpkeep + shaftUpkeep, 6);
  });
});

describe('scenario: determinism', () => {
  it('replays the same day from the same seed', () => {
    const a = firstTower(SEED);
    const b = firstTower(SEED);
    at(a, 10, 0);
    at(b, 10, 0);

    expect(hashWorld(a)).toBe(hashWorld(b));

    runDays(a, 1);
    runDays(b, 1);
    expect(hashWorld(a)).toBe(hashWorld(b));
  });

  it('plays a different day from a different seed', () => {
    const a = firstTower(SEED);
    const b = firstTower(SEED + 1);
    at(a, 10, 0);
    at(b, 10, 0);

    expect(hashWorld(a)).not.toBe(hashWorld(b));
  });
});

describe('scenario: condos', () => {
  /** Clear of the lobby footprint: see the noise test below for why that matters. */
  const CONDO_XS = [205, 222, 239];

  it('sells every condo and moves the owners in within two weekdays', () => {
    const world = createWorld(SEED);
    buildTower(world, [
      ...lobbyRun(150, 200, [SHAFT_TILES]),
      { kind: 'shaft.build', shaft: 'standard', x: SHAFT_X, floorMin: 1, floorMax: 6 },
      ...buildRow('condo', 2, CONDO_XS),
    ]);
    const cashAfterBuilding = world.cash;

    runDays(world, 2);

    expect(countRooms(world, 'condo', { vacant: false })).toBe(3);
    expect(world.cash - cashAfterBuilding).toBe(3 * ECONOMY.condoSalePrice);
    expect(countSims(world, 'resident')).toBe(3 * ROOMS.condo.capacity);
    for (const condo of roomsMatching(world, 'condo')) {
      expect(condo.tenants).toHaveLength(ROOMS.condo.capacity);
    }
  });

  // BUG: sim/evaluation.ts. A condo built directly above the ground lobby never sells.
  // The lobby is built one tile at a time, so every lobby segment under the condo is a
  // separate noisy vertical neighbor in noisyNeighborsOf, and evaluateRoom charges
  // EVAL.noisePenaltyPerNeighbor (0.2) for each one. A 16 tile condo over a lobby run
  // collects 16 neighbors, so the penalty is 3.2 and eval clamps to 0, far below
  // ECONOMY.condoSaleEvalMin (0.5), which people.ts requires before a condo can sell.
  // Evidence: with this scenario both condos report eval 0.00 and vacant true after two
  // days, while the identical condos at x 205 and beyond (the test above) sell on day 1.
  // Five lobby segments are enough to zero any quiet room above or below them, so hotel
  // rooms on floor 2 hit the same wall and their guests move out after a day.
  it('sells a condo built directly above the ground lobby', () => {
    const world = createWorld(SEED);
    buildTower(world, [
      ...lobbyRun(150, 200, [SHAFT_TILES]),
      { kind: 'shaft.build', shaft: 'standard', x: SHAFT_X, floorMin: 1, floorMax: 6 },
      ...buildRow('condo', 2, [150, 182]),
    ]);

    runDays(world, 2);

    expect(countRooms(world, 'condo', { vacant: false })).toBe(2);
  });
});

describe('scenario: a small hotel', () => {
  function hotel(): World {
    const world = createWorld(SEED);
    buildTower(world, [
      ...lobbyRun(150, 200, [SHAFT_TILES]),
      { kind: 'shaft.build', shaft: 'standard', x: SHAFT_X, floorMin: 1, floorMax: 6 },
    ]);
    // Reaching 2 stars needs a population of 300, which this tower will never have, so
    // the star is granted directly. Everything after this point is ordinary play.
    world.stars = 2;
    buildTower(world, [
      { kind: 'build', room: 'housekeeping', floor: 2, x: 205 },
      ...buildRow('hotelSingle', 2, [225, 230, 235, 240]),
    ]);
    return world;
  }

  it('takes guests overnight, then housekeeping turns the rooms around', () => {
    const world = hotel();
    expect(countRooms(world, 'hotelSingle')).toBe(4);
    expect(countSims(world, 'staff')).toBe(0);

    at(world, 23, 0);
    expect(roomsMatching(world, 'hotelSingle', { occupied: true }).length).toBeGreaterThan(0);
    expect(countSims(world, 'guest')).toBeGreaterThan(0);
    expect(countSims(world, 'staff')).toBe(ROOMS.housekeeping.capacity);

    at(world, 10, 0); // the morning after: guests have checked out
    expect(countRooms(world, 'hotelSingle', { dirty: true })).toBeGreaterThan(0);
    expect(countRooms(world, 'hotelSingle', { occupied: true })).toBe(0);

    const startPositions = new Map<number, string>();
    for (const keeper of simsOfKind(world, 'staff')) startPositions.set(keeper.id, `${keeper.pos.floor}:${keeper.pos.x}`);

    let keeperMoved = false;
    for (let minute = 0; minute < 4 * 60; minute++) {
      tickMany(world, 1);
      for (const keeper of simsOfKind(world, 'staff')) {
        if (startPositions.get(keeper.id) !== `${keeper.pos.floor}:${keeper.pos.x}`) keeperMoved = true;
      }
    }

    expect(keeperMoved).toBe(true);
    expect(countRooms(world, 'hotelSingle', { dirty: true })).toBe(0); // clean again by 14:00
    expect(world.log.some((entry) => entry.text.startsWith('Housekeeping cleaned'))).toBe(true);
  });
});

describe('scenario: the morning rush', () => {
  it('pushes a sim into the pink band when one car serves a floor of offices', () => {
    // Twenty offices, not ten. One car makes a round trip to floor 30 in roughly
    // 17 minutes and holds SHAFTS.standard.capacity (21), so ten offices (60 workers
    // spread over the 75 minute arrival window) never queue longer than a single round
    // trip and peak at 0.340 stress, a minute of waiting short of STRESS.pink (0.35).
    // Twenty offices put 120 workers on a car that cannot keep up, which is the point.
    const world = tallTower(1, TWENTY_OFFICES);
    at(world, 7, 55);

    let peak = 0;
    let pinkSeen = false;
    for (let minute = 0; minute < 3 * 60; minute++) {
      tickMany(world, 1);
      for (const sim of world.sims.values()) {
        peak = Math.max(peak, sim.stress);
        if (stressBand(sim.stress) !== 'calm') pinkSeen = true;
      }
    }

    expect(simsOfKind(world, 'worker')).toHaveLength(20 * ROOMS.office.capacity);
    expect(peak).toBeGreaterThanOrEqual(STRESS.pink);
    expect(pinkSeen).toBe(true);
  });

  it('keeps the tower calmer with four cars than with one', () => {
    const one = tallTower(1, TEN_OFFICES);
    const four = tallTower(4, TEN_OFFICES);
    at(one, 9, 30);
    at(four, 9, 30);

    const workersOne = simsOfKind(one, 'worker');
    const workersFour = simsOfKind(four, 'worker');
    expect(workersOne).toHaveLength(10 * ROOMS.office.capacity);
    expect(workersFour).toHaveLength(workersOne.length);
    expect(onlyShaft(four).cars).toHaveLength(4);

    expect(averageStress(workersFour)).toBeLessThan(averageStress(workersOne));
  });
});

describe('scenario: save and load', () => {
  it('keeps a loaded world in step with the original', () => {
    const world = firstTower();
    atOnDay(world, 1, 12, 0); // midday on day 2, with people mid trip

    const loaded = deserialize(serialize(world));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    expect(hashWorld(loaded.world)).toBe(hashWorld(world));

    tickMany(world, 300);
    tickMany(loaded.world, 300);

    expect(hashWorld(loaded.world)).toBe(hashWorld(world));
    expect(loaded.world.cash).toBe(world.cash);
    expect(loaded.world.sims.size).toBe(world.sims.size);
  });

  it('refuses text that is not a save', () => {
    const result = deserialize('{"hello":"world"}');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('This file is not a Hundred Stories save.');
  });
});

describe('scenario: event commands with no event running', () => {
  it('refuses to pay a ransom when there is no bomb', () => {
    const world = firstTower();
    const result = applyCommand(world, { kind: 'bomb.pay' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('There is no bomb threat right now.');
    expect(world.cash).toBe(firstTower().cash);
  });

  it('refuses to call a helicopter when there is no fire', () => {
    const world = firstTower();
    const cashBefore = world.cash;
    const result = applyCommand(world, { kind: 'fire.callHelicopter' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('There is no fire right now.');
    expect(world.cash).toBe(cashBefore);
  });
});

describe('performance', () => {
  it('runs three game days of a twenty office tower', () => {
    const world = firstTower(SEED, [140, 149, 158, 167, 185]);
    expect(countRooms(world, 'office')).toBe(20);

    const started = performance.now();
    runDays(world, 3);
    const elapsed = performance.now() - started;

    console.log(
      `Performance: 3 game days (${3 * 1440} ticks) of a 20 office tower with ${world.sims.size} sims took ${elapsed.toFixed(0)} ms.`,
    );
    expect(world.gameOver).toBeNull();
    expect(countSims(world, 'worker')).toBe(20 * ROOMS.office.capacity);
  });
});
