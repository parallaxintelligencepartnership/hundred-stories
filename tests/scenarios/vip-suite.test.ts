// The VIP's suite and rating (game readiness review 2026-10-01). The booking took the first
// clean empty suite by id even when nobody could get up to it, so the visit failed "no way up"
// with a reachable suite free; now a suite the lobby reaches comes first. stats.vipRating keeps
// the best visit so far (the fourth star reads it), while lastVip still tells the latest visit,
// now with the suite's floor and id.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyCommand } from '../../src/sim/build';
import { EVENT_TEST_HOOKS, resetEventTestHooks, startVip } from '../../src/sim/events';
import { deserialize, hashWorld, serialize } from '../../src/sim/save';
import { tick } from '../../src/sim/tick';
import type { ActiveEvent, Room, Shaft, World } from '../../src/sim/types';
import { createWorld } from '../../src/sim/world';
import { buildTower, lobbyRun, onlyShaft, roomsMatching } from './helpers';

type Visit = Extract<ActiveEvent, { kind: 'vip' }>;

beforeEach(() => {
  // No rolled fire, bomb, theft or second VIP: only the visits these tests book.
  EVENT_TEST_HOOKS.chance = { fire: 0, bomb: 0, vip: 0, theft: 0 };
});
afterEach(() => resetEventTestHooks());

function visitOf(world: World): Visit | undefined {
  return world.events.find((e): e is Visit => e.kind === 'vip');
}

/** Suite A on floor 3 (built first, lower id) and suite B on floor 4 above it, one shaft 1 to 4. */
function twoSuites(): { world: World; a: Room; b: Room; shaft: Shaft } {
  const world = createWorld(3);
  world.cash = 50_000_000;
  world.stars = 3;
  buildTower(world, [
    ...lobbyRun(90, 200),
    { kind: 'shaft.build', shaft: 'standard', x: 190, floorMin: 1, floorMax: 4 },
    { kind: 'build', room: 'office', floor: 2, x: 100 },
    { kind: 'build', room: 'office', floor: 2, x: 109 },
    { kind: 'build', room: 'hotelSuite', floor: 3, x: 100 },
    { kind: 'build', room: 'hotelSuite', floor: 4, x: 100 },
  ]);
  const a = roomsMatching(world, 'hotelSuite', { floor: 3 })[0] as Room;
  const b = roomsMatching(world, 'hotelSuite', { floor: 4 })[0] as Room;
  return { world, a, b, shaft: onlyShaft(world) };
}

function runVisit(world: World): void {
  for (let i = 0; i < 4 * 1440 && visitOf(world); i++) tick(world);
  expect(visitOf(world)).toBeUndefined();
}

function setStop(world: World, shaft: Shaft, floor: number, stops: boolean): void {
  expect(applyCommand(world, { kind: 'shaft.setStop', shaftId: shaft.id, floor, stops }).ok).toBe(true);
}

describe('the VIP suite booking', () => {
  it('books the suite the lobby reaches over an earlier one it cannot, and the visit happens', () => {
    const { world, a, b, shaft } = twoSuites();
    expect(a.id).toBeLessThan(b.id);
    setStop(world, shaft, 3, false);
    startVip(world);
    expect(visitOf(world)?.suiteId).toBe(b.id);
    runVisit(world);
    expect(world.stats.lastVip?.reason).toBeNull();
    expect(world.stats.lastVip?.suiteClean).toBe(true);
    expect(world.stats.vipRating).not.toBe('poor');
    expect(world.stats.lastVip?.suiteFloor).toBe(4);
    expect(world.stats.lastVip?.suiteId).toBe(b.id);
  });

  it('with no reachable suite it still books the first clean empty one, as before', () => {
    const { world, a, shaft } = twoSuites();
    setStop(world, shaft, 3, false);
    setStop(world, shaft, 4, false);
    startVip(world);
    expect(visitOf(world)?.suiteId).toBe(a.id);
    runVisit(world);
    expect(world.stats.lastVip?.rating).toBe('poor');
    expect(world.stats.lastVip?.reason).toBe('The VIP left: no way up to floor 3');
    expect(world.stats.lastVip?.suiteFloor).toBe(3);
  });
});

describe('the VIP rating the stars read', () => {
  it('keeps the best visit: a poor visit after a good one leaves the rating good, and lastVip tells the poor one', () => {
    const { world, shaft } = twoSuites();
    startVip(world);
    runVisit(world);
    const first = world.stats.lastVip;
    expect(first?.rating).toBe('good');
    expect(world.stats.vipRating).toBe('good');

    // The second VIP books, then the player turns off both suite floors before they arrive.
    startVip(world);
    expect(visitOf(world)).toBeDefined();
    setStop(world, shaft, 3, false);
    setStop(world, shaft, 4, false);
    runVisit(world);
    expect(world.stats.lastVip?.rating).toBe('poor');
    expect(world.stats.lastVip?.minute).toBeGreaterThan(first?.minute ?? 0);
    expect(world.stats.vipRating).toBe('good');

    // A later better visit still raises it: from none to poor is a rise too.
    const fresh = twoSuites();
    setStop(fresh.world, fresh.shaft, 3, false);
    setStop(fresh.world, fresh.shaft, 4, false);
    startVip(fresh.world);
    runVisit(fresh.world);
    expect(fresh.world.stats.vipRating).toBe('poor');
  });
});

describe('the suite in the saved visit record', () => {
  it('saves and loads with the suite floor, and a record without one still loads and hashes as it did', () => {
    const { world } = twoSuites();
    startVip(world);
    runVisit(world);
    expect(world.stats.lastVip?.suiteFloor).toBeDefined();
    const loaded = deserialize(serialize(world));
    if (!loaded.ok) throw new Error(loaded.reason);
    expect(loaded.world.stats.lastVip).toEqual(world.stats.lastVip);
    expect(hashWorld(loaded.world)).toBe(hashWorld(world));

    // An older record: no suite fields at all. It loads, and its hash is the hash it had.
    const older = JSON.parse(serialize(world)) as { stats: { lastVip: Record<string, unknown> } };
    delete older.stats.lastVip.suiteFloor;
    delete older.stats.lastVip.suiteId;
    const oldLoaded = deserialize(JSON.stringify(older));
    if (!oldLoaded.ok) throw new Error(oldLoaded.reason);
    expect(oldLoaded.world.stats.lastVip?.suiteFloor).toBeUndefined();
    const stripped = deserialize(serialize(world));
    if (!stripped.ok) throw new Error(stripped.reason);
    const record = stripped.world.stats.lastVip as NonNullable<World['stats']['lastVip']>;
    delete record.suiteFloor;
    delete record.suiteId;
    expect(hashWorld(oldLoaded.world)).toBe(hashWorld(stripped.world));

    // A broken one is refused.
    for (const bad of ['3', 2.5, null]) {
      const broken = JSON.parse(serialize(world)) as { stats: { lastVip: Record<string, unknown> } };
      broken.stats.lastVip.suiteFloor = bad;
      const result = deserialize(JSON.stringify(broken));
      expect(result.ok).toBe(false);
    }
    const brokenId = JSON.parse(serialize(world)) as { stats: { lastVip: Record<string, unknown> } };
    brokenId.stats.lastVip.suiteId = 'x';
    expect(deserialize(JSON.stringify(brokenId)).ok).toBe(false);
  });
});
