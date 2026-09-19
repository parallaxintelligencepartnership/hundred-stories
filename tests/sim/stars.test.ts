import { describe, expect, it } from 'vitest';
import { createWorld, addRoom } from '../../src/sim/world';
import { ROOMS, STARS } from '../../src/sim/rules';
import { populationOf, recomputeStars } from '../../src/sim/stars';
import type { Room, RoomKind, World } from '../../src/sim/types';

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

describe('stars: falling', () => {
  it('falls back a star when population drops below the threshold', () => {
    const world = createWorld(1);
    world.stars = 2;
    world.rooms.clear();
    recomputeStars(world);
    expect(world.stars).toBe(1);
  });

  it('never falls below 1 star', () => {
    const world = createWorld(1);
    world.stars = 1;
    recomputeStars(world);
    expect(world.stars).toBe(1);
  });

  it('does not fall just because a requirement (like security) is no longer met', () => {
    const world = createWorld(1);
    world.stars = 3;
    fillPopulation(world, STARS[3].population);
    // No security office built, but population alone should not cause a fall from 3.
    recomputeStars(world);
    expect(world.stars).toBe(3);
  });
});
