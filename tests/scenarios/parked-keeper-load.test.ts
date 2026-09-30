// A save written before the F3 fix can hold a housekeeper parked in a hotel room with no end
// time. On load it must be treated as due: back to work, or gone with a replacement hired.

import { describe, expect, it } from 'vitest';

import { tick } from '../../src/sim/tick';
import type { Room, Sim, World } from '../../src/sim/types';
import { createWorld } from '../../src/sim/world';
import { buildRow, buildTower, lobbyRun } from './helpers';

describe('a housekeeper parked in a hotel room by an old save', () => {
  it('is not left in the room forever', () => {
    const world: World = createWorld(12345);
    world.cash = 50_000_000;
    buildTower(world, [...lobbyRun(150, 243), { kind: 'shaft.build', shaft: 'standard', x: 160, floorMin: 1, floorMax: 3 }]);
    world.stars = 2;
    buildTower(world, [{ kind: 'build', room: 'housekeeping', floor: 2, x: 205 }, ...buildRow('hotelSingle', 3, [205, 209, 213])]);
    const office = [...world.rooms.values()].find((r) => r.kind === 'housekeeping') as Room;
    let keeper: Sim | undefined;
    for (let i = 0; i < 3 * 1440 && !keeper; i++) {
      tick(world);
      keeper = [...world.sims.values()].find((s) => s.kind === 'staff' && s.inRoomId === office.id && s.state === 'inRoom');
    }
    if (!keeper) throw new Error('no housekeeper');
    const hotel = [...world.rooms.values()].find((r) => r.kind === 'hotelSingle') as Room;
    // Put it in the hotel room as the old code left it.
    office.occupancy = Math.max(0, office.occupancy - 1);
    hotel.occupancy += 1;
    keeper.inRoomId = hotel.id;
    keeper.pos = { floor: hotel.floor, x: hotel.x };
    keeper.stayUntil = null;
    const id = keeper.id;
    for (let i = 0; i < 3 * 1440; i++) tick(world);
    const after = world.sims.get(id);
    expect(after?.inRoomId ?? null).not.toBe(hotel.id);
    expect(after === undefined ? office.tenants.length > 0 : after.state !== 'inRoom' || after.inRoomId === office.id).toBe(true);
  });
});
