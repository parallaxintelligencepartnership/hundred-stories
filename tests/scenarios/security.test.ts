/**
 * Guards and the shop thief. Guards are people: hired with the security office, gone with it,
 * walking a patrol loop by the normal routes and elevators on shift and waiting in the office
 * off it. A thief walks in, rides up to the nearest shop, acts and leaves; the guard sent has to
 * get there in time. Fire and bomb keep their timers; a guard goes to look and comes back.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyCommand } from '../../src/sim/build';
import { EVENT_TEST_HOOKS, resetEventTestHooks, rollDailyEvents, startTheft } from '../../src/sim/events';
import { personIdentity } from '../../src/sim/identity';
import { EVENTS, SECURITY, THEFT } from '../../src/sim/rules';
import { deserialize, hashWorld, serialize } from '../../src/sim/save';
import { guardStatus, patrolFloors } from '../../src/sim/security';
import { personCard } from '../../src/sim/story';
import { tick } from '../../src/sim/tick';
import type { ActiveEvent, Room, Sim, World } from '../../src/sim/types';
import { createRng } from '../../src/sim/rng';
import { createWorld } from '../../src/sim/world';
import { atOnDay, buildRow, buildTower, lobbyRun, onlyShaft, roomsMatching, runDays, runMinutes, simsOfKind } from './helpers';

type Theft = Extract<ActiveEvent, { kind: 'theft' }>;

const SHAFT_X = 150;

function theftOf(world: World): Theft | undefined {
  return world.events.find((e): e is Theft => e.kind === 'theft');
}

function only(world: World, kind: Room['kind']): Room {
  const room = roomsMatching(world, kind)[0];
  if (!room) throw new Error(`no ${kind}`);
  return room;
}

function guards(world: World): Sim[] {
  return simsOfKind(world, 'guard');
}

/**
 * A three star tower: a lobby, one standard shaft from the lobby to `top` with `cars` cars,
 * an office at x 100 on every floor from 2 to `top` for support, a shop on `shopFloor` right of
 * the shaft and a security office on `officeFloor` left of it (none when null). The shop and the
 * security office start at x 152, over the shaft's last two columns, so the shaft holds them up.
 */
function tower(opts: { top: number; cars: number; shopFloor: number; officeFloor: number | null; seed?: number }): World {
  const world = createWorld(opts.seed ?? 11);
  world.stars = 3;
  world.cash = 500_000_000;
  const script = [...lobbyRun(90, 200), { kind: 'shaft.build' as const, shaft: 'standard' as const, x: SHAFT_X, floorMin: 1, floorMax: opts.top }];
  for (let f = 2; f <= opts.top; f++) script.push(...buildRow('office', f, [100]));
  script.push({ kind: 'build', room: 'shop', floor: opts.shopFloor, x: 152 });
  if (opts.officeFloor !== null) script.push({ kind: 'build', room: 'security', floor: opts.officeFloor, x: 152 + (opts.officeFloor === opts.shopFloor ? 20 : 0) });
  buildTower(world, script);
  const shaft = onlyShaft(world);
  for (let c = 1; c < opts.cars; c++) buildTower(world, [{ kind: 'shaft.addCar', shaftId: shaft.id }]);
  return world;
}

/** Tick until the theft clears, returning the phases seen. */
function runTheft(world: World, onTick?: (world: World, theft: Theft) => void): Set<Theft['phase']> {
  const phases = new Set<Theft['phase']>();
  for (let i = 0; i < 2 * 1440; i++) {
    const theft = theftOf(world);
    if (!theft) return phases;
    phases.add(theft.phase);
    onTick?.(world, theft);
    tick(world);
  }
  throw new Error('the theft never cleared');
}

/** Tick until the thief is at the target and the theft has begun. */
function runToActing(world: World): Theft {
  for (let i = 0; i < 1440; i++) {
    const theft = theftOf(world);
    if (theft && (theft.phase === 'acting' || theft.phase === 'leaving')) return theft;
    tick(world);
  }
  throw new Error('the theft never began');
}

/** Book a theft for 11:00 on day 1, with every random roll turned off. */
function bookTheft(world: World, hour = 11): void {
  atOnDay(world, 1, 6, 1);
  startTheft(world, hour * 60);
}

const beatCodes = (world: World): string[] => world.story.recent.map((b) => b.code);

/** Cash less this quarter's income: what a theft can take, with the shop's takings set aside. */
const cashLessIncome = (world: World): number =>
  world.cash - Object.values(world.stats.incomeByKind).reduce((sum, v) => sum + (v ?? 0), 0);

beforeEach(() => {
  resetEventTestHooks();
  EVENT_TEST_HOOKS.chance = { fire: 0, bomb: 0, vip: 0, theft: 0 };
});
afterEach(() => resetEventTestHooks());

describe('guards', () => {
  it('are hired with the security office, half on each shift, named, and leave with it', () => {
    const world = tower({ top: 6, cars: 2, shopFloor: 5, officeFloor: 3 });
    const office = only(world, 'security');
    tick(world);
    const staff = guards(world);
    expect(staff).toHaveLength(SECURITY.guardsPerOffice);
    expect(office.tenants).toEqual(staff.map((g) => g.id));
    expect(staff.every((g) => g.homeRoomId === office.id)).toBe(true);
    expect(staff.filter((g) => g.guard?.shift === 0)).toHaveLength(SECURITY.guardsPerOffice / 2);
    expect(staff.filter((g) => g.guard?.shift === 1)).toHaveLength(SECURITY.guardsPerOffice / 2);
    // Guards in the office are not occupancy: the office can still come down.
    expect(office.occupancy).toBe(0);

    const card = personCard(world, staff[0] as Sim);
    expect(card.who).toEqual([personIdentity(world.seed, staff[0]!.id, 'guard').name, 'Security guard', 'Works for the security office on floor 3']);

    runMinutes(world, 600);
    expect(applyCommand(world, { kind: 'demolish', roomId: office.id })).toEqual({ ok: true });
    tick(world);
    expect(guards(world)).toHaveLength(0);
  });

  it('patrol the floors near the office on shift, walking and riding, and wait inside off shift', () => {
    const world = tower({ top: 10, cars: 2, shopFloor: 5, officeFloor: 3 });
    const office = only(world, 'security');
    tick(world);
    expect(patrolFloors(world, office)).toEqual([1, 2, 3, 4, 5]);
    const floors = new Set<number>();
    const states = new Set<Sim['state']>();
    const statuses = new Set<string>();
    atOnDay(world, 1, 6, 0);
    for (let i = 0; i < 6 * 60; i++) {
      for (const g of guards(world)) {
        if (g.guard?.shift !== 0) continue;
        states.add(g.state);
        if (g.state === 'walking') floors.add(g.pos.floor);
        statuses.add(guardStatus(world, g));
      }
      tick(world);
    }
    expect(states.has('walking')).toBe(true);
    expect(states.has('riding')).toBe(true);
    expect(floors.size).toBeGreaterThan(1);
    for (const f of floors) expect([1, 2, 3, 4, 5]).toContain(f);
    expect([...statuses].some((s) => s.startsWith('Patrolling floor '))).toBe(true);
    // The night shift sat it out in the office.
    for (const g of guards(world).filter((g) => g.guard?.shift === 1)) {
      expect(g.state).toBe('inRoom');
      expect(g.inRoomId).toBe(office.id);
      expect(guardStatus(world, g)).toBe('Off work');
    }
  });
});

describe('the shop thief', () => {
  it('a guard two floors from the shop catches the thief; nothing is lost and the story names both', () => {
    const world = tower({ top: 6, cars: 2, shopFloor: 5, officeFloor: 3 });
    const shop = only(world, 'shop');
    bookTheft(world);
    const cash = cashLessIncome(world);
    const theft = runToActing(world);
    const thiefId = theft.simId as number;
    const thief = world.sims.get(thiefId) as Sim;
    expect(thief.kind).toBe('thief');
    // Before the outcome the card calls the thief a visitor.
    expect(personCard(world, thief).who).toEqual([personIdentity(world.seed, thiefId, 'thief').name, 'Visitor']);
    expect(theft.guardId).not.toBeNull();
    const guardId = theft.guardId as number;
    expect(world.log.some((l) => l.text.startsWith('Theft on floor 5, a guard is on the way.'))).toBe(true);
    const sentStatus = guardStatus(world, world.sims.get(guardId) as Sim);
    expect(sentStatus).toBe('Going to floor 5');

    const guardFloors = new Set<number>();
    // Audit 2026-09-25 I S7: cashLessIncome sets the income ledger aside, so a loss booked in
    // that same ledger would cancel out. No income entry may fall while the thief is caught.
    const incomeBefore = { ...world.stats.incomeByKind };
    runTheft(world, (w) => {
      const g = w.sims.get(guardId);
      if (g) guardFloors.add(g.pos.floor);
    });
    expect(world.sims.has(thiefId)).toBe(false);
    expect(cashLessIncome(world)).toBe(cash);
    const income = world.stats.incomeByKind;
    for (const kind of new Set([...Object.keys(incomeBefore), ...Object.keys(income)]) as Set<keyof typeof income>) {
      expect(income[kind] ?? 0, `I S7: ${kind} income`).toBeGreaterThanOrEqual(incomeBefore[kind] ?? 0);
    }
    expect(shop.dirty).toBe(false);
    expect(world.log.some((l) => l.text.startsWith('Thief caught on floor 5.'))).toBe(true);
    const theftBeats = world.story.recent.filter((b) => b.code.startsWith('theft.') || b.code === 'guard.dispatched');
    expect(theftBeats.map((b) => b.code)).toEqual(['theft.started', 'guard.dispatched', 'theft.caught']);
    expect(theftBeats[0]).toMatchObject({ simId: thiefId, roomId: shop.id });
    expect(theftBeats[1]).toMatchObject({ simId: guardId, roomId: shop.id });
    expect(theftBeats[2]).toMatchObject({ simId: thiefId, roomId: shop.id });
    expect(guardFloors.has(5)).toBe(true);
    // Released: back on the loop.
    tick(world);
    expect(guardStatus(world, world.sims.get(guardId) as Sim)).not.toBe('Going to floor 5');
  });

  it('with the office twenty floors away and one slow shaft, the thief escapes: cash lost and the shop left dirty', () => {
    const world = tower({ top: 24, cars: 1, shopFloor: 2, officeFloor: 22 });
    const shop = only(world, 'shop');
    bookTheft(world);
    const theft = runToActing(world);
    expect(theft.guardId).not.toBeNull();
    const thiefId = theft.simId as number;
    const cash = cashLessIncome(world);
    runTheft(world);
    expect(cashLessIncome(world)).toBe(cash - THEFT.lossCash);
    expect(shop.dirty).toBe(true);
    expect(world.log.some((l) => l.text.startsWith('Thief escaped, $2,000 lost.'))).toBe(true);
    expect(beatCodes(world)).toContain('theft.escaped');
    expect(world.story.recent.find((b) => b.code === 'theft.escaped')).toMatchObject({ simId: thiefId, roomId: shop.id, value: THEFT.lossCash });
    expect(beatCodes(world)).not.toContain('theft.caught');
    // The shop takes the dirty room penalty at the next evaluation, and is tidied after a day or so.
    runMinutes(world, 60);
    expect(shop.eval).toBeLessThan(1);
    runDays(world, 2);
    expect(shop.dirty).toBe(false);
  });

  it('with no guard on shift the theft fails visibly, naming the floor, and counts as escaped', () => {
    const world = tower({ top: 6, cars: 2, shopFloor: 5, officeFloor: null });
    bookTheft(world);
    const theft = runToActing(world);
    expect(theft.guardId).toBeNull();
    expect(theft.noGuard).toBe('No guard could reach floor 5: no guard is on shift.');
    expect(world.log.some((l) => l.text === 'Theft on floor 5, no guard can reach it.')).toBe(true);
    expect(world.log.some((l) => l.text === 'No guard could reach floor 5: no guard is on shift.')).toBe(true);
    const cash = cashLessIncome(world);
    runTheft(world);
    expect(cashLessIncome(world)).toBe(cash - THEFT.lossCash);
    expect(beatCodes(world)).toContain('theft.escaped');
  });

  it('with no route from the guards to the shop floor the reason says so', () => {
    // A second shaft serves floors 6 and 7 only: the office on 7 has no way down to the shop on 5.
    const world = tower({ top: 5, cars: 2, shopFloor: 5, officeFloor: null });
    buildTower(world, [
      ...buildRow('office', 6, [100]),
      { kind: 'shaft.build', shaft: 'standard', x: 200, floorMin: 6, floorMax: 7 },
      { kind: 'build', room: 'security', floor: 7, x: 100 },
    ]);
    bookTheft(world);
    const theft = runToActing(world);
    expect(theft.noGuard).toBe('No guard could reach floor 5: no route from where the guards are.');
    runTheft(world);
    expect(beatCodes(world)).toContain('theft.escaped');
  });

  it('holds the cooldown between thefts and never runs two at once', () => {
    const world = tower({ top: 6, cars: 2, shopFloor: 5, officeFloor: 3 });
    EVENT_TEST_HOOKS.chance.theft = 1;
    const rolled: number[] = [];
    let last = world.stats.lastTheftAt;
    for (let i = 0; i < 7 * 1440; i++) {
      world.stars = 3; // this small tower would fall back on population; the roll needs three stars
      tick(world);
      expect(world.events.filter((e) => e.kind === 'theft').length).toBeLessThanOrEqual(1);
      if (world.stats.lastTheftAt !== last) {
        last = world.stats.lastTheftAt;
        rolled.push(last as number);
      }
    }
    expect(rolled.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < rolled.length; i++) expect(rolled[i]! - rolled[i - 1]!).toBeGreaterThanOrEqual(THEFT.cooldownDays * 1440);
  });

  it('saved and loaded mid encounter, resumes and reaches the same outcome', () => {
    const world = tower({ top: 6, cars: 2, shopFloor: 5, officeFloor: 3 });
    bookTheft(world);
    runToActing(world);
    tick(world);
    const loaded = deserialize(serialize(world));
    if (!loaded.ok) throw new Error(loaded.reason);
    const copy = loaded.world;
    expect(theftOf(copy)).toEqual(theftOf(world));
    expect(hashWorld(copy)).toBe(hashWorld(world));
    runTheft(world);
    runTheft(copy);
    const outcome = (w: World): string[] => beatCodes(w).filter((c) => c.startsWith('theft.'));
    expect(outcome(copy)).toEqual(outcome(world));
    expect(copy.cash).toBe(world.cash);
    expect(hashWorld(copy)).toBe(hashWorld(world));
  });

  it('a save made before guards existed loads with no theft and hires the same guards on load', () => {
    const world = tower({ top: 6, cars: 2, shopFloor: 5, officeFloor: 3 });
    // As an older save would have it: an office with no guards and no theft block.
    const loaded = deserialize(serialize(world));
    if (!loaded.ok) throw new Error(loaded.reason);
    expect(theftOf(loaded.world)).toBeUndefined();
    tick(world);
    tick(loaded.world);
    expect(guards(loaded.world).map((g) => g.id)).toEqual(guards(world).map((g) => g.id));
    expect(hashWorld(loaded.world)).toBe(hashWorld(world));
  });
});

describe('fire and bomb with guards', () => {
  it('a fire sends the nearest guard, records no theft beat, keeps its timer, and the guard returns to patrol', () => {
    const world = tower({ top: 6, cars: 2, shopFloor: 5, officeFloor: 3 });
    const target = only(world, 'shop');
    atOnDay(world, 1, 5, 59);
    world.stars = 3; // back from the population recount: fire rolls from two stars
    EVENT_TEST_HOOKS.chance.fire = 1;
    EVENT_TEST_HOOKS.target.fire = target.id;
    runMinutes(world, 2);
    EVENT_TEST_HOOKS.chance.fire = 0;
    const fire = world.events.find((e) => e.kind === 'fire');
    expect(fire).toBeDefined();
    const sent = world.story.recent.find((b) => b.code === 'guard.dispatched');
    expect(sent?.roomId).toBe(target.id);
    const guard = world.sims.get(sent?.simId as number) as Sim;
    expect(guard.kind).toBe('guard');
    expect(guardStatus(world, guard)).toBe('Going to floor 5');
    expect(beatCodes(world).some((c) => c.startsWith('theft.'))).toBe(false);
    // The security office still puts it out on its own timer.
    const startedAt = (fire as Extract<ActiveEvent, { kind: 'fire' }>).startedAt;
    runMinutes(world, startedAt + EVENTS.fire.securityPutOutMinutes + 1 - world.time.minute);
    expect(world.events.some((e) => e.kind === 'fire')).toBe(false);
    expect(world.log.some((l) => l.text.startsWith('Security put the fire out.'))).toBe(true);
    runMinutes(world, 30);
    expect(guardStatus(world, guard)).toMatch(/^Patrolling floor /);
    expect(beatCodes(world).some((c) => c.startsWith('theft.'))).toBe(false);
    expect(world.log.some((l) => l.text.startsWith('Theft') || l.text.startsWith('Thief'))).toBe(false);
  });
});

describe('below three stars', () => {
  it('rolls no theft and draws nothing from the rng for it, even with the chance forced', () => {
    const world = tower({ top: 6, cars: 2, shopFloor: 5, officeFloor: 3 });
    world.stars = 2;
    EVENT_TEST_HOOKS.chance = { fire: 0, bomb: 0, vip: 0, theft: 1 };
    // At two stars the only roll is the fire's: one draw.
    const expected = createRng(world.rng.state());
    expected.next();
    rollDailyEvents(world);
    expect(theftOf(world)).toBeUndefined();
    expect(world.rng.state()).toBe(expected.state());
    // At three the theft rolls too.
    world.stars = 3;
    rollDailyEvents(world);
    expect(theftOf(world)).toBeDefined();
  });

  it('a two star tower hashes exactly as it did before guards and thieves', () => {
    // Recorded on 778dee5, before this package: a two star tower without a security office.
    // Re-recorded when rooms had to rest on structure: the same tower with the condo and hotel
    // rooms moved onto the floor 3 offices hashes 3bdf4126 on 778dee5 too.
    const world = createWorld(2024);
    world.stars = 2;
    world.cash = 50_000_000;
    buildTower(world, [
      ...lobbyRun(90, 200),
      { kind: 'shaft.build', shaft: 'standard', x: 150, floorMin: 1, floorMax: 8 },
      ...buildRow('office', 2, [100, 109, 118, 127, 160, 169]),
      ...buildRow('office', 3, [100, 109, 118, 127]),
      // The second condo and the hotel rooms over it sit on the floor 3 offices, not in the air.
      ...buildRow('condo', 4, [100, 116]),
      ...buildRow('hotelSingle', 5, [100, 104, 108, 112, 116, 120]),
      ...buildRow('housekeeping', 6, [100]),
      ...buildRow('fastFood', 7, [100]),
    ]);
    resetEventTestHooks();
    runDays(world, 4);
    expect(hashWorld(world)).toBe('3bdf4126');
  });
});
