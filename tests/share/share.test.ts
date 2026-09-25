import { describe, expect, it } from 'vitest';

import { parseChallenge, shareMessage, shareStats, shareText, shareUrl, SITE_URL } from '../../src/share/share';
import { createWorld } from '../../src/sim/world';
import type { Room, World } from '../../src/sim/types';

function makeRoom(overrides: Partial<Room>): Room {
  return {
    id: overrides.id ?? Math.floor(Math.random() * 1_000_000),
    kind: 'office',
    floor: 1,
    x: 100,
    width: 4,
    height: 1,
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

function addRoom(world: World, overrides: Partial<Room>): void {
  const room = makeRoom(overrides);
  world.rooms.set(room.id, room);
}

describe('shareStats', () => {
  it('reads 0 floors from a world with no rooms', () => {
    const world = createWorld(1);
    expect(shareStats(world)).toEqual({ floors: 0, people: 0, stars: 1, start: 1 });
  });

  it('takes the highest floor a room reaches, ignoring rooms underground', () => {
    const world = createWorld(1);
    addRoom(world, { id: 1, floor: 1, height: 1 });
    addRoom(world, { id: 2, floor: 5, height: 3 }); // tops out at floor 7
    addRoom(world, { id: 3, floor: -2, height: 1 }); // basement, does not count
    world.population = 42;
    world.stars = 3;
    expect(shareStats(world)).toEqual({ floors: 7, people: 42, stars: 3, start: 1 });
  });
});

describe('shareText', () => {
  it('uses singular forms for one floor and one person', () => {
    expect(shareText({ floors: 1, people: 1, stars: 1 })).toBe(
      "I'm building a 1-floor tower with 1 person in Hundred Stories, a free tower-building game you play in your browser. Think you can do better?",
    );
  });

  it('uses plural forms otherwise, with thousands separators', () => {
    expect(shareText({ floors: 12, people: 1234, stars: 4 })).toBe(
      "I'm building a 12-floor tower with 1,234 people in Hundred Stories, a free tower-building game you play in your browser. Think you can do better?",
    );
  });

  it('keeps the floor count singular even at 0, and pluralizes people at 0', () => {
    expect(shareText({ floors: 0, people: 0, stars: 1 })).toContain('0-floor tower with 0 people');
  });
});

describe('shareMessage', () => {
  it('joins the text and the link with a newline', () => {
    const stats = { floors: 12, people: 340, stars: 4 };
    expect(shareMessage(stats)).toBe(`${shareText(stats)}\n${shareUrl(stats)}`);
  });
});

describe('shareUrl', () => {
  it('carries the numbers in the query string against the site url', () => {
    expect(shareUrl({ floors: 12, people: 340, stars: 4 })).toBe(`${SITE_URL}?floors=12&people=340&stars=4`);
  });

  it('carries the starting number as tower, so a friend can start the same tower', () => {
    expect(shareUrl({ floors: 12, people: 340, stars: 4, start: 123456 })).toBe(
      `${SITE_URL}?floors=12&people=340&stars=4&tower=123456`,
    );
    expect(shareUrl({ floors: 12, people: 340, stars: 4, start: 0 })).toBe(`${SITE_URL}?floors=12&people=340&stars=4&tower=0`);
  });

  it('never carries the word seed', () => {
    const world = createWorld(98765);
    expect(shareUrl(shareStats(world))).not.toMatch(/seed/i);
    expect(shareMessage(shareStats(world))).not.toMatch(/seed/i);
  });

  it('leaves out a starting number that is not a whole number in range', () => {
    expect(shareUrl({ floors: 12, people: 340, stars: 4, start: -5 })).toBe(`${SITE_URL}?floors=12&people=340&stars=4`);
    expect(shareUrl({ floors: 12, people: 340, stars: 4, start: 1.5 })).toBe(`${SITE_URL}?floors=12&people=340&stars=4`);
  });

  it('round trips a tower: the link a friend opens reads back the same starting number', () => {
    const world = createWorld(98765);
    addRoom(world, { id: 1, floor: 1, height: 1 });
    world.stars = 2;
    const url = shareUrl(shareStats(world));
    expect(parseChallenge(url.slice(url.indexOf('?')))).toEqual({ floors: 1, people: 0, stars: 2, start: 98765 });
  });
});

describe('parseChallenge', () => {
  it('accepts a valid set of numbers', () => {
    expect(parseChallenge('?floors=12&people=340&stars=4')).toEqual({ floors: 12, people: 340, stars: 4 });
  });

  it('accepts the range edges, 1 and 6 stars', () => {
    expect(parseChallenge('?floors=1&people=0&stars=1')).toEqual({ floors: 1, people: 0, stars: 1 });
    expect(parseChallenge('?floors=200&people=999999&stars=6')).toEqual({ floors: 200, people: 999999, stars: 6 });
  });

  it('rejects a missing parameter', () => {
    expect(parseChallenge('?floors=12&people=340')).toBeNull();
    expect(parseChallenge('')).toBeNull();
  });

  it('rejects a non-integer value', () => {
    expect(parseChallenge('?floors=12.5&people=340&stars=4')).toBeNull();
    expect(parseChallenge('?floors=abc&people=340&stars=4')).toBeNull();
    expect(parseChallenge('?floors=-1&people=340&stars=4')).toBeNull();
  });

  it('rejects values out of range', () => {
    expect(parseChallenge('?floors=0&people=340&stars=4')).toBeNull();
    expect(parseChallenge('?floors=201&people=340&stars=4')).toBeNull();
    expect(parseChallenge('?floors=12&people=1000000&stars=4')).toBeNull();
    expect(parseChallenge('?floors=12&people=340&stars=0')).toBeNull();
    expect(parseChallenge('?floors=12&people=340&stars=7')).toBeNull();
  });

  it('reads the starting number when the link carries one, and still reads the challenge when it does not', () => {
    expect(parseChallenge('?floors=12&people=340&stars=4&tower=123456')).toEqual({ floors: 12, people: 340, stars: 4, start: 123456 });
    expect(parseChallenge('?floors=12&people=340&stars=4&tower=abc')).toEqual({ floors: 12, people: 340, stars: 4 });
    expect(parseChallenge('?floors=12&people=340&stars=4&tower=-1')).toEqual({ floors: 12, people: 340, stars: 4 });
    expect(parseChallenge('?floors=12&people=340&stars=4&tower=99999999999')).toEqual({ floors: 12, people: 340, stars: 4 });
  });

  it('rejects huge values that would still pass a naive number check', () => {
    expect(parseChallenge('?floors=99999999999999999999&people=340&stars=4')).toBeNull();
  });
});
