import { beforeEach, describe, expect, it } from 'vitest';
import {
  EVENT_TEST_HOOKS,
  handleEventCommand,
  hooksActive,
  startFire,
  resetEventTestHooks,
  tickEvents,
  vipRatingOf,
  vipSuiteBand,
  vipWaitBand,
} from '../../src/sim/events';
import { personName, vipArrivalHour, vipPreference } from '../../src/sim/identity';
import { EVAL, EVENTS, ROOMS } from '../../src/sim/rules';
import { deserialize, serialize } from '../../src/sim/save';
import type { ActiveEvent, Room, RoomKind, Star, World } from '../../src/sim/types';
import { tick, tickMany } from '../../src/sim/tick';
import { addRoom, allocId, createWorld } from '../../src/sim/world';
import { buildTower, lobbyRun } from '../scenarios/helpers';

// Rooms are built by hand per the brief: build.ts belongs to another agent.
function place(world: World, kind: RoomKind, floor: number, x: number, extra: Partial<Room> = {}): Room {
  const rule = ROOMS[kind];
  const room: Room = {
    id: allocId(world),
    kind,
    floor,
    x,
    width: rule.width,
    height: rule.height,
    eval: 1,
    tenants: [],
    occupancy: 0,
    builtAtMinute: world.time.minute,
    vacant: false,
    dirty: false,
    infested: false,
    lowEvalSinceMinute: null,
    onFire: false,
    rent: 100,
    ...extra,
  };
  addRoom(world, room);
  return room;
}

function at(world: World, minute: number): void {
  world.time.minute = minute;
  tickEvents(world);
}

function eventOf<K extends ActiveEvent['kind']>(world: World, kind: K): Extract<ActiveEvent, { kind: K }> | undefined {
  return world.events.find((e) => e.kind === kind) as Extract<ActiveEvent, { kind: K }> | undefined;
}

const ROLL_MINUTE = 6 * 60; // the scheduler rolls once a day at 06:00

let world: World;
beforeEach(() => {
  resetEventTestHooks();
  world = createWorld(4242);
  place(world, 'lobby', 1, 100);
  // Chance is forced through EVENT_TEST_HOOKS so the tests do not depend on
  // finding a seed that happens to roll a 1 in 100 fire on the right day.
  EVENT_TEST_HOOKS.chance = { fire: 0, bomb: 0, vip: 0 };
});

describe('fire', () => {
  function burnableTower(stars: Star, withSecurity: boolean): Room {
    world.stars = stars;
    const office = place(world, 'office', 2, 100);
    if (withSecurity) place(world, 'security', 1, 200);
    EVENT_TEST_HOOKS.chance.fire = 1;
    EVENT_TEST_HOOKS.target.fire = office.id;
    return office;
  }

  it('does not start below the minimum star', () => {
    const office = burnableTower(1, false);
    at(world, ROLL_MINUTE);
    expect(eventOf(world, 'fire')).toBeUndefined();
    expect(office.onFire).toBe(false);
  });

  it('starts at the minimum star and says so in plain English', () => {
    const office = burnableTower(EVENTS.fire.minStar, false);
    at(world, ROLL_MINUTE);
    expect(office.onFire).toBe(true);
    expect(eventOf(world, 'fire')?.roomIds).toEqual([office.id]);
    const entry = world.log.at(-2);
    expect(entry?.level).toBe('alert');
    expect(entry?.text).toBe('Fire broke out in the office on floor 2. Call a helicopter or wait for security.');
    expect(world.log.at(-1)?.text).toBe('People are waiting outside until the fire is out.');
  });

  it('does not spread before the spread interval', () => {
    burnableTower(EVENTS.fire.minStar, false);
    const neighbor = place(world, 'office', 2, 109);
    at(world, ROLL_MINUTE);
    at(world, ROLL_MINUTE + EVENTS.fire.spreadMinutes - 1);
    expect(neighbor.onFire).toBe(false);
  });

  it('spreads to the room next door at the spread interval', () => {
    burnableTower(EVENTS.fire.minStar, false);
    const neighbor = place(world, 'office', 2, 109);
    at(world, ROLL_MINUTE);
    at(world, ROLL_MINUTE + EVENTS.fire.spreadMinutes);
    expect(neighbor.onFire).toBe(true);
    expect(eventOf(world, 'fire')?.roomIds).toHaveLength(2);
    expect(world.log.some((e) => e.text === 'The fire spread to the office on floor 2.')).toBe(true);
  });

  it('a security office puts it out after the per room delay, and the burned room is gone', () => {
    const office = burnableTower(EVENTS.fire.minStar, true);
    at(world, ROLL_MINUTE);
    const cashBefore = world.cash;
    at(world, ROLL_MINUTE + EVENTS.fire.securityPutOutMinutes - 1);
    expect(eventOf(world, 'fire')).toBeDefined();
    at(world, ROLL_MINUTE + EVENTS.fire.securityPutOutMinutes);
    expect(eventOf(world, 'fire')).toBeUndefined();
    expect(world.rooms.has(office.id)).toBe(false);
    expect(cashBefore - world.cash).toBe(EVENTS.fire.damagePerRoom);
    expect(world.log.at(-1)?.text).toContain('Security put the fire out');
  });

  it('the helicopter ends the fire and charges for the flight and the damage', () => {
    const office = burnableTower(EVENTS.fire.minStar, false);
    at(world, ROLL_MINUTE);
    const cashBefore = world.cash;
    expect(handleEventCommand(world, { kind: 'fire.callHelicopter' })).toEqual({ ok: true });
    expect(cashBefore - world.cash).toBe(EVENTS.fire.helicopterCost + EVENTS.fire.damagePerRoom);
    expect(world.rooms.has(office.id)).toBe(false);
    expect(eventOf(world, 'fire')).toBeUndefined();
  });

  it('calling a helicopter with nothing burning is refused in plain English', () => {
    const result = handleEventCommand(world, { kind: 'fire.callHelicopter' });
    expect(result).toEqual({ ok: false, reason: 'There is no fire right now.' });
  });
});

describe('fire: nobody walks into a burning building', () => {
  const WAITING = 'People are waiting outside until the fire is out.';
  const HELD = new Set(['worker', 'resident', 'guest', 'shopper', 'diner', 'visitor']);

  /** A lobby, one shaft to floor 3, a vacant office on floor 2, a fast food on floor 1, and a condo to burn. */
  function tower(): { office: Room; condo: Room } {
    world.stars = 2;
    world.cash = 10_000_000;
    buildTower(world, [
      ...lobbyRun(101, 140),
      { kind: 'shaft.build', shaft: 'standard', x: 120, floorMin: 1, floorMax: 3 },
      { kind: 'build', room: 'office', floor: 2, x: 100 },
    ]);
    const office = [...world.rooms.values()].find((r) => r.kind === 'office') as Room;
    place(world, 'fastFood', 3, 124);
    const condo = place(world, 'condo', 3, 300);
    return { office, condo };
  }

  function entered(): number {
    let count = 0;
    for (const sim of world.sims.values()) if (HELD.has(sim.kind) && sim.state !== 'outside') count += 1;
    return count;
  }

  it('holds every arrival outside while the fire burns, says so once, and lets them in after', () => {
    const { office, condo } = tower();
    EVENT_TEST_HOOKS.chance.fire = 1;
    EVENT_TEST_HOOKS.target.fire = condo.id;
    tick(world); // 06:00, the daily roll: the condo catches fire
    EVENT_TEST_HOOKS.chance.fire = 0;
    expect(condo.onFire).toBe(true);
    expect(world.log.filter((e) => e.text === WAITING)).toHaveLength(1);

    tickMany(world, 6 * 60); // to 12:00: the office leases, the lunch crowd would be arriving
    expect(eventOf(world, 'fire')).toBeDefined();
    expect(office.vacant).toBe(false);
    expect(office.tenants.length).toBeGreaterThan(0);
    expect(entered()).toBe(0);
    expect(office.occupancy).toBe(0);
    expect(world.log.filter((e) => e.text === WAITING)).toHaveLength(1);

    expect(handleEventCommand(world, { kind: 'fire.callHelicopter' }).ok).toBe(true);
    expect(eventOf(world, 'fire')).toBeUndefined();
    tickMany(world, 30);
    expect(entered()).toBeGreaterThan(0);
    expect(office.occupancy).toBeGreaterThan(0);
  });

  it('sends the people in a room that catches fire out toward the street', () => {
    const { office } = tower();
    tickMany(world, 4 * 60); // to 10:00, the workers are at their desks
    expect(office.occupancy).toBeGreaterThan(0);
    EVENT_TEST_HOOKS.target.fire = office.id;
    startFire(world);
    tick(world);
    expect(office.occupancy).toBe(0);
    for (const id of office.tenants) {
      const sim = world.sims.get(id);
      expect(sim?.inRoomId).toBeNull();
    }
    tickMany(world, 20);
    expect(office.occupancy).toBe(0);
  });
});

describe('bomb', () => {
  function threatenedTower(stars: Star, withSecurity: boolean): Room {
    world.stars = stars;
    const office = place(world, 'office', 2, 100);
    if (withSecurity) place(world, 'security', 1, 200);
    EVENT_TEST_HOOKS.chance.bomb = 1;
    EVENT_TEST_HOOKS.target.bomb = office.id;
    return office;
  }

  it('does not start below the minimum star', () => {
    threatenedTower(2, false);
    at(world, ROLL_MINUTE);
    expect(eventOf(world, 'bomb')).toBeUndefined();
  });

  it('starts at the minimum star and names the ransom', () => {
    threatenedTower(EVENTS.bomb.minStar, false);
    at(world, ROLL_MINUTE);
    const bomb = eventOf(world, 'bomb');
    expect(bomb?.ransom).toBe(EVENTS.bomb.ransom);
    expect(bomb?.detonateAt).toBe(EVENTS.bomb.detonateAtMinuteOfDay);
    expect(world.log.at(-1)?.level).toBe('alert');
    expect(world.log.at(-1)?.text).toContain('$500,000 ransom');
  });

  it('paying the ransom charges cash and ends the threat', () => {
    threatenedTower(EVENTS.bomb.minStar, false);
    at(world, ROLL_MINUTE);
    const cashBefore = world.cash;
    expect(handleEventCommand(world, { kind: 'bomb.pay' })).toEqual({ ok: true });
    expect(cashBefore - world.cash).toBe(EVENTS.bomb.ransom);
    expect(eventOf(world, 'bomb')).toBeUndefined();
    expect(world.rooms.size).toBe(2);
  });

  it('paying with no threat outstanding is refused in plain English', () => {
    expect(handleEventCommand(world, { kind: 'bomb.pay' })).toEqual({
      ok: false,
      reason: 'There is no bomb threat right now.',
    });
  });

  it('security finds the bomb after searching every built floor', () => {
    threatenedTower(EVENTS.bomb.minStar, true);
    at(world, ROLL_MINUTE);
    const floors = world.floorIndex.builtFloors.size;
    const foundAt = ROLL_MINUTE + floors * EVENTS.bomb.securitySearchMinutesPerFloor;
    at(world, foundAt - 1);
    expect(eventOf(world, 'bomb')).toBeDefined();
    const cashBefore = world.cash;
    at(world, foundAt);
    expect(eventOf(world, 'bomb')).toBeUndefined();
    expect(world.cash).toBe(cashBefore);
    expect(world.log.at(-1)?.text).toContain('Security found the bomb');
  });

  it('with no security it goes off at the set hour and takes rooms and cash with it', () => {
    threatenedTower(EVENTS.bomb.minStar, false);
    place(world, 'office', 2, 109);
    place(world, 'office', 2, 118);
    place(world, 'office', 2, 127);
    at(world, ROLL_MINUTE);
    const roomsBefore = world.rooms.size;
    const cashBefore = world.cash;
    at(world, EVENTS.bomb.detonateAtMinuteOfDay - 1);
    expect(eventOf(world, 'bomb')).toBeDefined();
    at(world, EVENTS.bomb.detonateAtMinuteOfDay);
    expect(roomsBefore - world.rooms.size).toBe(EVENTS.bomb.damageRooms);
    expect(cashBefore - world.cash).toBe(EVENTS.bomb.damageCash);
    expect(eventOf(world, 'bomb')).toBeUndefined();
    expect(world.log.at(-1)?.level).toBe('alert');
  });
});

describe('VIP', () => {
  function visitedTower(): Room {
    world.stars = EVENTS.vip.minStar;
    EVENT_TEST_HOOKS.chance.vip = 1;
    return place(world, 'hotelSuite', 5, 200);
  }

  it('books a vip sim into a free suite, named, with a preference, and holds the suite', () => {
    const suite = visitedTower();
    at(world, ROLL_MINUTE);
    const visit = eventOf(world, 'vip') as Extract<ActiveEvent, { kind: 'vip' }>;
    expect(visit.suiteId).toBe(suite.id);
    expect(visit.phase).toBe('notice');
    expect(visit.preference).toBe(vipPreference(world.seed, visit.simId));
    const sim = world.sims.get(visit.simId);
    expect(sim?.kind).toBe('vip');
    expect(sim?.state).toBe('outside');
    expect(suite.tenants).toEqual([sim?.id]);
    expect(world.log.at(-1)?.text).toBe(
      `A VIP, ${personName(world.seed, visit.simId)}, is coming to the suite on floor 5 tomorrow. They care most about ${visit.preference}.`,
    );
  });

  it('no longer places the vip straight into the suite: with no way up the visit ends with the reason', () => {
    const suite = visitedTower();
    at(world, ROLL_MINUTE);
    const visit = eventOf(world, 'vip') as Extract<ActiveEvent, { kind: 'vip' }>;
    // The day after the notice, on the hour the VIP's identity picks between 08:00 and 17:00.
    const hour = vipArrivalHour(world.seed, visit.simId);
    expect(hour).toBeGreaterThanOrEqual(EVENTS.vip.arrivalHours.first);
    expect(hour).toBeLessThanOrEqual(EVENTS.vip.arrivalHours.last);
    expect(visit.arrivesAt).toBe(EVENTS.vip.noticeDays * 1440 + hour * 60);
    at(world, visit.arrivesAt);
    expect(world.sims.has(visit.simId)).toBe(false);
    expect(suite.occupancy).toBe(0);
    expect(suite.tenants).toEqual([]);
    expect(eventOf(world, 'vip')).toBeUndefined();
    expect(world.stats.vipRating).toBe('poor');
    expect(world.log.at(-1)?.text).toBe('The VIP left: no way up to floor 5.');
  });

  it('bands the wait on the VIP rules', () => {
    expect(vipWaitBand(0)).toBe('good');
    expect(vipWaitBand(EVENTS.vip.goodMaxWaitMinutes)).toBe('good');
    expect(vipWaitBand(EVENTS.vip.goodMaxWaitMinutes + 1)).toBe('fair');
    expect(vipWaitBand(EVENTS.vip.fairMaxWaitMinutes)).toBe('fair');
    expect(vipWaitBand(EVENTS.vip.fairMaxWaitMinutes + 1)).toBe('poor');
  });

  it('rates the lowest of the wait, suite and safety bands', () => {
    const clean = { longestWait: 1, checkInClean: true, checkInEval: 1, incident: false };
    expect(vipRatingOf(clean)).toBe('good');
    expect(vipRatingOf({ ...clean, longestWait: 5 })).toBe('fair');
    expect(vipRatingOf({ ...clean, checkInClean: false })).toBe('poor');
    expect(vipRatingOf({ ...clean, checkInEval: EVAL.leaveThreshold - 0.01 })).toBe('fair');
    expect(vipRatingOf({ ...clean, incident: true })).toBe('poor');
    expect(vipSuiteBand(null, null)).toBe('good');
  });

  it('does not visit when every suite is taken', () => {
    world.stars = EVENTS.vip.minStar;
    EVENT_TEST_HOOKS.chance.vip = 1;
    place(world, 'hotelSuite', 5, 200, { tenants: [999] });
    at(world, ROLL_MINUTE);
    expect(eventOf(world, 'vip')).toBeUndefined();
  });
});

describe('cockroaches', () => {
  it('leave a dirty room alone until the infestation delay is up', () => {
    const room = place(world, 'hotelSingle', 3, 100, { dirty: true, dirtySinceMinute: 0 });
    for (let day = 0; day < EVENTS.cockroaches.dirtyDaysBeforeInfested; day++) {
      at(world, ROLL_MINUTE + day * 1440);
    }
    expect(room.infested).toBe(false);
  });

  it('infest a room that stayed dirty for the full delay', () => {
    const room = place(world, 'hotelSingle', 3, 100, { dirty: true, dirtySinceMinute: 0 });
    for (let day = 0; day <= EVENTS.cockroaches.dirtyDaysBeforeInfested; day++) {
      at(world, ROLL_MINUTE + day * 1440);
    }
    expect(room.infested).toBe(true);
    expect(world.log.at(-1)?.text).toBe('Cockroaches moved into the single room on floor 3.');
  });

  it('spread to the room next door after the spread delay', () => {
    place(world, 'hotelSingle', 3, 100, { dirty: true, dirtySinceMinute: 0 });
    const neighbor = place(world, 'hotelSingle', 3, 104);
    const infestedDay = EVENTS.cockroaches.dirtyDaysBeforeInfested;
    const spreadDay = infestedDay + EVENTS.cockroaches.spreadDays;
    for (let day = 0; day < spreadDay; day++) at(world, ROLL_MINUTE + day * 1440);
    expect(neighbor.infested).toBe(false);
    at(world, ROLL_MINUTE + spreadDay * 1440);
    expect(neighbor.infested).toBe(true);
  });

  it('housekeeping cleaning the room clears the cockroaches', () => {
    const room = place(world, 'hotelSingle', 3, 100, { dirty: true, dirtySinceMinute: 0 });
    for (let day = 0; day <= EVENTS.cockroaches.dirtyDaysBeforeInfested; day++) {
      at(world, ROLL_MINUTE + day * 1440);
    }
    room.dirty = false;
    at(world, ROLL_MINUTE + (EVENTS.cockroaches.dirtyDaysBeforeInfested + 1) * 1440);
    expect(room.infested).toBe(false);
  });

  it('keeps the infestation countdown across a save and load', () => {
    place(world, 'hotelSingle', 3, 100, { dirty: true, dirtySinceMinute: world.time.minute });
    at(world, ROLL_MINUTE + 1440); // one tick so the countdown is on record, room still not infested

    const saved = serialize(world);
    const result = deserialize(saved);
    if (!result.ok) throw new Error(result.reason);
    const loaded = result.world;
    const loadedRoom = [...loaded.rooms.values()].find((r) => r.kind === 'hotelSingle');
    if (!loadedRoom) throw new Error('hotel room missing after load');
    expect(loadedRoom.dirtySinceMinute).toBe(ROLL_MINUTE);

    for (let day = 1; day <= EVENTS.cockroaches.dirtyDaysBeforeInfested + 1; day++) {
      loaded.time.minute = ROLL_MINUTE + day * 1440;
      tickEvents(loaded);
    }

    expect(loadedRoom.infested).toBe(true);
  });
});

describe('wedding', () => {
  const WEEKEND_NOON = 2 * 1440 + EVENTS.wedding.weekendMinuteOfDay;

  it('needs a cathedral, even at five stars', () => {
    world.stars = 5;
    at(world, WEEKEND_NOON);
    expect(eventOf(world, 'wedding')).toBeUndefined();
  });

  it('runs at weekend noon and counts once it is over', () => {
    world.stars = 5;
    place(world, 'cathedral', 10, 200);
    at(world, WEEKEND_NOON);
    expect(eventOf(world, 'wedding')).toBeDefined();
    at(world, WEEKEND_NOON + EVENTS.wedding.durationMinutes - 1);
    expect(world.stats.weddingsHeld).toBe(0);
    at(world, WEEKEND_NOON + EVENTS.wedding.durationMinutes);
    expect(world.stats.weddingsHeld).toBe(1);
    expect(eventOf(world, 'wedding')).toBeUndefined();
    expect(world.log.at(-1)?.text).toBe('The wedding is over and the guests have left.');
  });
});

describe('Santa', () => {
  const YEAR_END_EVENING = 11 * 1440 + EVENTS.santa.minuteOfDay;

  it('flies past on the last evening of the year and sweeps across the tower', () => {
    at(world, YEAR_END_EVENING - 1);
    expect(eventOf(world, 'santa')).toBeUndefined();
    at(world, YEAR_END_EVENING);
    expect(eventOf(world, 'santa')?.x).toBe(EVENTS.santa.tilesPerMinute);
    at(world, YEAR_END_EVENING + 1);
    expect(eventOf(world, 'santa')?.x).toBe(EVENTS.santa.tilesPerMinute * 2);
  });

  it('is gone once it has crossed the whole tower', () => {
    at(world, YEAR_END_EVENING);
    for (let i = 1; i <= 400 / EVENTS.santa.tilesPerMinute; i++) at(world, YEAR_END_EVENING + i);
    expect(eventOf(world, 'santa')).toBeUndefined();
    expect(world.log.at(-1)?.text).toBe('Santa has gone. Happy new year.');
  });
});

describe('the event log', () => {
  it('only ever writes alert or info lines', () => {
    world.stars = EVENTS.bomb.minStar;
    const office = place(world, 'office', 2, 100);
    place(world, 'hotelSuite', 5, 200);
    EVENT_TEST_HOOKS.chance = { fire: 1, bomb: 1, vip: 1 };
    EVENT_TEST_HOOKS.target.fire = office.id;
    EVENT_TEST_HOOKS.target.bomb = office.id;
    at(world, ROLL_MINUTE);
    at(world, EVENTS.bomb.detonateAtMinuteOfDay);
    expect(world.log.length).toBeGreaterThan(3);
    for (const entry of world.log) expect(['alert', 'info']).toContain(entry.level);
  });
});

describe('EVENT_TEST_HOOKS gating', () => {
  // The hooks export ships in the production bundle (this file imports it
  // directly), but every read of it in events.ts is gated behind
  // hooksActive(), which is only true when import.meta.env.MODE === 'test'.
  // Vite sets MODE to 'test' under vitest and to 'production' in a built
  // bundle, so forcing EVENT_TEST_HOOKS from outside the sim has no effect
  // outside of tests. Forcing MODE itself is not practical inside vitest
  // (it is set once for the whole run), so this checks the seam directly.
  it('is active under vitest', () => {
    expect(hooksActive()).toBe(true);
  });
});
