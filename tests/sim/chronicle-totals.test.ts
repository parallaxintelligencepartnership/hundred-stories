// The tower chronicle's tallies come from running totals, not from the 256 beat recent list
// (audit 2026-09-25, C S6), and a hotel checkout is not a move-out.
import { describe, expect, it } from 'vitest';

import { assembleChronicle } from '../../src/sim/chronicle';
import { ROOMS } from '../../src/sim/rules';
import { deserialize, serialize } from '../../src/sim/save';
import { recordBeat, STORY_RECENT_CAP } from '../../src/sim/story';
import type { Room, RoomKind, World } from '../../src/sim/types';
import { allocId, createWorld } from '../../src/sim/world';

function room(world: World, kind: RoomKind, floor: number): Room {
  const r: Room = {
    id: allocId(world), kind, floor, x: 100, width: ROOMS[kind].width, height: ROOMS[kind].height, eval: 1, tenants: [],
    occupancy: 0, builtAtMinute: 0, vacant: false, dirty: false, infested: false, lowEvalSinceMinute: null, onFire: false, rent: 100,
  };
  world.rooms.set(r.id, r);
  return r;
}

function tallies(world: World): string[] {
  return assembleChronicle(world).lines.filter((l) => /moved out\.$|^Thieves: |^Times waste/.test(l));
}

describe('chronicle tallies (audit C S6)', () => {
  it('match the running totals after more than 256 later beats, and skip hotel checkouts', () => {
    const world = createWorld(5);
    const office = room(world, 'office', 3);
    const hotel = room(world, 'hotelSingle', 4);
    const shop = room(world, 'shop', 2);
    const story = world.story;
    recordBeat(story, { code: 'room.vacated', minute: 10, simId: 900, roomId: office.id, value: 1 });
    recordBeat(story, { code: 'room.vacated', minute: 11, simId: 901, roomId: office.id, value: 1 });
    recordBeat(story, { code: 'room.vacated', minute: 12, simId: 902, roomId: hotel.id, value: 0 }); // a checkout
    recordBeat(story, { code: 'theft.caught', minute: 13, simId: 903, roomId: shop.id });
    recordBeat(story, { code: 'theft.escaped', minute: 14, simId: 904, roomId: shop.id, value: 5000 });
    recordBeat(story, { code: 'theft.escaped', minute: 15, simId: 905, roomId: shop.id, value: 5000 });
    recordBeat(story, { code: 'waste.backlog', minute: 16, roomId: office.id });
    recordBeat(story, { code: 'waste.cleared', minute: 17, roomId: office.id });

    const expected = ['2 tenants moved out.', 'Thieves: 1 caught, 2 got away.', 'Times waste piled up: 1, cleaned up: 1.'];
    expect(tallies(world)).toEqual(expected);

    for (let i = 0; i < STORY_RECENT_CAP + 10; i += 1) {
      recordBeat(story, { code: 'wait.long', minute: 100 + i, simId: 2000 + i, roomId: office.id, value: 6 });
    }
    expect(story.recent.some((b) => b.code === 'theft.caught' || b.code === 'room.vacated')).toBe(false);
    expect(tallies(world)).toEqual(expected);

    // the totals travel with the story in the save
    const back = deserialize(serialize(world));
    expect(back.ok).toBe(true);
    if (back.ok) expect(tallies(back.world)).toEqual(expected);
  });
});
