// Venue identity (package 2): the treatment, the brand on the sign and the accent are a pure
// function of the seed and the room id, and the room panel names the venue the way its sign does.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TREATMENT_LABELS, VENUE_NAMES, venueLine, venueOf, venueOpen, type VenueKind } from '../../src/render/venue';
import { ROOMS } from '../../src/sim/rules';
import type { Room, RoomKind } from '../../src/sim/types';
import { addRoom, allocId, createWorld } from '../../src/sim/world';
import { createQueryPanel, type PanelContext } from '../../src/ui/panels';
import { FakeDom, type FakeElement } from '../ui/fake-dom';

const KINDS: readonly VenueKind[] = ['office', 'shop', 'restaurant'];

describe('venueOf', () => {
  it('is pure and stable: the same seed and room give the same venue on every call', () => {
    for (const kind of KINDS) {
      for (let id = 1; id < 300; id++) expect(venueOf(42, id, kind)).toEqual(venueOf(42, id, kind));
    }
  });

  it('differs between seeds for the same rooms', () => {
    for (const kind of ['shop', 'restaurant'] as const) {
      let differ = 0;
      for (let id = 1; id < 100; id++) if (venueOf(1, id, kind).name !== venueOf(2, id, kind).name) differ++;
      expect(differ).toBeGreaterThan(70);
    }
  });

  it('spreads three treatments, and a name from the treatment’s own eight, across a street of venues', () => {
    for (const kind of ['shop', 'restaurant'] as const) {
      expect(VENUE_NAMES[kind]).toHaveLength(24);
      expect(new Set(VENUE_NAMES[kind]).size).toBe(24);
      const treatments = new Set<number>();
      const names = new Set<string>();
      for (let id = 1; id < 400; id++) {
        const v = venueOf(9, id, kind);
        treatments.add(v.treatment);
        names.add(v.name);
        const index = VENUE_NAMES[kind].indexOf(v.name);
        expect(Math.floor(index / 8)).toBe(v.treatment);
      }
      expect(treatments.size).toBe(3);
      expect(names.size).toBe(24);
    }
  });

  it('gives an office a treatment and an accent but no sign name', () => {
    const v = venueOf(3, 17, 'office');
    expect(v.name).toBe('');
    expect([0, 1, 2]).toContain(v.treatment);
    expect(venueLine('office', v)).toBe(`A ${TREATMENT_LABELS.office[v.treatment]}`);
  });

  it('opens shops over shopping hours, restaurants lunch to dinner, offices on weekday working hours', () => {
    const at = (day: number, hour: number, minute = 0): number => day * 1440 + hour * 60 + minute;
    expect(venueOpen('shop', at(0, 9, 59))).toBe(false);
    expect(venueOpen('shop', at(0, 10))).toBe(true);
    expect(venueOpen('shop', at(0, 21))).toBe(false);
    expect(venueOpen('restaurant', at(0, 11, 30))).toBe(true);
    expect(venueOpen('restaurant', at(0, 22))).toBe(false);
    expect(venueOpen('office', at(0, 13))).toBe(true);
    expect(venueOpen('office', at(0, 22))).toBe(false);
    expect(venueOpen('office', at(2, 13))).toBe(false); // the weekend day
  });
});

describe('room panel venue name', () => {
  let dom: FakeDom;
  let uninstall: () => void;
  beforeEach(() => {
    dom = new FakeDom();
    uninstall = dom.install();
  });
  afterEach(() => uninstall());

  function room(world: ReturnType<typeof createWorld>, kind: RoomKind): Room {
    const r: Room = {
      id: allocId(world), kind, floor: 3, x: 100, width: ROOMS[kind].width, height: 1, eval: 1, tenants: [], occupancy: 0,
      builtAtMinute: 0, vacant: false, dirty: false, infested: false, lowEvalSinceMinute: null, onFire: false, rent: 100,
    };
    addRoom(world, r);
    return r;
  }

  const ctx: PanelContext = { apply: () => ({ ok: true }) as never, notice: () => {}, close: () => {}, reducedMotion: false, setReducedMotion: () => {} };
  const venueText = (panel: unknown): string[] =>
    (panel as FakeElement).descendants().filter((n) => n.className.includes('hs-venue')).map((n) => n.textContent);

  it('shows the same name the sign shows, for every shop and restaurant', () => {
    const world = createWorld(31);
    for (const kind of ['shop', 'restaurant'] as const) {
      for (let i = 0; i < 6; i++) {
        const r = room(world, kind);
        const lines = venueText(createQueryPanel({ world } as never, { roomId: r.id }, ctx));
        expect(lines).toHaveLength(1);
        const name = venueOf(world.seed, r.id, kind).name;
        expect(name.length).toBeGreaterThan(0);
        expect(lines[0]?.startsWith(`${name}, a `)).toBe(true);
      }
    }
  });

  it('names an office by its line of work and leaves other rooms alone', () => {
    const world = createWorld(31);
    const office = room(world, 'office');
    const v = venueOf(world.seed, office.id, 'office');
    expect(venueText(createQueryPanel({ world } as never, { roomId: office.id }, ctx))).toEqual([`A ${TREATMENT_LABELS.office[v.treatment]}`]);
    const condo = room(world, 'condo');
    expect(venueText(createQueryPanel({ world } as never, { roomId: condo.id }, ctx))).toEqual([]);
  });
});
