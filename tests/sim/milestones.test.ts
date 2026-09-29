// Milestones on the world (src/sim/milestones.ts): written by the sim, each kind once, saved,
// and absent from older saves, which load with an empty list.
import { describe, expect, it } from 'vitest';
import { applyCommand } from '../../src/sim/build';
import { ROOMS } from '../../src/sim/rules';
import { deserialize, hashWorld, serialize } from '../../src/sim/save';
import { recomputeStars } from '../../src/sim/stars';
import type { Room, RoomKind, World } from '../../src/sim/types';
import { addRoom, allocId, createWorld, removeRoom } from '../../src/sim/world';
import { buildTower, lobbyRun } from '../scenarios/helpers';

function office(world: World, floor: number, x: number): Room {
  const kind: RoomKind = 'office';
  const room: Room = {
    id: allocId(world),
    kind,
    floor,
    x,
    width: ROOMS[kind].width,
    height: ROOMS[kind].height,
    eval: 1,
    tenants: [],
    occupancy: 0,
    builtAtMinute: 0,
    vacant: false,
    dirty: false,
    infested: false,
    lowEvalSinceMinute: null,
    onFire: false,
    rent: 100,
  };
  addRoom(world, room);
  return room;
}

/** Leased offices, six people each, until the population is at least `people`. */
function officesFor(world: World, people: number, floor = 2): Room[] {
  const out: Room[] = [];
  for (let i = 0; i * ROOMS.office.capacity < people; i += 1) out.push(office(world, floor + Math.floor(i / 20), (i % 20) * 10));
  return out;
}

const kinds = (world: World) => world.milestones.map((m) => m.kind);

describe('milestones', () => {
  it('starts empty on a new tower', () => {
    expect(createWorld(1).milestones).toEqual([]);
  });

  it('records a star gained, once, with the minute and a line', () => {
    const world = createWorld(1);
    const rooms = officesFor(world, 300);
    world.time.minute = 1440 + 600;
    recomputeStars(world);
    expect(world.stars).toBe(2);
    expect(world.milestones.find((m) => m.kind === 'star:2')).toEqual({ kind: 'star:2', minute: 2040, text: 'The tower reached 2 stars.' });
    // Lost with the tenants, then won back: still one star 2 milestone.
    for (const room of rooms) room.vacant = true;
    recomputeStars(world);
    expect(world.stars).toBe(1);
    for (const room of rooms) room.vacant = false;
    world.time.minute += 60;
    recomputeStars(world);
    expect(world.stars).toBe(2);
    expect(kinds(world).filter((k) => k === 'star:2')).toHaveLength(1);
  });

  it('records a population mark the first time it is crossed, and never again', () => {
    const world = createWorld(1);
    const rooms = officesFor(world, 102);
    recomputeStars(world);
    expect(world.population).toBeGreaterThanOrEqual(100);
    expect(kinds(world)).toEqual(['population:100']);
    expect(world.milestones[0]?.text).toBe('Population reached 100.');
    for (const room of rooms) room.vacant = true;
    recomputeStars(world);
    for (const room of rooms) room.vacant = false;
    recomputeStars(world);
    expect(kinds(world)).toEqual(['population:100']);
  });

  it('records every mark passed in one step, in order, and writes 1,000 with a comma', () => {
    const world = createWorld(1);
    officesFor(world, 1_000);
    recomputeStars(world);
    expect(kinds(world).filter((k) => k.startsWith('population:'))).toEqual(['population:100', 'population:500', 'population:1000']);
    expect(world.milestones.find((m) => m.kind === 'population:1000')?.text).toBe('Population reached 1,000.');
  });

  it('does not announce a mark a loaded tower was already past', () => {
    const world = createWorld(1);
    officesFor(world, 600);
    world.population = 600; // as a save made before milestones would load
    world.stars = 2;
    recomputeStars(world);
    expect(kinds(world)).toEqual([]);
  });

  it('records the first metro station built, and not a second one', () => {
    const world = createWorld(21);
    world.cash = 50_000_000;
    world.stars = 4;
    buildTower(world, [...lobbyRun(100, 300), { kind: 'build', room: 'metro', floor: -3, x: 190 }]);
    expect(kinds(world)).toEqual(['metro']);
    expect(world.milestones[0]?.text).toBe('The first metro station opened.');
    const metro = [...world.rooms.values()].find((r) => r.kind === 'metro') as Room;
    removeRoom(world, metro.id);
    expect(applyCommand(world, { kind: 'build', room: 'metro', floor: -3, x: 190 }).ok).toBe(true);
    expect(kinds(world)).toEqual(['metro']);
  });

  it('saves and loads, and leaves the world hash alone', () => {
    const world = createWorld(1);
    const before = hashWorld(world);
    world.milestones.push({ kind: 'population:100', minute: 90, text: 'Population reached 100.' });
    expect(hashWorld(world)).toBe(before);
    const loaded = deserialize(serialize(world));
    expect(loaded.ok && loaded.world.milestones).toEqual(world.milestones);
  });

  it('loads an older save without the field as an empty list, and drops malformed entries', () => {
    const data = JSON.parse(serialize(createWorld(1))) as Record<string, unknown>;
    delete data['milestones'];
    const old = deserialize(JSON.stringify(data));
    expect(old.ok && old.world.milestones).toEqual([]);
    data['milestones'] = [{ kind: 'metro', minute: 5, text: 'The first metro station opened.' }, { kind: 3 }, 'junk', { kind: 'metro', minute: 9, text: 'again' }];
    const odd = deserialize(JSON.stringify(data));
    expect(odd.ok && odd.world.milestones).toEqual([{ kind: 'metro', minute: 5, text: 'The first metro station opened.' }]);
  });
});
