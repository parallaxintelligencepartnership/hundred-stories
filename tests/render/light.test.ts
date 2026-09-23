// Light and time (look round L2): the multiply layer's tint by minute of day, and the window
// state each room shows, chosen from the world and the hour.

import { describe, expect, it } from 'vitest';
import {
  floorsWithPeople,
  lightBand,
  lightTintAt,
  windowStateOf,
  windowStatesFor,
} from '../../src/render/light';
import { ROOMS } from '../../src/sim/rules';
import type { Room, RoomKind, Sim, World } from '../../src/sim/types';

const at = (h: number, m = 0): number => h * 60 + m;

describe('light tint by minute of day', () => {
  it('sits on the anchors', () => {
    expect(lightTintAt(at(6))).toBe(0xbfd8ff);
    expect(lightTintAt(at(7))).toBe(0xffffff);
    expect(lightTintAt(at(12))).toBe(0xffffff);
    expect(lightTintAt(at(17))).toBe(0xffffff);
    expect(lightTintAt(at(18))).toBe(0xffd0a0);
    expect(lightTintAt(at(19))).toBe(0x6078b0);
    expect(lightTintAt(at(23))).toBe(0x6078b0);
    expect(lightTintAt(at(2))).toBe(0x6078b0);
    expect(lightTintAt(at(5))).toBe(0x6078b0);
  });

  it('interpolates linearly between anchors at 06:30 and 18:30', () => {
    // halfway from #bfd8ff to #ffffff, and from #ffd0a0 to #6078b0, rounded per channel
    expect(lightTintAt(at(6, 30))).toBe(0xdfecff);
    expect(lightTintAt(at(18, 30))).toBe(0xb0a4a8);
  });

  it('wraps past midnight and before zero', () => {
    expect(lightTintAt(at(24 + 12))).toBe(0xffffff);
    expect(lightTintAt(-at(12))).toBe(0xffffff);
  });
});

function room(kind: RoomKind, patch: Partial<Room> = {}): Room {
  const rule = ROOMS[kind];
  return {
    id: 1,
    kind,
    floor: 3,
    x: 100,
    width: rule.width,
    height: rule.height,
    eval: 0.7,
    tenants: [],
    occupancy: 0,
    builtAtMinute: 0,
    vacant: false,
    dirty: false,
    infested: false,
    lowEvalSinceMinute: null,
    onFire: false,
    rent: 100,
    ...patch,
  };
}

function stubWorld(sims: Partial<Sim>[]): World {
  const map = new Map<number, Sim>();
  sims.forEach((s, i) => map.set(i + 1, { id: i + 1, state: 'walking', inCarId: null, pos: { floor: 1, x: 0 }, ...s } as Sim));
  return { sims: map } as unknown as World;
}

describe('window state chooser', () => {
  const none = new Set<number>();

  it('is day for every room by day, whatever is inside', () => {
    expect(windowStateOf(room('office', { occupancy: 3 }), false, none)).toBe('day');
    expect(windowStateOf(room('hotelSingle', { dirty: true }), false, none)).toBe('day');
    expect(windowStateOf(room('condo', { vacant: true }), false, none)).toBe('day');
  });

  it('is lit at night with anyone inside', () => {
    expect(windowStateOf(room('office', { occupancy: 1 }), true, none)).toBe('lit');
    expect(windowStateOf(room('hotelTwin', { occupancy: 2, dirty: true }), true, none)).toBe('lit');
  });

  it('is vacant at night with nobody inside', () => {
    expect(windowStateOf(room('condo', { vacant: true }), true, none)).toBe('vacant');
    expect(windowStateOf(room('office', { tenants: [7] }), true, none)).toBe('vacant');
    expect(windowStateOf(room('hotelSuite'), true, none)).toBe('vacant');
  });

  it('is housekeeping at night for an empty dirty hotel room only', () => {
    expect(windowStateOf(room('hotelSingle', { dirty: true }), true, none)).toBe('housekeeping');
    expect(windowStateOf(room('office', { dirty: true }), true, none)).toBe('vacant');
  });

  it('lights a lobby while people stand on its floor', () => {
    const world = stubWorld([
      { pos: { floor: 1, x: 190 } },
      { pos: { floor: 5, x: 190 }, state: 'riding' },
      { pos: { floor: 6, x: 190 }, state: 'outside' },
    ]);
    const floors = floorsWithPeople(world);
    expect([...floors]).toEqual([1]);
    expect(windowStateOf(room('lobby', { floor: 1 }), true, floors)).toBe('lit');
    expect(windowStateOf(room('lobby', { floor: 5 }), true, floors)).toBe('vacant');
    expect(windowStateOf(room('lobby', { floor: 1 }), false, floors)).toBe('day');
  });

  it('offers housekeeping to hotel kinds only', () => {
    expect(windowStatesFor('hotelSingle')).toContain('housekeeping');
    expect(windowStatesFor('office')).toEqual(['day', 'lit', 'vacant']);
  });
});

describe('light band for the reconcile gate', () => {
  it('is one value all day and one per hour at night', () => {
    expect(lightBand(false, at(9))).toBe(-1);
    expect(lightBand(false, at(15, 59))).toBe(-1);
    expect(lightBand(true, at(19, 5))).toBe(19);
    expect(lightBand(true, at(19, 59))).toBe(19);
    expect(lightBand(true, at(20))).toBe(20);
    expect(lightBand(true, at(24 + 2))).toBe(2);
  });
});
