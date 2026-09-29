// The News panel in three sections (Matt, 2026-09-29): Needs you now, derived from the world;
// Today, the log of the current game day with Show older revealing Yesterday and Earlier; and
// Milestones, the saved firsts on the world, newest first. Each with its empty state.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EVENTS, ROOMS } from '../../src/sim/rules';
import type { ActiveEvent, Room, RoomKind, World } from '../../src/sim/types';
import { addRoom, allocId, createWorld, log } from '../../src/sim/world';
import { createLogPanel, type PanelContext } from '../../src/ui/panels';
import { FakeDom, type FakeElement } from './fake-dom';

let dom: FakeDom;
let uninstall: () => void;
beforeEach(() => {
  dom = new FakeDom();
  uninstall = dom.install();
});
afterEach(() => uninstall());

function room(world: World, kind: RoomKind, floor: number, x: number, extra: Partial<Room> = {}): Room {
  const r: Room = {
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
    ...extra,
  };
  addRoom(world, r);
  return r;
}

function mount(world: World, extra: Partial<PanelContext> = {}) {
  const centered: { floor: number; x: number }[] = [];
  let closed = 0;
  const ctx: PanelContext = {
    apply: () => ({ ok: true }),
    notice: () => {},
    close: () => {
      closed += 1;
    },
    reducedMotion: false,
    setReducedMotion: () => {},
    centerOn: (floor, x) => centered.push({ floor, x }),
    ...extra,
  };
  const panel = createLogPanel({ world } as never, ctx) as unknown as FakeElement & { refresh(): void };
  const sectionOf = (title: string): FakeElement => {
    const found = panel
      .descendants()
      .find((n) => n.className === 'hs-section' || n.className.startsWith('hs-section '))
      ?.parentNode?.children.find((n) => n.children[0]?.textContent === title);
    if (!found) throw new Error(`no section ${title}`);
    return found;
  };
  /** The visible line texts of a section's lists, in order. */
  const lines = (title: string): string[] =>
    sectionOf(title)
      .descendants()
      .filter((n) => n.className.includes('hs-log-item') && !n.hidden && !n.parentNode?.hidden)
      .map((n) => n.children.find((c) => c.className === 'hs-log-text' || c.className === 'hs-need-go')?.textContent ?? n.textContent);
  return { panel, centered, closed: () => closed, sectionOf, lines };
}

const DAY = 1440;
const tap = (node: FakeElement | undefined): void => {
  if (!node) throw new Error('nothing to tap');
  for (const fn of node.listeners.get('click') ?? []) fn({ preventDefault() {}, stopPropagation() {} });
};

describe('News panel: sections', () => {
  it('lists the three sections in order', () => {
    const { panel } = mount(createWorld(1));
    const titles = panel.descendants().filter((n) => n.className === 'hs-section-title').map((n) => n.textContent);
    expect(titles).toEqual(['Needs you now', 'Today', 'Milestones']);
  });

  it('says each empty state on a new tower', () => {
    const { lines } = mount(createWorld(1));
    expect(lines('Needs you now')).toEqual(['Nothing needs you right now.']);
    expect(lines('Today')).toEqual(['Nothing has happened yet.']);
    expect(lines('Milestones')).toEqual(['Your first milestone is coming.']);
  });
});

describe('News panel: Needs you now', () => {
  it('names the fire floor, says there is no security, and centers the camera on the burning room', () => {
    const world = createWorld(1);
    const office = room(world, 'office', 12, 100, { onFire: true });
    world.events.push({ kind: 'fire', roomIds: [office.id], startedAt: 0, spreadAt: 30 });
    const { lines, sectionOf, centered } = mount(world);
    expect(lines('Needs you now')).toEqual(['Fire on floor 12, no security. Call a helicopter or let it burn out.']);
    const go = sectionOf('Needs you now').descendants().find((n) => n.className === 'hs-need-go');
    tap(go);
    expect(centered).toEqual([{ floor: 12, x: 104 }]);
  });

  it('points at the new room when the fire moves on the same floor (the line text does not change)', () => {
    const world = createWorld(1);
    const first = room(world, 'office', 12, 100, { onFire: true });
    const fire: ActiveEvent = { kind: 'fire', roomIds: [first.id], startedAt: 0, spreadAt: 30 };
    world.events.push(fire);
    const { lines, sectionOf, centered, panel } = mount(world);
    const next = room(world, 'office', 12, 200, { onFire: true });
    first.onFire = false;
    fire.roomIds = [next.id];
    panel.refresh();
    expect(lines('Needs you now')).toEqual(['Fire on floor 12, no security. Call a helicopter or let it burn out.']);
    tap(sectionOf('Needs you now').descendants().find((n) => n.className === 'hs-need-go'));
    expect(centered).toEqual([{ floor: 12, x: 204 }]);
  });

  it('steps aside on a phone after centering, and stays open on a desk', () => {
    const world = createWorld(1);
    const office = room(world, 'office', 12, 100, { onFire: true });
    world.events.push({ kind: 'fire', roomIds: [office.id], startedAt: 0, spreadAt: 30 });
    const win = (globalThis as { window: { innerWidth?: number } }).window;
    win.innerWidth = 390;
    const phone = mount(world);
    tap(phone.sectionOf('Needs you now').descendants().find((n) => n.className === 'hs-need-go'));
    expect(phone.centered).toEqual([{ floor: 12, x: 104 }]);
    expect(phone.closed()).toBe(1);
    win.innerWidth = 1440;
    const desk = mount(world);
    tap(desk.sectionOf('Needs you now').descendants().find((n) => n.className === 'hs-need-go'));
    expect(desk.centered).toEqual([{ floor: 12, x: 104 }]);
    expect(desk.closed()).toBe(0);
  });

  it('says security is on the way when the tower has a security office', () => {
    const world = createWorld(1);
    const office = room(world, 'office', 3, 100, { onFire: true });
    room(world, 'security', 1, 10);
    world.events.push({ kind: 'fire', roomIds: [office.id], startedAt: 0, spreadAt: 30 });
    expect(mount(world).lines('Needs you now')).toEqual(['Fire on floor 3. Security is on the way.']);
  });

  it('shows a bomb threat with its ransom and what to do, with and without security', () => {
    const world = createWorld(1);
    const shop = room(world, 'shop', 5, 40);
    const bomb: ActiveEvent = { kind: 'bomb', roomId: shop.id, ransom: 300_000, detonateAt: 13 * 60, found: false };
    world.events.push(bomb);
    const bare = mount(world);
    expect(bare.lines('Needs you now')).toEqual([
      'Bomb threat on floor 5, no security. Pay the $300,000 ransom, or build a security office to find it before 1 PM.',
    ]);
    room(world, 'security', 1, 10);
    bare.panel.refresh();
    expect(bare.lines('Needs you now')).toEqual(['Bomb threat on floor 5. Wait for security to find it, or pay the $300,000 ransom.']);
    bomb.found = true;
    bare.panel.refresh();
    expect(bare.lines('Needs you now')).toEqual(['Nothing needs you right now.']);
  });

  it('lists cockroaches and the bank warning, and clears when they are dealt with', () => {
    const world = createWorld(1);
    const hotel = room(world, 'hotelSingle', 7, 60, { infested: true });
    world.cash = -600_000;
    world.stats.badQuarterStreak = 1;
    world.time.minute = DAY + 600; // day 1, 10 AM: the next settle is 5 AM in 2 days
    const { lines, panel } = mount(world);
    expect(lines('Needs you now')).toEqual([
      'Cockroaches on floor 7. Build housekeeping to clean them out.',
      `The bank gives you until 5 AM in 2 days. Get to -$500,000 or better, or it takes the tower.`,
    ]);
    hotel.infested = false;
    world.stats.badQuarterStreak = 0;
    world.cash = -1_000;
    panel.refresh();
    expect(lines('Needs you now')).toEqual(['You owe $1,000. Nothing can be built until you have its price.']);
    expect(EVENTS.bomb.ransom).toBeGreaterThan(0);
  });
});

describe('News panel: Today and Show older', () => {
  function logAt(world: World, minute: number, text: string): void {
    world.time.minute = minute;
    log(world, text);
  }

  it('lists only the current day, newest first, and reveals Yesterday and Earlier under Show older', () => {
    const world = createWorld(1);
    logAt(world, 0 * DAY + 600, 'Three days back.');
    logAt(world, 2 * DAY + 23 * 60, 'Last night.');
    logAt(world, 3 * DAY + 30, 'Just after midnight.');
    logAt(world, 3 * DAY + 90, 'Newest.');
    world.time.minute = 3 * DAY + 120;
    const { lines, sectionOf } = mount(world);
    expect(lines('Today')).toEqual(['Newest.', 'Just after midnight.']);
    const older = sectionOf('Today').descendants().find((n) => n.className === 'hs-news-older');
    expect(older?.hidden).toBe(false);
    tap(older);
    expect(lines('Today')).toEqual(['Newest.', 'Just after midnight.', 'Last night.', 'Three days back.']);
    const headings = sectionOf('Today').descendants().filter((n) => n.className === 'hs-news-day' && !n.hidden);
    expect(headings.map((n) => n.textContent)).toEqual(['Yesterday', 'Earlier']);
    expect(older?.hidden).toBe(true);
  });

  it('says nothing yet today when the log has only earlier days', () => {
    const world = createWorld(1);
    logAt(world, 600, 'Day one.');
    world.time.minute = DAY + 60;
    expect(mount(world).lines('Today')).toEqual(['Nothing yet today.']);
  });

  it('moves a line from Today to Yesterday at midnight without a new line', () => {
    const world = createWorld(1);
    logAt(world, 23 * 60, 'Late.');
    const { lines, panel } = mount(world);
    expect(lines('Today')).toEqual(['Late.']);
    world.time.minute = DAY + 10;
    panel.refresh();
    expect(lines('Today')).toEqual(['Nothing yet today.']);
  });

  it('builds nothing on a refresh with no change, and rebuilds for a new line', () => {
    const world = createWorld(1);
    logAt(world, 60, 'One.');
    const { lines, panel } = mount(world);
    dom.created = 0;
    panel.refresh();
    expect(dom.created).toBe(0);
    logAt(world, 61, 'Two.');
    panel.refresh();
    expect(lines('Today')).toEqual(['Two.', 'One.']);
  });
});

describe('News panel: Milestones', () => {
  it('lists milestones newest first with when they happened, and picks up a new one', () => {
    const world = createWorld(1);
    world.milestones.push({ kind: 'population:100', minute: 60, text: 'Population reached 100.' });
    world.milestones.push({ kind: 'star:2', minute: DAY + 60, text: 'The tower reached 2 stars.' });
    world.time.minute = 2 * DAY + 600;
    const { lines, sectionOf, panel } = mount(world);
    expect(lines('Milestones')).toEqual(['The tower reached 2 stars.', 'Population reached 100.']);
    const times = sectionOf('Milestones').descendants().filter((n) => n.className === 'hs-log-time').map((n) => n.textContent);
    expect(times).toEqual(['yesterday', '2 days ago']);
    world.milestones.push({ kind: 'metro', minute: 2 * DAY + 600, text: 'The first metro station opened.' });
    panel.refresh();
    expect(lines('Milestones')[0]).toBe('The first metro station opened.');
  });
});

describe('News panel: the VIP card between visits', () => {
  it('closes the Milestones section, after the list, and is not under Needs you now', () => {
    const world = createWorld(1);
    world.stars = EVENTS.vip.minStar;
    const { sectionOf } = mount(world);
    const milestones = sectionOf('Milestones');
    expect(milestones.children.at(-1)?.className).toContain('hs-vip');
    expect(milestones.children.at(-1)?.textContent).toContain('Next chance');
    expect(sectionOf('Needs you now').descendants().some((n) => n.className.includes('hs-vip'))).toBe(false);
  });
});

describe('News panel: closing', () => {
  it('closes through the context, as every panel does', () => {
    const { panel, closed } = mount(createWorld(1));
    const close = panel.descendants().find((n) => n.textContent === 'Close' && n.tagName?.toLowerCase() === 'button');
    tap(close);
    expect(closed()).toBe(1);
  });
});
