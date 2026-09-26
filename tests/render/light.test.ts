// Light and time (look round L2): the multiply layer's tint by minute of day, and the window
// state each room shows, chosen from the world and the hour.

import { describe, expect, it } from 'vitest';
import {
  floorsWithPeople,
  inLightWindow,
  lerpColor,
  lightBand,
  lightTintAt,
  NIGHT_GRADE,
  roomNight,
  windowStateOf,
  windowStatesFor,
} from '../../src/render/light';
import { skyAt } from '../../src/render/sky';
import { mix } from '../../src/render/venue';
import { ROOMS } from '../../src/sim/rules';
import type { Room, RoomKind, Sim, World } from '../../src/sim/types';

const at = (h: number, m = 0): number => h * 60 + m;

describe('light tint by minute of day', () => {
  it('sits on the anchors (D-9: night to 05:30, dawn 06:00, noon 06:45 to 17:30, evening 18:30, night from 19:15)', () => {
    expect(lightTintAt(0)).toBe(0x6078b0);
    expect(lightTintAt(330)).toBe(0x6078b0);
    expect(lightTintAt(360)).toBe(0xbfd8ff);
    expect(lightTintAt(405)).toBe(0xffffff);
    expect(lightTintAt(at(12))).toBe(0xffffff);
    expect(lightTintAt(1050)).toBe(0xffffff);
    expect(lightTintAt(1110)).toBe(0xffd0a0);
    expect(lightTintAt(1155)).toBe(0x6078b0);
    expect(lightTintAt(at(23))).toBe(0x6078b0);
    expect(lightTintAt(at(2))).toBe(0x6078b0);
    expect(lightTintAt(at(5))).toBe(0x6078b0);
  });

  it('interpolates linearly between anchors', () => {
    expect(lightTintAt(345)).toBe(lerpColor(0x6078b0, 0xbfd8ff, 0.5));
    expect(lightTintAt(390)).toBe(lerpColor(0xbfd8ff, 0xffffff, 30 / 45));
    expect(lightTintAt(at(18))).toBe(lerpColor(0xffffff, 0xffd0a0, 0.5));
    expect(lightTintAt(1125)).toBe(lerpColor(0xffd0a0, 0x6078b0, 15 / 45));
  });

  it('warms the tower with the sky: day until 17:30, the evening peak at the sky dusk, 18:30 (D-9)', () => {
    expect(lightTintAt(at(17, 30))).toBe(0xffffff);
    expect(lightTintAt(at(18))).not.toBe(0xffd0a0); // no longer the peak before the sky turns
    expect(skyAt(at(18, 30)).bottom).toBe(0xe08a7a); // the sky's dusk bottom
    expect(lightTintAt(at(18, 30))).toBe(0xffd0a0); // and the tower's warm tint, in the same frame
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
  it('is one value all day and one per hour at night, outside the dusk and dawn windows', () => {
    expect(lightBand(false, at(9))).toBe(-1);
    expect(lightBand(false, at(15, 59))).toBe(-1);
    expect(lightBand(true, at(19, 16))).toBe(19);
    expect(lightBand(true, at(19, 59))).toBe(19);
    expect(lightBand(true, at(20))).toBe(20);
    expect(lightBand(true, at(24 + 2))).toBe(2);
    expect(lightBand(true, at(5, 14))).toBe(5);
    expect(lightBand(false, at(6, 31))).toBe(-1);
  });

  it('moves every five game minutes from 18:00 to 19:15 and from 05:15 to 06:30 (D-15)', () => {
    expect(lightBand(false, at(18))).toBe(10000 + 216);
    expect(lightBand(false, at(18, 4))).toBe(10000 + 216);
    expect(lightBand(false, at(18, 5))).toBe(10000 + 217);
    // The global night flag does not matter inside a window: the rooms switch on their own clocks.
    expect(lightBand(true, at(18, 40))).toBe(lightBand(false, at(18, 40)));
    expect(lightBand(true, at(19, 15))).toBe(10000 + 231);
    expect(lightBand(true, at(5, 15))).toBe(10000 + 63);
    expect(lightBand(false, at(6, 30))).toBe(10000 + 78);
    expect([at(17, 59), at(18), at(19, 15), at(19, 16), at(5, 14), at(5, 15), at(6, 30), at(6, 31)].map(inLightWindow)).toEqual([
      false, true, true, false, false, true, true, false,
    ]);
  });
});

describe('D-15: the tower lights window by window', () => {
  const SEEDS = [1, 7, 42, 12345, -9];

  it('gives no room a night state before 18:15 and every room one by 19:00, and puts them out between 05:30 and 06:15', () => {
    const none = new Set<number>();
    const wrong: string[] = [];
    for (const seed of SEEDS) {
      for (let id = 1; id <= 200; id++) {
        const office = room('office', { id, occupancy: 2 });
        for (let m = 0; m < 1440; m++) {
          const state = windowStateOf(office, roomNight(seed, id, m), none);
          if ((m < 330 || m >= 1140) && state !== 'lit') wrong.push(`seed ${seed} room ${id} minute ${m}: ${state}`);
          if (m >= 375 && m < 1095 && state !== 'day') wrong.push(`seed ${seed} room ${id} minute ${m}: ${state}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('spreads the switch across the hour, so some rooms are lit and some not at 18:37', () => {
    const on = Array.from({ length: 200 }, (_, i) => roomNight(7, i + 1, at(18, 37)));
    expect(on.filter(Boolean).length).toBeGreaterThan(40);
    expect(on.filter((x) => !x).length).toBeGreaterThan(40);
    const off = Array.from({ length: 200 }, (_, i) => roomNight(7, i + 1, at(5, 52)));
    expect(off.filter(Boolean).length).toBeGreaterThan(40);
    expect(off.filter((x) => !x).length).toBeGreaterThan(40);
  });

  it('takes each room its own minutes from the seed and the id (venue.ts mix), and never from world.rng', () => {
    for (const [seed, id] of [[7, 12], [3, 400], [-5, 1]] as const) {
      const h = mix((seed | 0) ^ 0x51ed27, id);
      const on = 1095 + (h % 45);
      const off = 330 + ((h >>> 8) % 45);
      expect(roomNight(seed, id, on - 1)).toBe(false);
      expect(roomNight(seed, id, on)).toBe(true);
      expect(roomNight(seed, id, off - 1)).toBe(true);
      expect(roomNight(seed, id, off)).toBe(false);
      expect(roomNight(seed, id, on + 1440)).toBe(true); // any day
    }
  });
});

describe('D-4: the night grade', () => {
  it('leaves lit rooms and the day alone and dims the empty ones', () => {
    expect(NIGHT_GRADE).toEqual({ day: 0xffffff, lit: 0xffffff, vacant: 0x9aa5c6, housekeeping: 0xb4bcd6 });
  });
});
