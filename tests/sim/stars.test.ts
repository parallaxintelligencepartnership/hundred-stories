import { describe, expect, it } from 'vitest';
import { addRoom, addSim, allocId, createWorld } from '../../src/sim/world';
import { ROOMS, STARS } from '../../src/sim/rules';
import { populationOf, recomputeStars } from '../../src/sim/stars';
import { canBuild } from '../../src/sim/build';
import { deserialize, serialize } from '../../src/sim/save';
import type { Room, RoomKind, Star, World } from '../../src/sim/types';

let idCounter = 1;

function makeRoom(overrides: Partial<Room> & { kind: RoomKind; floor: number; x: number }): Room {
  return {
    id: idCounter++,
    width: ROOMS[overrides.kind].width,
    height: ROOMS[overrides.kind].height,
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
    ...overrides,
  };
}

describe('stars: populationOf', () => {
  it('counts a non-vacant office as 6 population', () => {
    const world = createWorld(1);
    addRoom(world, makeRoom({ kind: 'office', floor: 2, x: 100, vacant: false }));
    expect(populationOf(world)).toBe(6);
  });

  it('does not count a vacant office', () => {
    const world = createWorld(1);
    addRoom(world, makeRoom({ kind: 'office', floor: 2, x: 100, vacant: true }));
    expect(populationOf(world)).toBe(0);
  });

  it('counts a sold (non-vacant) condo as 3 population', () => {
    const world = createWorld(1);
    addRoom(world, makeRoom({ kind: 'condo', floor: 2, x: 100, vacant: false }));
    expect(populationOf(world)).toBe(3);
  });

  it('does not count an unsold condo', () => {
    const world = createWorld(1);
    addRoom(world, makeRoom({ kind: 'condo', floor: 2, x: 100, vacant: true }));
    expect(populationOf(world)).toBe(0);
  });

  it('counts an occupied hotel room by its capacity', () => {
    const world = createWorld(1);
    addRoom(world, makeRoom({ kind: 'hotelTwin', floor: 2, x: 100, occupancy: 2 }));
    expect(populationOf(world)).toBe(ROOMS.hotelTwin.capacity);
  });

  it('does not count an empty hotel room', () => {
    const world = createWorld(1);
    addRoom(world, makeRoom({ kind: 'hotelTwin', floor: 2, x: 100, occupancy: 0 }));
    expect(populationOf(world)).toBe(0);
  });

  // Audit 2026-09-25 new S2: a housekeeper cleaning is not a guest.
  function keeperIn(world: World, room: Room): void {
    const id = allocId(world);
    addSim(world, {
      id,
      kind: 'staff',
      homeRoomId: null,
      pos: { floor: room.floor, x: room.x },
      inCarId: null,
      inRoomId: room.id,
      route: [],
      state: 'inRoom',
      stress: 0,
      waitStart: null,
      schedule: [],
      nextScheduleIndex: 0,
      stayUntil: null,
      wallet: 0,
      leaveReason: null,
    });
    room.occupancy += 1;
  }

  it('does not count housekeepers cleaning empty hotel rooms', () => {
    const world = createWorld(1);
    addRoom(world, makeRoom({ kind: 'office', floor: 2, x: 100, vacant: false }));
    const before = populationOf(world);
    for (const x of [100, 110, 120]) {
      const room = makeRoom({ kind: 'hotelSingle', floor: 3, x, dirty: true });
      addRoom(world, room);
      keeperIn(world, room);
    }
    expect(populationOf(world)).toBe(before);
  });

  it('still counts a hotel room with a guest in it while a housekeeper is there too', () => {
    const world = createWorld(1);
    const room = makeRoom({ kind: 'hotelTwin', floor: 3, x: 100, occupancy: 1 });
    addRoom(world, room);
    keeperIn(world, room);
    expect(populationOf(world)).toBe(ROOMS.hotelTwin.capacity);
  });

  it('sums population across several rooms', () => {
    const world = createWorld(1);
    addRoom(world, makeRoom({ kind: 'office', floor: 2, x: 100, vacant: false }));
    addRoom(world, makeRoom({ kind: 'condo', floor: 3, x: 100, vacant: false }));
    addRoom(world, makeRoom({ kind: 'hotelSingle', floor: 4, x: 100, occupancy: 1 }));
    expect(populationOf(world)).toBe(6 + 3 + ROOMS.hotelSingle.capacity);
  });
});

function fillPopulation(world: World, target: number): void {
  // Cheap way to hit an exact population number: non-vacant offices worth 6 each.
  let remaining = target;
  let x = 100;
  while (remaining > 0) {
    addRoom(world, makeRoom({ kind: 'office', floor: 2, x, vacant: false }));
    remaining -= 6;
    x += ROOMS.office.width + 1;
  }
}

describe('stars: recomputeStars gates', () => {
  it('stays at 1 star with zero population', () => {
    const world = createWorld(1);
    recomputeStars(world);
    expect(world.stars).toBe(1);
  });

  it('rises to 2 stars once population reaches the threshold', () => {
    const world = createWorld(1);
    fillPopulation(world, STARS[2].population);
    recomputeStars(world);
    expect(world.stars).toBe(2);
  });

  it('does not rise to 3 stars without a security office, even with enough population', () => {
    const world = createWorld(1);
    world.stars = 2;
    fillPopulation(world, STARS[3].population);
    recomputeStars(world);
    expect(world.stars).toBe(2);
  });

  it('rises to 3 stars once a security office is present', () => {
    const world = createWorld(1);
    world.stars = 2;
    fillPopulation(world, STARS[3].population);
    addRoom(world, makeRoom({ kind: 'security', floor: 3, x: 300 }));
    recomputeStars(world);
    expect(world.stars).toBe(3);
  });

  it('rises only one star at a time even if population is enough for two', () => {
    const world = createWorld(1);
    world.stars = 1;
    fillPopulation(world, STARS[4].population); // enough for 2, 3 and 4
    addRoom(world, makeRoom({ kind: 'security', floor: 3, x: 5000 }));
    recomputeStars(world);
    expect(world.stars).toBe(2);
  });

  it('does not rise to 4 stars without a hotel suite, recycling and medical', () => {
    const world = createWorld(1);
    world.stars = 3;
    fillPopulation(world, STARS[4].population);
    world.stats.vipRating = 'fair';
    recomputeStars(world);
    expect(world.stars).toBe(3);
  });

  it('rises to 4 stars when all requirements are met, in vipRating order fair or better', () => {
    const world = createWorld(1);
    world.stars = 3;
    fillPopulation(world, STARS[4].population);
    addRoom(world, makeRoom({ kind: 'hotelSuite', floor: 3, x: 5000 }));
    addRoom(world, makeRoom({ kind: 'recycling', floor: -1, x: 0 }));
    addRoom(world, makeRoom({ kind: 'medical', floor: 3, x: 6000 }));
    world.stats.vipRating = 'fair';
    recomputeStars(world);
    expect(world.stars).toBe(4);
  });

  it('does not rise to 4 stars when vipRating is only poor', () => {
    const world = createWorld(1);
    world.stars = 3;
    fillPopulation(world, STARS[4].population);
    addRoom(world, makeRoom({ kind: 'hotelSuite', floor: 3, x: 5000 }));
    addRoom(world, makeRoom({ kind: 'recycling', floor: -1, x: 0 }));
    addRoom(world, makeRoom({ kind: 'medical', floor: 3, x: 6000 }));
    world.stats.vipRating = 'poor';
    recomputeStars(world);
    expect(world.stars).toBe(3);
  });

  it('rises to 4 stars when vipRating is good (better than the required fair)', () => {
    const world = createWorld(1);
    world.stars = 3;
    fillPopulation(world, STARS[4].population);
    addRoom(world, makeRoom({ kind: 'hotelSuite', floor: 3, x: 5000 }));
    addRoom(world, makeRoom({ kind: 'recycling', floor: -1, x: 0 }));
    addRoom(world, makeRoom({ kind: 'medical', floor: 3, x: 6000 }));
    world.stats.vipRating = 'good';
    recomputeStars(world);
    expect(world.stars).toBe(4);
  });

  it('rises to 5 stars once a metro station is present', () => {
    const world = createWorld(1);
    world.stars = 4;
    fillPopulation(world, STARS[5].population);
    addRoom(world, makeRoom({ kind: 'metro', floor: -1, x: 0 }));
    recomputeStars(world);
    expect(world.stars).toBe(5);
  });

  it('does not rise to 6 stars without a wedding held', () => {
    const world = createWorld(1);
    world.stars = 5;
    fillPopulation(world, STARS[6].population);
    addRoom(world, makeRoom({ kind: 'cathedral', floor: 3, x: 5000 }));
    world.stats.weddingsHeld = 0;
    recomputeStars(world);
    expect(world.stars).toBe(5);
  });

  it('rises to 6 stars (Tower) once a wedding has been held and a cathedral exists', () => {
    const world = createWorld(1);
    world.stars = 5;
    fillPopulation(world, STARS[6].population);
    addRoom(world, makeRoom({ kind: 'cathedral', floor: 3, x: 5000 }));
    world.stats.weddingsHeld = 1;
    recomputeStars(world);
    expect(world.stars).toBe(6);
  });

  it('logs the change using the STARS label', () => {
    const world = createWorld(1);
    fillPopulation(world, STARS[2].population);
    recomputeStars(world);
    const last = world.log[world.log.length - 1];
    expect(last?.text).toContain(STARS[2].label);
  });
});

// Audit 2026-09-25 I S4: the tests above drop the suite, recycling and medical together, so
// any one of those checks could go missing; and no test held a wedding with no cathedral.
// Each case below leaves out exactly one requirement, against a control with all of them.
describe('stars: each 4-star and Tower requirement on its own (audit I S4)', () => {
  type Need = 'hotelSuite' | 'recycling' | 'medical' | 'vipRating' | 'cathedral';

  function fourStarWorld(skip: Need | null): World {
    const world = createWorld(1);
    world.stars = 3;
    fillPopulation(world, STARS[4].population);
    if (skip !== 'hotelSuite') addRoom(world, makeRoom({ kind: 'hotelSuite', floor: 3, x: 5000 }));
    if (skip !== 'recycling') addRoom(world, makeRoom({ kind: 'recycling', floor: -1, x: 0 }));
    if (skip !== 'medical') addRoom(world, makeRoom({ kind: 'medical', floor: 3, x: 6000 }));
    world.stats.vipRating = skip === 'vipRating' ? 'none' : 'fair';
    return world;
  }

  function towerWorld(skip: Need | null): World {
    const world = createWorld(1);
    world.stars = 5;
    fillPopulation(world, STARS[6].population);
    addRoom(world, makeRoom({ kind: 'metro', floor: -1, x: 0 }));
    if (skip !== 'cathedral') addRoom(world, makeRoom({ kind: 'cathedral', floor: 3, x: 5000 }));
    world.stats.weddingsHeld = 1;
    return world;
  }

  const cases: { name: string; world: () => World; stars: number }[] = [
    { name: 'I S4: control, every 4-star requirement met, rises to 4', world: () => fourStarWorld(null), stars: 4 },
    { name: 'I S4: no hotel suite, holds at 3', world: () => fourStarWorld('hotelSuite'), stars: 3 },
    { name: 'I S4: no recycling center, holds at 3', world: () => fourStarWorld('recycling'), stars: 3 },
    { name: 'I S4: no medical center, holds at 3', world: () => fourStarWorld('medical'), stars: 3 },
    { name: 'I S4: no VIP rating, holds at 3', world: () => fourStarWorld('vipRating'), stars: 3 },
    { name: 'I S4: control, a cathedral and a wedding held, rises to Tower', world: () => towerWorld(null), stars: 6 },
    { name: 'I S4: a wedding held but no cathedral, holds at 5', world: () => towerWorld('cathedral'), stars: 5 },
    // Audit 2026-09-28 I S1: the metro was the one condition with only a positive case.
    { name: 'I S1: 5-star population and no metro, holds at 4', world: () => fiveStarWorld(false), stars: 4 },
    { name: 'I S1: control, 5-star population and a metro, rises to 5', world: () => fiveStarWorld(true), stars: 5 },
  ];

  function fiveStarWorld(metro: boolean): World {
    const world = createWorld(1);
    world.stars = 4;
    fillPopulation(world, STARS[5].population);
    if (metro) addRoom(world, makeRoom({ kind: 'metro', floor: -1, x: 0 }));
    return world;
  }

  for (const c of cases) {
    it(c.name, () => {
      const world = c.world();
      recomputeStars(world);
      expect(world.stars).toBe(c.stars);
    });
  }
});

// DECISIONS 2026-09-29, Matt: "Stars never fall". A star once earned stays, whatever the
// population does afterwards; these replace the old fall tests (audit I S3, A M7).
describe('stars: never fall', () => {
  it('keeps 2 stars when every tenant has gone', () => {
    const world = createWorld(1);
    world.stars = 2;
    world.rooms.clear();
    recomputeStars(world);
    expect(world.population).toBe(0);
    expect(world.stars).toBe(2);
  });

  it('stays at 1 star with nobody in the tower', () => {
    const world = createWorld(1);
    world.stars = 1;
    recomputeStars(world);
    expect(world.stars).toBe(1);
  });

  it('keeps 3 stars when a requirement (like security) is no longer met', () => {
    const world = createWorld(1);
    world.stars = 3;
    fillPopulation(world, STARS[3].population);
    recomputeStars(world);
    expect(world.stars).toBe(3);
  });

  it('keeps 4 stars at 1,002 people and at 306 people', () => {
    for (const people of [1002, 306]) {
      const world = createWorld(1);
      world.stars = 4;
      fillPopulation(world, people);
      recomputeStars(world);
      expect(world.population).toBe(people);
      expect(world.stars).toBe(4);
      expect(world.log.some((l) => /Fell to/.test(l.text))).toBe(false);
    }
  });

  // The report behind the decision: 155 offices (930 people) and twin rooms that count only while
  // a guest is inside. The tower sits over 1,000 at night and under it every afternoon.
  it('holds 3 stars through the afternoon hotel dip: one star.gained, and 3-star rooms stay open', () => {
    const world = createWorld(1);
    world.stars = 2;
    for (let x = 100; x < 220; x++) addRoom(world, makeRoom({ kind: 'lobby', floor: 1, x }));
    addRoom(world, makeRoom({ kind: 'security', floor: 3, x: 0 }));
    for (let i = 0; i < 155; i++) {
      addRoom(world, makeRoom({ kind: 'office', floor: 10 + Math.floor(i / 20), x: (i % 20) * 10 }));
    }
    const twins: Room[] = [];
    for (let i = 0; i < 40; i++) {
      const twin = makeRoom({ kind: 'hotelTwin', floor: 30 + Math.floor(i / 20), x: (i % 20) * 7 });
      addRoom(world, twin);
      twins.push(twin);
    }
    const guestsIn = (inside: boolean): void => {
      for (const twin of twins) twin.occupancy = inside ? 1 : 0;
    };

    for (let day = 0; day < 3; day++) {
      guestsIn(true); // night
      world.time.minute = day * 1440 + 22 * 60;
      recomputeStars(world);
      expect(world.population).toBe(1010);
      expect(world.stars).toBe(3);
      guestsIn(false); // afternoon: every guest has checked out
      world.time.minute = day * 1440 + 1440 + 13 * 60;
      recomputeStars(world);
      expect(world.population).toBe(930);
      expect(world.stars).toBe(3);
      // A 3-star room still builds while the tower is under 1,000.
      expect(canBuild(world, 'parkingSpace', -1, 150 + day * 5)).toEqual({ ok: true });
    }
    expect(world.story.recent.filter((b) => b.code === 'star.gained')).toHaveLength(1);
    expect(world.story.recent.some((b) => b.code === 'star.lost')).toBe(false);
    expect(world.milestones.filter((m) => m.kind === 'star:3')).toHaveLength(1);
  });
});

// A save written while stars could fall may hold a rating under a star it already earned.
describe('stars: a save from the old rule', () => {
  function reloaded(stars: Star, milestoneStars: Star[]): { before: World; after: World } {
    const before = createWorld(1);
    before.stars = stars;
    before.milestones = milestoneStars.map((n) => ({ kind: `star:${n}`, minute: 100 * n, text: `The tower reached ${n} stars.` }));
    const loaded = deserialize(serialize(before));
    if (!loaded.ok) throw new Error(loaded.reason);
    return { before, after: loaded.world };
  }

  it('loads at the highest star it earned, silently', () => {
    const { before, after } = reloaded(2, [2, 3]);
    expect(after.stars).toBe(3);
    expect(after.log).toEqual(before.log);
    expect(after.story.recent).toEqual(before.story.recent);
    expect(after.milestones).toEqual(before.milestones);
  });

  it('loads as it is with no star milestones, or with a rating already at or above them', () => {
    expect(reloaded(2, []).after.stars).toBe(2);
    expect(reloaded(4, [2, 3]).after.stars).toBe(4);
    expect(reloaded(3, [2, 3]).after.stars).toBe(3);
  });
});
