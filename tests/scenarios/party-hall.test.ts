// A party hall is paid once per party (game readiness review 2026-10-01, F7). Every guest who
// walked in used to credit ECONOMY.partyHallIncomePerEvent, so a full house of 50 paid fifty
// times over. Now the hall is paid once, in the tick the crowd is booked, and a party nobody
// comes to pays nothing. No saved field: booking and payment happen in the same tick.

import { describe, expect, it } from 'vitest';

import { ECONOMY, ROOMS, SCHEDULES } from '../../src/sim/rules';
import { deserialize, serialize } from '../../src/sim/save';
import { tick } from '../../src/sim/tick';
import { clockOf } from '../../src/sim/types';
import type { Room, Sim, World } from '../../src/sim/types';
import { addSim, allocId, createWorld, setOccupancy } from '../../src/sim/world';
import { atOnDay, buildTower, lobbyRun, roomsMatching } from './helpers';

const PAY = ECONOMY.partyHallIncomePerEvent;

function partyTower(halls: number): World {
  const world = createWorld(77);
  world.cash = 50_000_000;
  world.stars = 3;
  buildTower(world, [
    ...lobbyRun(0, 200),
    { kind: 'shaft.build', shaft: 'standard', x: 190, floorMin: 1, floorMax: 3 },
    ...Array.from({ length: halls }, (_, i) => ({ kind: 'build' as const, room: 'partyHall' as const, floor: 2, x: i * 25 })),
  ]);
  return world;
}

/**
 * Seeded by hand: `count` guests already inside the hall and staying past the party, so the
 * crowd the party books is the seats left over (people.ts spawnShowAudiences).
 */
function seatGuests(world: World, hall: Room, count: number): void {
  for (let i = 0; i < count; i++) {
    const sim: Sim = {
      id: allocId(world),
      kind: 'visitor',
      homeRoomId: null,
      pos: { floor: hall.floor, x: hall.x + 1 },
      inCarId: null,
      inRoomId: hall.id,
      route: [],
      state: 'inRoom',
      stress: 0,
      waitStart: null,
      schedule: [],
      nextScheduleIndex: 0,
      stayUntil: world.time.minute + 6 * 60,
      wallet: 0,
      leaveReason: null,
    };
    addSim(world, sim);
  }
  setOccupancy(world, hall, hall.occupancy + count);
}

function partyIncome(world: World): number {
  return world.stats.incomeByKind.partyHall ?? 0;
}

interface PartyRun {
  world: World;
  paid: number;
  paidAtStart: number;
  peakInside: number;
}

/** From 11:59 on a weekend day through the end of the party; optionally saved and reloaded `reloadAfter` minutes in. */
function throughParty(world: World, day: number, opts: { seated?: number; reloadAfter?: number } = {}): PartyRun {
  atOnDay(world, day, 11, 59);
  expect(clockOf(world.time.minute + 1).isWeekend).toBe(true);
  const halls = roomsMatching(world, 'partyHall');
  if (opts.seated) for (const hall of halls) seatGuests(world, hall, opts.seated);
  const before = partyIncome(world);
  let w = world;
  let paidAtStart = 0;
  let peakInside = 0;
  const minutes = SCHEDULES.partyHall.durationMinutes + 60;
  for (let i = 0; i < minutes; i++) {
    if (opts.reloadAfter !== undefined && i === opts.reloadAfter) {
      const loaded = deserialize(serialize(w));
      if (!loaded.ok) throw new Error(loaded.reason);
      w = loaded.world;
    }
    const ranAt = clockOf(w.time.minute).minuteOfDay;
    tick(w);
    if (ranAt === SCHEDULES.partyHall.weekendStart) paidAtStart = partyIncome(w) - before;
    let inside = 0;
    for (const hall of roomsMatching(w, 'partyHall')) inside += hall.occupancy;
    peakInside = Math.max(peakInside, inside);
  }
  return { world: w, paid: partyIncome(w) - before, paidAtStart, peakInside };
}

describe('party hall pay', () => {
  it('a full house of 50 pays the party fee once, in the minute the crowd is booked', () => {
    const run = throughParty(partyTower(1), 2);
    expect(run.peakInside).toBe(ROOMS.partyHall.capacity);
    expect(run.paidAtStart).toBe(PAY);
    expect(run.paid).toBe(PAY);
  });

  it('a crowd of 25 and a crowd of 1 pay the same single fee', () => {
    for (const seated of [25, 49]) {
      const run = throughParty(partyTower(1), 2, { seated });
      const crowd = ROOMS.partyHall.capacity - seated;
      // The crowd really comes in: the hall fills to every seat.
      expect(run.peakInside).toBe(ROOMS.partyHall.capacity);
      expect(run.paidAtStart).toBe(PAY);
      expect(run.paid).toBe(PAY);
      expect(crowd).toBeGreaterThan(0);
    }
  });

  it('a party with no seat left for a crowd books nobody and pays nothing', () => {
    const run = throughParty(partyTower(1), 2, { seated: ROOMS.partyHall.capacity });
    expect(run.paid).toBe(0);
  });

  it('each later party pays once more', () => {
    const world = partyTower(1);
    let w = world;
    for (const day of [2, 5, 8]) {
      const run = throughParty(w, day);
      expect(run.paid).toBe(PAY);
      w = run.world;
    }
  });

  it('a save and reload in the middle of a party does not pay it again', () => {
    for (const reloadAfter of [1, 5, 30, 120]) {
      const run = throughParty(partyTower(1), 2, { reloadAfter });
      expect(run.peakInside).toBe(ROOMS.partyHall.capacity);
      expect(run.paid).toBe(PAY);
    }
  });

  it('four halls pay four fees', () => {
    const run = throughParty(partyTower(4), 2);
    expect(run.peakInside).toBe(4 * ROOMS.partyHall.capacity);
    expect(run.paid).toBe(4 * PAY);
  });
});
