// Audit 2026-09-25, lane C S1 / lane D S2: the cockroach spread timer must survive a save.
// A hotel tower saved and reloaded after an infestation used to diverge from the straight run
// (first hash difference at minute 7561), because the timer lived in a module WeakMap.

import { describe, expect, it } from 'vitest';
import { createWorld } from '../../src/sim/world';
import { tick } from '../../src/sim/tick';
import { deserialize, hashWorld, serialize } from '../../src/sim/save';
import type { Room, World } from '../../src/sim/types';
import { buildRow, buildTower, lobbyRun } from '../scenarios/helpers';

/** Seed 11, five hotel singles on floor 2, the first dirty with no housekeeping: it infests after 3 days. */
function hotelTower(): World {
  const world = createWorld(11);
  world.cash = 500_000_000;
  world.stars = 2;
  buildTower(world, [
    ...lobbyRun(90, 170),
    { kind: 'shaft.build', shaft: 'standard', x: 150, floorMin: 1, floorMax: 3 },
    ...buildRow('hotelSingle', 2, [100, 104, 108, 112, 116]),
  ]);
  const first = [...world.rooms.values()].filter((r) => r.kind === 'hotelSingle').sort((a, b) => a.id - b.id)[0] as Room;
  first.dirty = true;
  first.dirtySinceMinute = world.time.minute;
  return world;
}

const anyInfested = (world: World): boolean => [...world.rooms.values()].some((r) => r.infested);

describe('cockroach spread timer across a save (audit C S1)', () => {
  it('a hotel tower saved and loaded at minute 6181 hashes equal to the straight run after 5 days', () => {
    const straight = hotelTower();
    while (!anyInfested(straight)) tick(straight);
    expect(straight.time.minute).toBe(4681);
    for (let i = 0; i < 1500; i++) tick(straight);
    expect(straight.time.minute).toBe(6181);

    const loaded = deserialize(serialize(straight));
    if (!loaded.ok) throw new Error(loaded.reason);
    const reloaded = loaded.world;
    expect(hashWorld(reloaded)).toBe(hashWorld(straight));

    let firstDiff = -1;
    for (let i = 0; i < 5 * 1440; i++) {
      tick(straight);
      tick(reloaded);
      if (firstDiff < 0 && hashWorld(straight) !== hashWorld(reloaded)) firstDiff = straight.time.minute;
    }
    expect(firstDiff).toBe(-1);
    expect(hashWorld(reloaded)).toBe(hashWorld(straight));
  });

  it('a v5 save (no timer field) loads with the old first-spread timing: the timer starts at the next roll', () => {
    const straight = hotelTower();
    while (!anyInfested(straight)) tick(straight);
    for (let i = 0; i < 1500; i++) tick(straight);
    const data = JSON.parse(serialize(straight)) as Record<string, unknown>;
    data.version = 5;
    delete data.roachLastSpread;
    const loaded = deserialize(JSON.stringify(data));
    if (!loaded.ok) throw new Error(loaded.reason);
    expect(loaded.world.roachLastSpread ?? null).toBe(null);
  });
});
