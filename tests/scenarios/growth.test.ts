/**
 * Growth scenario: nine floors of offices, two shafts with four cars each, and two
 * quarters of trading. Everything is built with applyCommand and the clock runs
 * through tick.ts.
 *
 * Two starting conditions are staged, both declared here and nowhere else:
 *   cash   The tower the scenario asks for costs $8,240,000 to build and
 *          LIMITS.startingCash is $2,000,000, so the world is given a construction
 *          budget. Every cash assertion below is a comparison between quarters, so
 *          the size of the grant does not decide the result.
 *   stars  The three star attempt sets world.stars, because a security office needs
 *          2 stars and the tower earns its second star only once the offices lease.
 */

import { describe, expect, it } from 'vitest';

import { applyCommand } from '../../src/sim/build';
import { stressBand } from '../../src/sim/people';
import { hashWorld } from '../../src/sim/save';
import { LIMITS, ROOMS, SHAFTS, STARS } from '../../src/sim/rules';
import { tickMany } from '../../src/sim/tick';
import { clockOf } from '../../src/sim/types';
import { createWorld } from '../../src/sim/world';
import { averageStress, buildRow, buildTower, countRooms, countSims, lobbyRun, roomsMatching, simsOfKind } from './helpers';
import type { Command, World } from '../../src/sim/types';

const SEED = 777;
const LOBBY_FROM = 100;
const LOBBY_TO = 275;
const SHAFT_XS = [120, 250] as const;
const SHAFT_TOP = 15;
const CARS_PER_SHAFT = 4;
const OFFICE_FLOORS = [2, 3, 4, 5, 6, 7, 8, 9, 10];
const COMMERCE_FLOOR = 11;

/** Enough to build the tower once. See the file header. */
const CONSTRUCTION_BUDGET = 12_000_000;

/** Quarter boundaries: 05:00 on days 3, 6, 9 and 12. */
const QUARTER_MINUTES = [4620, 8940, 13260, 17580];

/** The minute just after a quarter start, so that the payout has been made. */
function afterQuarter(index: number): number {
  return (QUARTER_MINUTES[index] as number) + 1;
}

function shaftFootprints(): [number, number][] {
  return SHAFT_XS.map((x) => [x, x + SHAFTS.standard.width - 1] as [number, number]);
}

/** Pack rooms of a width across a span, stepping over the elevator footprints. */
function packRow(fromX: number, toX: number, width: number): number[] {
  const blocked = shaftFootprints();
  const out: number[] = [];
  let x = fromX;
  while (x + width - 1 <= toX) {
    const hit = blocked.find(([lo, hi]) => x + width - 1 >= lo && x <= hi);
    if (hit) {
      x = hit[1] + 1;
      continue;
    }
    out.push(x);
    x += width;
  }
  return out;
}

const OFFICE_XS = packRow(LOBBY_FROM, LOBBY_TO, ROOMS.office.width);

/** The lobby, both shafts with four cars each, offices on floors 2 to 10, lunch on 11. */
function growthTower(seed = SEED): World {
  const world = createWorld(seed);
  world.cash = CONSTRUCTION_BUDGET;

  const offices: Command[] = [];
  for (const floor of OFFICE_FLOORS) offices.push(...buildRow('office', floor, OFFICE_XS));

  buildTower(world, [
    ...lobbyRun(LOBBY_FROM, LOBBY_TO),
    ...SHAFT_XS.map((x) => ({ kind: 'shaft.build', shaft: 'standard', x, floorMin: 1, floorMax: SHAFT_TOP }) as Command),
    ...offices,
  ]);

  for (const shaft of world.shafts.values()) {
    for (let car = 1; car < CARS_PER_SHAFT; car++) {
      const added = applyCommand(world, { kind: 'shaft.addCar', shaftId: shaft.id });
      if (!added.ok) throw new Error(`Could not add a car to shaft ${shaft.id}: ${added.reason}`);
    }
  }

  // Somewhere to buy lunch. A fast food needs 1 star, so it goes up now.
  buildTower(world, [{ kind: 'build', room: 'fastFood', floor: COMMERCE_FLOOR, x: 130 }]);
  return world;
}

interface RunReport {
  peakPopulation: number;
  starTwoAt: string | null;
  /** Whether the log carried the milestone line at the hour the star was granted. */
  starTwoLogged: boolean;
  /** Cash immediately after each quarter start that ran, oldest first. */
  cashAfterQuarter: number[];
  quarterPayout: number[];
  /** Average stress of every sim at 09:00, latest weekday last. */
  weekdayNineStress: number[];
  /** The same sample over workers alone: see the visitor leak noted below. */
  weekdayNineWorkerStress: number[];
}

function emptyReport(): RunReport {
  return { peakPopulation: 0, starTwoAt: null, starTwoLogged: false, cashAfterQuarter: [], quarterPayout: [], weekdayNineStress: [], weekdayNineWorkerStress: [] };
}

/** Run to a minute, sampling population and stars every hour and cash at each quarter. */
function runTo(world: World, untilMinute: number, report: RunReport): void {
  while (world.time.minute < untilMinute) {
    const clock = clockOf(world.time.minute);
    const isQuarterStart = clock.dayOfQuarter === 0 && clock.minuteOfDay === 300;
    const cashBefore = world.cash;

    tickMany(world, 1);

    if (isQuarterStart) {
      report.cashAfterQuarter.push(world.cash);
      report.quarterPayout.push(world.cash - cashBefore);
    }
    const now = clockOf(world.time.minute);
    if (now.minuteOfDay % 60 === 0) {
      report.peakPopulation = Math.max(report.peakPopulation, world.population);
      if (report.starTwoAt === null && world.stars >= 2) {
        report.starTwoAt = `quarter ${now.quarter}, day ${Math.floor(world.time.minute / 1440)}, ${now.hour}:00`;
        // Checked here, not at the end: world.ts keeps the last 500 log entries and a
        // tower this size writes past that inside a day, so the line is gone by day 6.
        report.starTwoLogged = world.log.some((entry) => entry.text === 'Reached 2 stars.');
      }
      if (now.minuteOfDay === 9 * 60 && !now.isWeekend) {
        report.weekdayNineStress.push(averageStress([...world.sims.values()]));
        report.weekdayNineWorkerStress.push(averageStress(simsOfKind(world, 'worker')));
      }
    }
  }
}

/** Sims and rooms that contradict themselves. Every count must be zero. */
function inconsistencies(world: World): { ridingWithNoCar: number; inRoomWithNoRoom: number; negativeOccupancy: number } {
  let ridingWithNoCar = 0;
  let inRoomWithNoRoom = 0;
  let negativeOccupancy = 0;
  for (const sim of world.sims.values()) {
    if (sim.state === 'riding' && sim.inCarId === null) ridingWithNoCar += 1;
    if (sim.state === 'inRoom' && sim.inRoomId === null) inRoomWithNoRoom += 1;
  }
  for (const room of world.rooms.values()) if (room.occupancy < 0) negativeOccupancy += 1;
  return { ridingWithNoCar, inRoomWithNoRoom, negativeOccupancy };
}

describe('scenario: growth over two quarters', () => {
  it('leases nine floors, earns the second star and replays identically', { timeout: 120_000 }, () => {
    const started = performance.now();
    const world = growthTower();
    const spent = CONSTRUCTION_BUDGET - world.cash;

    expect(OFFICE_XS).toHaveLength(18);
    expect(countRooms(world, 'office')).toBe(OFFICE_XS.length * OFFICE_FLOORS.length);
    expect(countRooms(world, 'lobby')).toBe(LOBBY_TO - LOBBY_FROM + 1);
    expect(world.shafts.size).toBe(2);
    for (const shaft of world.shafts.values()) expect(shaft.cars).toHaveLength(CARS_PER_SHAFT);
    expect(spent).toBeGreaterThan(LIMITS.startingCash); // why the budget is staged

    // The shop on floor 11 is skipped: ROOMS.shop.star is 3 and this tower reaches 2.
    // The refusal is asserted so a change to the ladder or to the rule shows up here.
    const shop = applyCommand(world, { kind: 'build', room: 'shop', floor: COMMERCE_FLOOR, x: 150 });
    expect(shop).toEqual({ ok: false, reason: 'Needs 3 stars.' });
    expect(countRooms(world, 'fastFood')).toBe(1);

    const report = emptyReport();
    runTo(world, afterQuarter(1), report); // through the day 6 quarter start

    // Population and stars
    expect(report.peakPopulation).toBeGreaterThanOrEqual(STARS[2].population);
    expect(world.stars).toBeGreaterThanOrEqual(2);
    expect(report.starTwoAt).not.toBeNull();
    expect(report.starTwoLogged).toBe(true);

    // Rent: the second quarter closes richer than the first
    expect(report.quarterPayout).toHaveLength(2);
    expect(report.quarterPayout[1] as number).toBeGreaterThan(0);
    expect(report.cashAfterQuarter[1] as number).toBeGreaterThan(report.cashAfterQuarter[0] as number);

    // Consistency
    expect(inconsistencies(world)).toEqual({ ridingWithNoCar: 0, inRoomWithNoRoom: 0, negativeOccupancy: 0 });

    // Determinism: same seed, same script, same six days.
    const twin = growthTower();
    applyCommand(twin, { kind: 'build', room: 'shop', floor: COMMERCE_FLOOR, x: 150 });
    runTo(twin, afterQuarter(1), emptyReport());
    expect(hashWorld(twin)).toBe(hashWorld(world));

    console.log(
      [
        `Growth: ${countRooms(world, 'office')} offices built for $${spent.toLocaleString('en-US')}.`,
        `Peak population ${report.peakPopulation}, second star at ${report.starTwoAt}.`,
        `Quarter payouts $${(report.quarterPayout[0] as number).toLocaleString('en-US')} then $${(report.quarterPayout[1] as number).toLocaleString('en-US')},`,
        `cash after each $${(report.cashAfterQuarter[0] as number).toLocaleString('en-US')} then $${(report.cashAfterQuarter[1] as number).toLocaleString('en-US')}.`,
        `Two runs of two quarters took ${(performance.now() - started).toFixed(0)} ms.`,
      ].join(' '),
    );
  });

  // BUG: sim/people.ts. A visitor who needs an elevator to get out is never removed from
  // the world; it parks at the entrance in state 'outside' and stays there for good.
  // people.ts records "on my way out" only in sim.state ('leaving'), and boarding then
  // alighting overwrite it ('waiting', 'riding', and finally 'walking' when elevators.ts
  // puts the sim down), so arriveWithoutRoom cannot tell a departing sim from an arriving
  // one and falls through to state 'outside' instead of calling finishLeave.
  // Evidence, traced from one diner leaving a floor 2 fast food:
  //   12:26 riding  floor=2 route=ride>walk   (state was 'leaving' one tick earlier)
  //   12:28 walking floor=1 route=walk
  //   12:29 outside floor=1 x=100 route=[]    and it is still there six days later.
  // In the growth run above this leaves 1,098 stale diners in world.sims after two
  // quarters, all of them walked by tickPeople every minute for the rest of the game.
  // Visitors who leave from the floor they arrived on are removed correctly.
  it('removes a visitor who rides an elevator on the way out', { timeout: 30_000 }, () => {
    const world = createWorld(SEED);
    world.cash = CONSTRUCTION_BUDGET;
    buildTower(world, [
      ...lobbyRun(LOBBY_FROM, LOBBY_TO),
      { kind: 'shaft.build', shaft: 'standard', x: SHAFT_XS[0], floorMin: 1, floorMax: SHAFT_TOP },
      { kind: 'build', room: 'fastFood', floor: 2, x: 130 },
    ]);

    // Through lunch and well past the 50 minute sitting, into the afternoon.
    tickMany(world, 10 * 60);

    expect(clockOf(world.time.minute).hour).toBe(16);
    expect(roomsMatching(world, 'fastFood')[0]?.occupancy).toBe(0);
    expect(countSims(world, 'diner')).toBe(0);
  });
});

describe('report: reaching for the third star', () => {
  it('adds security, a hotel floor and two more quarters', { timeout: 180_000 }, () => {
    const started = performance.now();
    const world = growthTower();
    const phaseOne = emptyReport();
    runTo(world, afterQuarter(1), phaseOne);

    // Staged: a security office needs 2 stars. The tower has earned them by now, but the
    // star is set explicitly so the build cannot depend on the hour the test runs at.
    world.stars = 2;
    world.cash += CONSTRUCTION_BUDGET;

    buildTower(world, [
      { kind: 'build', room: 'security', floor: 12, x: 130 },
      { kind: 'build', room: 'housekeeping', floor: 13, x: 130 },
      ...buildRow('hotelSingle', 13, packRow(150, 260, ROOMS.hotelSingle.width).slice(0, 12)),
    ]);
    expect(countRooms(world, 'hotelSingle')).toBe(12);
    expect(countRooms(world, 'security')).toBe(1);

    const phaseTwo = emptyReport();
    runTo(world, afterQuarter(3), phaseTwo);
    const elapsed = performance.now() - started;

    const lastNine = phaseTwo.weekdayNineStress[phaseTwo.weekdayNineStress.length - 1] as number;
    const lastNineWorkers = phaseTwo.weekdayNineWorkerStress[phaseTwo.weekdayNineWorkerStress.length - 1] as number;
    const bands: Record<string, number> = { calm: 0, pink: 0, red: 0 };
    for (const sim of world.sims.values()) bands[stressBand(sim.stress)] = (bands[stressBand(sim.stress)] ?? 0) + 1;

    console.log(
      [
        `Three star attempt: population ${world.population} (peak ${Math.max(phaseOne.peakPopulation, phaseTwo.peakPopulation)}),`,
        `stars reached ${world.stars} of 3, which wants ${STARS[3].population.toLocaleString('en-US')} people and a security office.`,
        `Average stress at 09:00 on the last weekday: ${lastNine.toFixed(3)} over every sim,`,
        `${lastNineWorkers.toFixed(3)} over workers alone (the all sim figure is diluted by the stale visitors noted above).`,
        `${world.sims.size} sims at the close`,
        `(${bands.calm} calm, ${bands.pink} pink, ${bands.red} red at the close).`,
        `Hotel rooms occupied at the close: ${countRooms(world, 'hotelSingle', { occupied: true })} of 12.`,
        `Four quarters (${world.time.minute - 360} ticks) took ${elapsed.toFixed(0)} ms.`,
      ].join(' '),
    );

    // Reported, not asserted, beyond the sanity that the run completed.
    expect(world.gameOver).toBeNull();
    expect(phaseTwo.quarterPayout).toHaveLength(2);
  });
});
