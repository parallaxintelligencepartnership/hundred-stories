// The committed demo tower (store/fixtures/demo-tower.json) seeds the store screenshots and the
// rollout captures. Package 8b added a restaurant and one of every kind it lacked, on new floors
// above and below the old ones, so every illustrated room can be captured. It must stay a save
// the game loads.

import fixture from '../../store/fixtures/demo-tower.json?raw';
import { describe, expect, it } from 'vitest';
import { deserialize, SAVE_VERSION } from '../../src/sim/save';
import { ROOMS } from '../../src/sim/rules';
import type { RoomKind } from '../../src/sim/types';

describe('the demo tower fixture', () => {
  it('loads as a valid save under the current loader', () => {
    const result = deserialize(fixture);
    expect(result.ok ? 'ok' : result.reason).toBe('ok');
    expect(SAVE_VERSION).toBe(4);
  });

  it('holds at least one room of every kind, a restaurant among them', () => {
    const result = deserialize(fixture);
    if (!result.ok) throw new Error(result.reason);
    const kinds = new Set([...result.world.rooms.values()].map((r) => r.kind));
    for (const kind of Object.keys(ROOMS) as RoomKind[]) expect(kinds.has(kind), kind).toBe(true);
  });

  it('keeps the original tower on floors 1 to 8 and builds the new kinds above and below it', () => {
    const result = deserialize(fixture);
    if (!result.ok) throw new Error(result.reason);
    const original = new Set<RoomKind>(['lobby', 'office', 'condo', 'stairs', 'hotelSingle', 'hotelTwin', 'hotelSuite', 'shop', 'fastFood', 'housekeeping']);
    for (const room of result.world.rooms.values()) {
      const inOld = room.floor >= 1 && room.floor + room.height - 1 <= 8;
      if (!original.has(room.kind)) expect(inOld, `${room.kind} on ${room.floor}`).toBe(false);
    }
    // Every shaft reaches the new floors, so the new rooms can fill.
    for (const shaft of result.world.shafts.values()) {
      expect(shaft.floorMin).toBeLessThanOrEqual(-4);
      expect(shaft.floorMax).toBeGreaterThanOrEqual(17);
    }
  });
});
