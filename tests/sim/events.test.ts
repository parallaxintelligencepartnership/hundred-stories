import { beforeEach, describe, expect, it } from 'vitest';
import {
  EVENT_TEST_HOOKS,
  formatDollars,
  handleEventCommand,
  helicopterCost,
  hooksActive,
  startBomb,
  startFire,
  startTheft,
  startVip,
  resetEventTestHooks,
  tickEvents,
  vipRatingOf,
  vipSuiteBand,
  vipWaitBand,
} from '../../src/sim/events';
import { personName, vipArrivalHour, vipPreference } from '../../src/sim/identity';
import { EVAL, EVENTS, ROOMS, SCHEDULES, THEFT } from '../../src/sim/rules';
import { onQuarterStart } from '../../src/sim/economy';
import { deserialize, hashWorld, serialize } from '../../src/sim/save';
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
    // No security office: the line says how the fire ends on its own (review A-7).
    expect(entry?.text).toBe('Fire broke out in the office on floor 2. Call a helicopter. It burns itself out in about 3 hours.');
    expect(world.log.at(-1)?.text).toBe('People are waiting outside until the fire is out.');
  });

  it('with a security office on duty the start line still says to wait for security', () => {
    burnableTower(EVENTS.fire.minStar, true);
    at(world, ROLL_MINUTE);
    expect(world.log.at(-2)?.text).toBe('Fire broke out in the office on floor 2. Call a helicopter or wait for security.');
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

  // Audit 2026-09-25 I S2: a refused command leaves the world as it was; the helicopter
  // the tower cannot afford was never checked for cash or hash.
  it('I S2: a helicopter the tower cannot afford is refused and changes neither cash nor hash', () => {
    const office = place(world, 'office', 2, 100);
    EVENT_TEST_HOOKS.target.fire = office.id;
    startFire(world);
    expect(office.onFire).toBe(true);
    world.cash = 1_000;
    const hash = hashWorld(world);
    const fire = eventOf(world, 'fire');
    if (!fire) throw new Error('no fire');
    expect(handleEventCommand(world, { kind: 'fire.callHelicopter' })).toEqual({
      ok: false,
      reason: `Not enough cash. A firefighting helicopter costs ${formatDollars(helicopterCost(world, fire))}.`,
    });
    expect(world.cash).toBe(1_000);
    expect(hashWorld(world)).toBe(hash);
    expect(eventOf(world, 'fire')).toBeDefined();
  });
});

describe('fire: bounded and billed (review 2026-09-28 C1, I2, I4)', () => {
  function startedFire(): Extract<ActiveEvent, { kind: 'fire' }> {
    const fire = eventOf(world, 'fire');
    if (!fire) throw new Error('no fire');
    return fire;
  }

  it('a rolled fire never starts in a lobby, sky lobby, stairs or escalator', () => {
    world.stars = 3;
    for (let x = 101; x < 160; x++) place(world, 'lobby', 1, x);
    place(world, 'stairs', 1, 170);
    place(world, 'escalator', 1, 180);
    place(world, 'skyLobby', 15, 100);
    const office = place(world, 'office', 2, 100);
    EVENT_TEST_HOOKS.chance.fire = 1;
    at(world, ROLL_MINUTE);
    expect(startedFire().roomIds).toEqual([office.id]);
  });

  it('with only structure rooms there is no fire, rolled or forced', () => {
    world.stars = 3;
    const lobby = place(world, 'lobby', 1, 101);
    EVENT_TEST_HOOKS.chance.fire = 1;
    at(world, ROLL_MINUTE);
    expect(eventOf(world, 'fire')).toBeUndefined();
    EVENT_TEST_HOOKS.target.fire = lobby.id;
    startFire(world);
    expect(eventOf(world, 'fire')).toBeUndefined();
    expect(lobby.onFire).toBe(false);
  });

  it('never spreads into a lobby segment next door, but still spreads to the office', () => {
    world.stars = 2;
    const lobby = place(world, 'lobby', 2, 99);
    const office = place(world, 'office', 2, 100);
    const neighbor = place(world, 'office', 2, 109);
    EVENT_TEST_HOOKS.target.fire = office.id;
    startFire(world);
    const t0 = world.time.minute;
    at(world, t0 + EVENTS.fire.spreadMinutes);
    at(world, t0 + 2 * EVENTS.fire.spreadMinutes);
    expect(neighbor.onFire).toBe(true);
    expect(lobby.onFire).toBe(false);
    expect(startedFire().roomIds).not.toContain(lobby.id);
  });

  it('security puts it out securityPutOutMinutes after it started, however many rooms caught', () => {
    world.stars = 2;
    const width = ROOMS.office.width;
    const row = [0, 1, 2, 3, 4].map((i) => place(world, 'office', 2, 100 + i * width));
    place(world, 'security', 1, 200);
    EVENT_TEST_HOOKS.target.fire = row[0]!.id;
    startFire(world);
    const t0 = world.time.minute;
    const cashBefore = world.cash;
    at(world, t0 + EVENTS.fire.spreadMinutes); // the second office catches
    expect(startedFire().roomIds).toHaveLength(2);
    at(world, t0 + EVENTS.fire.securityPutOutMinutes);
    expect(eventOf(world, 'fire')).toBeUndefined();
    expect(cashBefore - world.cash).toBe(2 * EVENTS.fire.damagePerRoom);
    expect(world.stats.lossesByKind.fire).toBe(2 * EVENTS.fire.damagePerRoom);
    expect(row.slice(2).every((r) => world.rooms.has(r.id))).toBe(true);
  });

  it('with no security and no helicopter it burns itself out after burnOutMinutes and bills the rooms', () => {
    expect(EVENTS.fire.burnOutMinutes).toBe(180);
    world.stars = 2;
    const office = place(world, 'office', 2, 100);
    EVENT_TEST_HOOKS.target.fire = office.id;
    startFire(world);
    const t0 = world.time.minute;
    const cashBefore = world.cash;
    at(world, t0 + EVENTS.fire.burnOutMinutes - 1);
    expect(eventOf(world, 'fire')).toBeDefined();
    at(world, t0 + EVENTS.fire.burnOutMinutes);
    expect(eventOf(world, 'fire')).toBeUndefined();
    expect(world.rooms.has(office.id)).toBe(false);
    expect(cashBefore - world.cash).toBe(EVENTS.fire.damagePerRoom);
    expect(world.log.at(-1)?.text).toBe('The fire burned itself out. 1 room burned down and clearing the damage cost $20,000.');
  });

  it('bills a burned room no more than it cost to build', () => {
    world.stars = 3;
    const space = place(world, 'parkingSpace', -1, 100);
    place(world, 'security', 1, 200);
    EVENT_TEST_HOOKS.target.fire = space.id;
    startFire(world);
    const t0 = world.time.minute;
    const cashBefore = world.cash;
    at(world, t0 + EVENTS.fire.securityPutOutMinutes);
    expect(cashBefore - world.cash).toBe(ROOMS.parkingSpace.cost);
    expect(world.stats.lossesByKind.fire).toBe(ROOMS.parkingSpace.cost);
  });

  it('helicopterCost is what the check tests and what the call takes', () => {
    world.stars = 3;
    const office = place(world, 'office', 2, 100);
    const next = place(world, 'office', 2, 109);
    EVENT_TEST_HOOKS.target.fire = office.id;
    startFire(world);
    at(world, world.time.minute + EVENTS.fire.spreadMinutes);
    expect(next.onFire).toBe(true);
    const fire = startedFire();
    const cost = helicopterCost(world, fire);
    expect(cost).toBe(EVENTS.fire.helicopterCost + 2 * EVENTS.fire.damagePerRoom);

    world.cash = cost - 1;
    expect(handleEventCommand(world, { kind: 'fire.callHelicopter' })).toEqual({
      ok: false,
      reason: `Not enough cash. A firefighting helicopter costs ${formatDollars(cost)}.`,
    });
    expect(world.cash).toBe(cost - 1);

    world.cash = cost;
    expect(handleEventCommand(world, { kind: 'fire.callHelicopter' })).toEqual({ ok: true });
    expect(world.cash).toBe(0);
    expect(world.stats.lossesByKind).toEqual({ helicopter: EVENTS.fire.helicopterCost, fire: 2 * EVENTS.fire.damagePerRoom });
  });

  // Review I-1: a save from before the structure rule can hold a fire that spread along the lobby row.
  describe('a fire saved with lobby tiles in it (review I-1)', () => {
    /** A tower with a 20 tile lobby row and an office, saved mid fire the way the old code left it. */
    function oldFireSave(opts: { office: boolean; security: boolean }): { text: string; lobbies: Room[]; office: Room | null } {
      world.stars = 3;
      const lobbies = [world.rooms.values().next().value as Room];
      for (let x = 101; x < 120; x++) lobbies.push(place(world, 'lobby', 1, x));
      const office = opts.office ? place(world, 'office', 2, 100) : null;
      if (opts.security) place(world, 'security', 3, 100);
      const burning = [...lobbies, ...(office ? [office] : [])];
      for (const room of burning) room.onFire = true;
      world.events.push({ kind: 'fire', roomIds: burning.map((r) => r.id), startedAt: world.time.minute, spreadAt: world.time.minute + EVENTS.fire.spreadMinutes });
      return { text: serialize(world), lobbies, office };
    }

    function load(text: string): World {
      const loaded = deserialize(text);
      if (!loaded.ok) throw new Error(loaded.reason);
      return loaded.world;
    }

    it('on load the lobby tiles leave the fire unburned and the office keeps burning', () => {
      const { text, lobbies, office } = oldFireSave({ office: true, security: false });
      const loaded = load(text);
      const fire = loaded.events.find((e) => e.kind === 'fire') as Extract<ActiveEvent, { kind: 'fire' }>;
      expect(fire.roomIds).toEqual([office!.id]);
      for (const lobby of lobbies) expect(loaded.rooms.get(lobby.id)?.onFire).toBe(false);
      expect(loaded.rooms.get(office!.id)?.onFire).toBe(true);
    });

    it('a loaded fire that held only lobby tiles ends on the first tick: every tile stays, nothing billed', () => {
      const { text, lobbies } = oldFireSave({ office: false, security: false });
      const loaded = load(text);
      const cash = loaded.cash;
      tick(loaded);
      expect(loaded.events.some((e) => e.kind === 'fire')).toBe(false);
      expect(lobbies.every((l) => loaded.rooms.has(l.id))).toBe(true);
      expect(loaded.cash).toBe(cash);
      expect(loaded.stats.lossesByKind.fire ?? 0).toBe(0);
      expect(loaded.log.some((l) => l.text === 'The fire is out.')).toBe(true);
    });

    it('the office burns out as before and the lobby row stays, billed for the office only', () => {
      const { text, lobbies, office } = oldFireSave({ office: true, security: false });
      const loaded = load(text);
      const cash = loaded.cash;
      loaded.time.minute += EVENTS.fire.burnOutMinutes;
      tickEvents(loaded);
      expect(loaded.rooms.has(office!.id)).toBe(false);
      expect(lobbies.every((l) => loaded.rooms.has(l.id))).toBe(true);
      expect(cash - loaded.cash).toBe(EVENTS.fire.damagePerRoom);
      expect(loaded.log.at(-1)?.text).toBe('The fire burned itself out. 1 room burned down and clearing the damage cost $20,000.');
    });

    // Without the load step, each way a fire ends still skips the structure rooms.
    for (const how of ['security', 'burn-out', 'helicopter'] as const) {
      it(`ending by ${how}, structure rooms in roomIds are put out, never destroyed or billed`, () => {
        oldFireSave({ office: true, security: how === 'security' });
        const fire = eventOf(world, 'fire')!;
        const lobbyIds = fire.roomIds.filter((id) => world.rooms.get(id)?.kind === 'lobby');
        expect(lobbyIds).toHaveLength(20);
        const cash = world.cash;
        if (how === 'helicopter') {
          expect(helicopterCost(world, fire)).toBe(EVENTS.fire.helicopterCost + EVENTS.fire.damagePerRoom);
          expect(handleEventCommand(world, { kind: 'fire.callHelicopter' })).toEqual({ ok: true });
        } else {
          at(world, fire.startedAt + (how === 'security' ? EVENTS.fire.securityPutOutMinutes : EVENTS.fire.burnOutMinutes));
        }
        expect(eventOf(world, 'fire')).toBeUndefined();
        expect(lobbyIds.every((id) => world.rooms.has(id) && world.rooms.get(id)?.onFire === false)).toBe(true);
        expect(world.stats.lossesByKind.fire).toBe(EVENTS.fire.damagePerRoom);
        expect(cash - world.cash).toBe(EVENTS.fire.damagePerRoom + (how === 'helicopter' ? EVENTS.fire.helicopterCost : 0));
      });
    }
  });

  // Review A-3: a fire whose rooms are all gone ends at once, with nothing billed.
  it('a fire whose burning room a bomb destroyed ends on the next tick with "The fire is out." and no bill', () => {
    world.stars = 3;
    const office = place(world, 'office', 2, 100);
    EVENT_TEST_HOOKS.target.fire = office.id;
    startFire(world);
    const t0 = world.time.minute;
    world.rooms.delete(office.id); // what the bomb's destroyRoom leaves behind
    const cashBefore = world.cash;
    at(world, t0 + 1);
    expect(eventOf(world, 'fire')).toBeUndefined();
    expect(world.cash).toBe(cashBefore);
    expect(world.stats.lossesByKind.fire ?? 0).toBe(0);
    expect(world.log.at(-1)).toMatchObject({ text: 'The fire is out.', level: 'alert' });
  });

  // Review A-1: every event loss goes through debitLoss, so it shows in the quarter's losses.
  it('a detonated bomb is booked as bomb damage and counts in the settle', () => {
    world.stars = 3;
    const office = place(world, 'office', 2, 100);
    EVENT_TEST_HOOKS.target.bomb = office.id;
    startBomb(world);
    const bomb = eventOf(world, 'bomb')!;
    const cashBefore = world.cash;
    at(world, bomb.detonateAt);
    expect(eventOf(world, 'bomb')).toBeUndefined();
    expect(cashBefore - world.cash).toBe(EVENTS.bomb.damageCash);
    expect(world.stats.lossesByKind).toEqual({ bomb: EVENTS.bomb.damageCash });
    onQuarterStart(world);
    expect(world.stats.lastQuarter.losses).toBe(EVENTS.bomb.damageCash);
    expect(world.stats.lastQuarter.lossesByKind).toEqual({ bomb: EVENTS.bomb.damageCash });
  });

  it('an escaped thief is booked as theft and counts in the settle', () => {
    world.stars = 3;
    const shop = place(world, 'shop', 2, 100);
    // Leaving, and the thief is already out of the tower: the next tick is the escape.
    world.events.push({ kind: 'theft', phase: 'leaving', enterAt: 0, simId: 999_999, targetId: shop.id, floor: 2, actUntil: null, guardId: null, noGuard: null });
    const cashBefore = world.cash;
    at(world, 10);
    expect(eventOf(world, 'theft')).toBeUndefined();
    expect(cashBefore - world.cash).toBe(THEFT.lossCash);
    expect(world.stats.lossesByKind).toEqual({ theft: THEFT.lossCash });
    onQuarterStart(world);
    expect(world.stats.lastQuarter.losses).toBe(THEFT.lossCash);
    expect(world.stats.lastQuarter.lossesByKind).toEqual({ theft: THEFT.lossCash });
  });

  it('a paid ransom is booked as a loss', () => {
    world.stars = 3;
    const office = place(world, 'office', 2, 100);
    EVENT_TEST_HOOKS.target.bomb = office.id;
    startBomb(world);
    expect(handleEventCommand(world, { kind: 'bomb.pay' })).toEqual({ ok: true });
    expect(world.stats.lossesByKind.ransom).toBe(EVENTS.bomb.ransom);
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
    // 07:00, so the fire (which burns itself out after burnOutMinutes) spans the 08:00 to 09:15 arrivals.
    tickMany(world, 60);
    EVENT_TEST_HOOKS.target.fire = condo.id;
    startFire(world);
    expect(condo.onFire).toBe(true);
    expect(world.log.filter((e) => e.text === WAITING)).toHaveLength(1);

    tickMany(world, EVENTS.fire.burnOutMinutes - 1); // to 09:59: the office leases, its workers would be arriving
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

  // Audit 2026-09-25 I S5: condo sales stop while any room burns (decision: no arrivals
  // during a fire). The only condo in the test above is the burning one, which is skipped
  // anyway, so a vacant condo elsewhere selling mid-fire passed every test.
  describe('I S5: a vacant condo that is not burning', () => {
    /** Runs from 06:00 to just past the end of the 07:30 to 09:00 sale window. */
    function throughSaleWindow(): void {
      while (world.time.minute % 1440 <= SCHEDULES.resident.leaveEnd) tick(world);
    }
    function owners(condo: Room): number {
      return [...world.sims.values()].filter((s) => s.kind === 'resident' && s.homeRoomId === condo.id).length;
    }
    const SOLD = 'A condo on floor 2 was sold to a new owner.';

    it('I S5: control, with no fire it sells in the morning window', () => {
      tower();
      const forSale = place(world, 'condo', 2, 300, { vacant: true, eval: 1 });
      throughSaleWindow();
      expect(forSale.vacant).toBe(false);
      expect(owners(forSale)).toBeGreaterThan(0);
      expect(world.log.filter((e) => e.text === SOLD)).toHaveLength(1);
    });

    it('I S5: stays unsold while a different room burns through the window', () => {
      tower();
      const forSale = place(world, 'condo', 2, 300, { vacant: true, eval: 1 });
      const fastFood = [...world.rooms.values()].find((r) => r.kind === 'fastFood') as Room;
      // 07:00, before the 07:30 window opens, so the fire outlasts the window before it burns itself out.
      tickMany(world, 60);
      EVENT_TEST_HOOKS.target.fire = fastFood.id;
      startFire(world);
      expect(fastFood.onFire).toBe(true);
      throughSaleWindow();
      expect(eventOf(world, 'fire')).toBeDefined();
      expect(forSale.onFire).toBe(false);
      expect(forSale.vacant).toBe(true);
      expect(forSale.occupancy).toBe(0);
      expect(owners(forSale)).toBe(0);
      expect(world.log.filter((e) => e.text.includes('was sold'))).toHaveLength(0);
    });
  });
});

describe('fire hold: the VIP and a booked thief wait outside too (audit 2026-09-25 B S6, decision 3)', () => {
  it('keeps the VIP and the thief outside until the fire ends, and the visit is not an incident', () => {
    const w = createWorld(11);
    w.cash = 50_000_000;
    w.stars = 5;
    buildTower(w, [
      ...lobbyRun(100, 199),
      { kind: 'build', room: 'office', floor: 2, x: 100 },
      { kind: 'build', room: 'hotelSuite', floor: 3, x: 100 },
      { kind: 'build', room: 'shop', floor: 2, x: 120 },
      { kind: 'shaft.build', shaft: 'standard', x: 190, floorMin: 1, floorMax: 3 },
    ]);
    const office = [...w.rooms.values()].find((r) => r.kind === 'office') as Room;
    startVip(w);
    const visit = eventOf(w, 'vip') as Extract<ActiveEvent, { kind: 'vip' }>;
    visit.arrivesAt = w.time.minute + 2;
    startTheft(w, (w.time.minute % 1440) + 3);
    EVENT_TEST_HOOKS.target.fire = office.id;
    startFire(w);

    tickMany(w, 30);
    expect(eventOf(w, 'fire')).toBeDefined();
    expect(w.sims.get(visit.simId)?.state).toBe('outside');
    expect(visit.phase).toBe('notice');
    expect([...w.sims.values()].filter((s) => s.kind === 'thief')).toEqual([]);
    expect(eventOf(w, 'theft')?.phase).toBe('notice');

    expect(handleEventCommand(w, { kind: 'fire.callHelicopter' }).ok).toBe(true);
    tickMany(w, 3);
    expect(w.sims.get(visit.simId)?.state).not.toBe('outside');
    expect(visit.incident).toBe(false);
    expect([...w.sims.values()].filter((s) => s.kind === 'thief')).toHaveLength(1);
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

  // Audit 2026-09-25 I S2: a refused command leaves the world as it was; the ransom the
  // tower cannot afford was never checked for cash or hash.
  it('I S2: a ransom the tower cannot afford is refused and changes neither cash nor hash', () => {
    threatenedTower(EVENTS.bomb.minStar, false);
    at(world, ROLL_MINUTE);
    expect(eventOf(world, 'bomb')).toBeDefined();
    world.cash = 1_000;
    const hash = hashWorld(world);
    expect(handleEventCommand(world, { kind: 'bomb.pay' })).toEqual({
      ok: false,
      reason: `Not enough cash. The ransom is ${formatDollars(EVENTS.bomb.ransom)}.`,
    });
    expect(world.cash).toBe(1_000);
    expect(hashWorld(world)).toBe(hash);
    expect(eventOf(world, 'bomb')).toBeDefined();
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
