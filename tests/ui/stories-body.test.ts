// The Stories body (src/ui/stories.ts; Matt, 2026-10-01: Stories and News are one feature, one
// page in the pause card). Sections in order, each left out while empty except Needs you now and
// Following (which says how to follow someone): Needs you now with the helicopter and ransom,
// Tower problems, VIP visit, Following, Around the tower, Today with Show older, and one
// Milestones section. Formerly news-panel.test.ts.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleEventCommand } from '../../src/sim/events';
import { recordBeat } from '../../src/sim/story';
import { EVENTS, ROOMS } from '../../src/sim/rules';
import type { ActiveEvent, Command, Room, RoomKind, World } from '../../src/sim/types';
import { addRoom, allocId, createWorld, log } from '../../src/sim/world';
import type { PanelContext } from '../../src/ui/panels';
import { OPEN_ELEVATOR, SHOW_FLOOR, towerProblems } from '../../src/ui/problems';
import { applyCommand } from '../../src/sim/build';
import { lobbyRun } from '../scenarios/helpers';
import { FOLLOW_HINT, SHOW_ON_TOWER, storiesBody } from '../../src/ui/stories';
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

const has = (n: FakeElement, c: string): boolean => n.className.split(/\s+/).includes(c);

function mount(world: World, extra: Partial<PanelContext> = {}) {
  const centered: { floor: number; x: number }[] = [];
  const applied: Command[] = [];
  const opened: string[] = [];
  const ctx: PanelContext = {
    // As the shell does: the command runs on the world.
    apply: (cmd) => {
      applied.push(cmd);
      return cmd.kind === 'fire.callHelicopter' || cmd.kind === 'bomb.pay' ? handleEventCommand(world, cmd) : { ok: true };
    },
    notice: () => {},
    close: () => {},
    reducedMotion: false,
    setReducedMotion: () => {},
    centerOn: (floor, x) => centered.push({ floor, x }),
    openRecap: () => opened.push('recap'),
    openChronicle: () => opened.push('chronicle'),
    ...extra,
  };
  const body = storiesBody({ world } as never, ctx);
  const root = body.node as unknown as FakeElement;
  const sections = (): FakeElement[] => root.descendants().filter((n) => has(n, 'hs-section'));
  const sectionOf = (title: string): FakeElement => {
    const found = sections().find((n) => n.children[0]?.textContent === title);
    if (!found) throw new Error(`no section ${title}`);
    return found;
  };
  /** The titles of the sections on show, in order. */
  const shownTitles = (): string[] =>
    sections()
      .filter((n) => {
        for (let at: FakeElement | null = n; at && at !== root; at = at.parentNode) if (at.hidden) return false;
        return true;
      })
      .map((n) => n.children[0]?.textContent ?? '');
  /** The visible line texts of a section's lists, in order. */
  const lines = (title: string): string[] =>
    sectionOf(title)
      .descendants()
      .filter((n) => n.className.includes('hs-log-item') && !n.hidden && !n.parentNode?.hidden)
      .map((n) => n.children.find((c) => c.className === 'hs-log-text')?.textContent ?? n.textContent);
  const rowOf = (kind: string): FakeElement | undefined => root.descendants().find((n) => n.dataset['need'] === kind);
  const buttonIn = (node: FakeElement | undefined, pick: (b: FakeElement) => boolean): FakeElement | undefined =>
    node?.descendants().find((n) => n.tagName === 'BUTTON' && pick(n));
  return { body, root, centered, applied, opened, sectionOf, shownTitles, lines, rowOf, buttonIn };
}

const DAY = 1440;
const tap = (node: FakeElement | undefined): void => {
  if (!node) throw new Error('nothing to tap');
  for (const fn of node.listeners.get('click') ?? []) fn({ preventDefault() {}, stopPropagation() {} });
};
const helicopter = (b: FakeElement): boolean => b.dataset['command'] === 'fire.callHelicopter';
const ransom = (b: FakeElement): boolean => b.dataset['command'] === 'bomb.pay';
const showOnTower = (b: FakeElement): boolean => b.textContent === SHOW_ON_TOWER;

describe('Stories: sections', () => {
  it('on a new tower shows Needs you now, which says nothing needs you, and Following, which says how to follow', () => {
    const s = mount(createWorld(1));
    expect(s.shownTitles()).toEqual(['Needs you now', 'Following']);
    expect(s.lines('Needs you now')).toEqual(['Nothing needs you right now.']);
    expect(s.sectionOf('Following').textContent).toBe(`Following${FOLLOW_HINT}`);
    expect(FOLLOW_HINT).toBe('Nobody yet. Open a person and choose Follow.');
  });

  it('lists every section in order once each has something, with one Milestones section', () => {
    const world = createWorld(1);
    world.stars = EVENTS.vip.minStar;
    room(world, 'hotelSingle', 7, 60, { infested: true });
    const home = room(world, 'office', 3, 100);
    world.sims.set(9999, { id: 9999, kind: 'worker', homeRoomId: home.id, pos: { floor: 3, x: 104 }, inCarId: null, inRoomId: home.id, route: [], state: 'inRoom', stress: 0, waitStart: null, schedule: [], nextScheduleIndex: 0, stayUntil: null, wallet: 0, leaveReason: null } as never);
    world.story.followed.push(9999);
    recordBeat(world.story, { code: 'star.gained', minute: 100, value: 3 });
    log(world, 'Built an office on floor 3.');
    world.milestones.push({ kind: 'star:3', minute: 100, text: 'The tower reached 3 stars.' });
    const s = mount(world);
    // The office on floor 3 has no lobby to come in by: a tower problem.
    expect(s.shownTitles()).toEqual(['Needs you now', 'Tower problems', 'VIP visit', 'Following', 'Around the tower', 'Today', 'Milestones']);
    // The saved firsts and the two ways back into them share one section.
    const milestones = s.sectionOf('Milestones');
    expect(s.lines('Milestones')).toEqual(['The tower reached 3 stars.']);
    expect(s.buttonIn(milestones, (b) => b.textContent === 'Last milestone')).toBeDefined();
    tap(s.buttonIn(milestones, (b) => b.textContent === 'Last milestone'));
    expect(s.opened).toEqual(['recap']);
  });

  it('never says News', () => {
    const world = createWorld(1);
    world.stars = EVENTS.vip.minStar;
    log(world, 'Built an office on floor 3.');
    const s = mount(world);
    expect(s.root.textContent).not.toMatch(/\bnews\b/i);
    const all = [s.root, ...s.root.descendants()];
    expect(all.some((n) => /\bnews\b/i.test(n.title) || /\bnews\b/i.test(n.getAttribute('aria-label') ?? ''))).toBe(false);
    // Nor do the guide's lines about it.
    const guide = readFileSync(new URL('../../how-to-play/index.html', import.meta.url), 'utf8');
    expect(guide).not.toMatch(/\bNews\b/);
    expect(guide).not.toContain('Stories panel');
  });
});

describe('Stories: Needs you now', () => {
  function fireTower(cash = 1_000_000, security = false) {
    const world = createWorld(1);
    world.cash = cash;
    const office = room(world, 'office', 12, 100, { onFire: true });
    if (security) room(world, 'security', 1, 10);
    world.events.push({ kind: 'fire', roomIds: [office.id], startedAt: 0, spreadAt: 30 });
    return { world, office };
  }

  it('names the fire floor, says there is no security, and Show on the tower centers the camera on the burning room', () => {
    const { world } = fireTower();
    const s = mount(world);
    expect(s.lines('Needs you now')).toEqual(['Fire on floor 12, no security. Call a helicopter or let it burn out.']);
    tap(s.buttonIn(s.rowOf('fire'), showOnTower));
    expect(s.centered).toEqual([{ floor: 12, x: 104 }]);
  });

  it('points at the new room when the fire moves on the same floor (the line text does not change)', () => {
    const { world, office } = fireTower();
    const s = mount(world);
    const next = room(world, 'office', 12, 200, { onFire: true });
    office.onFire = false;
    (world.events[0] as Extract<ActiveEvent, { kind: 'fire' }>).roomIds = [next.id];
    s.body.refresh();
    expect(s.lines('Needs you now')).toEqual(['Fire on floor 12, no security. Call a helicopter or let it burn out.']);
    tap(s.buttonIn(s.rowOf('fire'), showOnTower));
    expect(s.centered).toEqual([{ floor: 12, x: 204 }]);
  });

  it('says security is putting the fire out when the tower has a security office, and never that a guard is coming', () => {
    const { world } = fireTower(1_000_000, true);
    const s = mount(world);
    expect(s.lines('Needs you now')).toEqual(['Fire on floor 12. Security is putting it out.']);
    expect(s.root.textContent).not.toContain('on the way');
  });

  it('calls the helicopter at its live price, and the fire ends', () => {
    const { world } = fireTower();
    const s = mount(world);
    const call = s.buttonIn(s.rowOf('fire'), helicopter)!;
    expect(call.textContent).toBe('Call a helicopter ($270,000)');
    expect(call.disabled).toBe(false);
    tap(call);
    expect(s.applied).toEqual([{ kind: 'fire.callHelicopter' }]);
    expect(world.events.some((e) => e.kind === 'fire')).toBe(false);
    s.body.refresh();
    expect(s.lines('Needs you now')).toEqual(['Nothing needs you right now.']);
  });

  it('keeps the helicopter off with the reason while cash is short, and turns it on in place when the cash comes', () => {
    const { world } = fireTower(270_000 - 1);
    const s = mount(world);
    const call = s.buttonIn(s.rowOf('fire'), helicopter)!;
    expect(call.disabled).toBe(true);
    expect(s.rowOf('fire')!.textContent).toContain('Not enough cash. A firefighting helicopter costs $270,000.');
    world.cash = 270_000;
    dom.created = 0;
    s.body.refresh();
    // The same button, now on, and nothing built for it.
    expect(s.buttonIn(s.rowOf('fire'), helicopter)).toBe(call);
    expect(call.disabled).toBe(false);
    expect(s.rowOf('fire')!.textContent).not.toContain('Not enough cash');
    expect(dom.created).toBe(0);
  });

  it('shows a bomb threat with what to do, Pay ransom with the amount, and the searching line once security is on duty', () => {
    const world = createWorld(1);
    const shop = room(world, 'shop', 5, 40);
    const bomb: ActiveEvent = { kind: 'bomb', roomId: shop.id, ransom: 300_000, detonateAt: 13 * 60, found: false };
    world.events.push(bomb);
    const s = mount(world);
    expect(s.lines('Needs you now')).toEqual([
      'Bomb threat on floor 5, no security. Pay the $300,000 ransom, or build a security office to find it before 1 PM.',
    ]);
    const pay = s.buttonIn(s.rowOf('bomb'), ransom)!;
    expect(pay.textContent).toBe('Pay ransom ($300,000)');
    room(world, 'security', 1, 10);
    s.body.refresh();
    expect(s.lines('Needs you now')).toEqual(['Bomb threat on floor 5. Your security office is searching and will find it before 1 PM.']);
    expect(has(pay, 'is-secondary')).toBe(true);
    bomb.found = true;
    s.body.refresh();
    expect(s.lines('Needs you now')).toEqual(['Nothing needs you right now.']);
  });

  it('pays the ransom on one press, and the threat ends; short of cash the button is off with the reason', () => {
    const world = createWorld(1);
    const shop = room(world, 'shop', 5, 40);
    world.cash = 300_000 - 1;
    world.events.push({ kind: 'bomb', roomId: shop.id, ransom: 300_000, detonateAt: 13 * 60, found: false });
    const s = mount(world);
    const pay = s.buttonIn(s.rowOf('bomb'), ransom)!;
    expect(pay.disabled).toBe(true);
    expect(s.rowOf('bomb')!.textContent).toContain('Not enough cash. The ransom is $300,000.');
    world.cash = 300_000;
    s.body.refresh();
    expect(pay.disabled).toBe(false);
    tap(pay);
    expect(s.applied).toEqual([{ kind: 'bomb.pay' }]);
    expect(world.events.some((e) => e.kind === 'bomb')).toBe(false);
  });

  it('lists a theft under way, with where it is', () => {
    const world = createWorld(1);
    const shop = room(world, 'shop', 7, 40);
    world.events.push({ kind: 'theft', phase: 'acting', enterAt: 0, simId: null, targetId: shop.id, floor: 7, actUntil: 30, guardId: null, noGuard: 'No guard can reach floor 7.' });
    const s = mount(world);
    expect(s.lines('Needs you now')).toEqual(['Theft on floor 7, no guard can reach it.']);
    tap(s.buttonIn(s.rowOf('theft'), showOnTower));
    expect(s.centered).toEqual([{ floor: 7, x: 40 + Math.floor(ROOMS.shop.width / 2) }]);
  });

  it('lists cockroaches and the bank warning, and clears when they are dealt with', () => {
    const world = createWorld(1);
    const hotel = room(world, 'hotelSingle', 7, 60, { infested: true });
    world.cash = -600_000;
    world.stats.badQuarterStreak = 1;
    world.time.minute = DAY + 600; // day 1, 10 AM: the next settle is 5 AM in 2 days
    const s = mount(world);
    expect(s.lines('Needs you now')).toEqual([
      'Cockroaches on floor 7. There is no housekeeping. Build a housekeeping office to clean them out.',
      `The bank gives you until 5 AM in 2 days. Get to -$500,000 or better, or it takes the tower.`,
    ]);
    // The bank line has no place, so no Show on the tower.
    expect(s.buttonIn(s.rowOf('money'), showOnTower)?.hidden).toBe(true);
    hotel.infested = false;
    world.stats.badQuarterStreak = 0;
    world.cash = -1_000;
    s.body.refresh();
    expect(s.lines('Needs you now')).toEqual(['You owe $1,000. Nothing can be built until you have its price.']);
  });
});

describe('Stories: aim (where a toast opens it)', () => {
  it('lands on Show on the tower for a fire, never on the helicopter, and on nothing for a bomb with no place', () => {
    const world = createWorld(1);
    const office = room(world, 'office', 12, 100, { onFire: true });
    world.events.push({ kind: 'fire', roomIds: [office.id], startedAt: 0, spreadAt: 30 });
    // A bomb whose room is gone and that kept no place: its row has only Pay ransom.
    world.events.push({ kind: 'bomb', roomId: 424242, ransom: 300_000, detonateAt: 13 * 60, found: false });
    const s = mount(world);
    expect(s.body.aim('fire')?.textContent).toBe(SHOW_ON_TOWER);
    expect(s.body.aim('needs')?.textContent).toBe(SHOW_ON_TOWER);
    expect(s.body.aim('bomb')).toBeNull();
    expect(s.body.aim()).toBeNull();
    for (const target of ['fire', 'bomb', 'needs', 'today', 'vip', 'following', 'milestones'] as const) {
      expect(s.body.aim(target)?.dataset['spend']).not.toBe('true');
    }
  });

  it('falls back to Needs you now when the incident has ended', () => {
    const s = mount(createWorld(1));
    expect(s.body.aim('fire')).toBeNull();
  });
});

describe('Stories: Today and Show older', () => {
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
    const s = mount(world);
    expect(s.lines('Today')).toEqual(['Newest.', 'Just after midnight.']);
    const older = s.buttonIn(s.sectionOf('Today'), (b) => b.textContent === 'Show older');
    expect(older?.hidden).toBe(false);
    tap(older);
    expect(s.lines('Today')).toEqual(['Newest.', 'Just after midnight.', 'Last night.', 'Three days back.']);
    const headings = s.sectionOf('Today').descendants().filter((n) => n.className === 'hs-news-day' && !n.hidden);
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
    const s = mount(world);
    expect(s.lines('Today')).toEqual(['Late.']);
    world.time.minute = DAY + 10;
    s.body.refresh();
    expect(s.lines('Today')).toEqual(['Nothing yet today.']);
  });

  it('builds nothing on a refresh with no change, and rebuilds for a new line', () => {
    const world = createWorld(1);
    logAt(world, 60, 'One.');
    const s = mount(world);
    dom.created = 0;
    s.body.refresh();
    expect(dom.created).toBe(0);
    logAt(world, 61, 'Two.');
    s.body.refresh();
    expect(s.lines('Today')).toEqual(['Two.', 'One.']);
  });
});

describe('Stories: Milestones', () => {
  it('lists milestones newest first with when they happened, and picks up a new one', () => {
    const world = createWorld(1);
    world.milestones.push({ kind: 'population:100', minute: 60, text: 'Population reached 100.' });
    world.milestones.push({ kind: 'star:2', minute: DAY + 60, text: 'The tower reached 2 stars.' });
    world.time.minute = 2 * DAY + 600;
    const s = mount(world);
    expect(s.lines('Milestones')).toEqual(['The tower reached 2 stars.', 'Population reached 100.']);
    const times = s.sectionOf('Milestones').descendants().filter((n) => n.className === 'hs-log-time').map((n) => n.textContent);
    expect(times).toEqual(['yesterday', '2 days ago']);
    world.milestones.push({ kind: 'metro', minute: 2 * DAY + 600, text: 'The first metro station opened.' });
    s.body.refresh();
    expect(s.lines('Milestones')[0]).toBe('The first metro station opened.');
  });
});

describe('Stories: the VIP visit', () => {
  it('has its own section between visits, after Needs you now, with the next chance', () => {
    const world = createWorld(1);
    world.stars = EVENTS.vip.minStar;
    const s = mount(world);
    const vip = s.sectionOf('VIP visit');
    expect(has(vip, 'hs-vip')).toBe(true);
    expect(vip.textContent).toContain('Next chance');
    expect(s.sectionOf('Needs you now').descendants().some((n) => has(n, 'hs-vip'))).toBe(false);
    expect(s.shownTitles().slice(0, 2)).toEqual(['Needs you now', 'VIP visit']);
  });

  it('is left out below the VIP star with no visit yet', () => {
    const s = mount(createWorld(1));
    expect(s.shownTitles()).not.toContain('VIP visit');
  });
});

describe('hs-face hidden', () => {
  it('a hidden face button stays hidden: the [hidden] rule follows the display: flex rule', () => {
    const css = readFileSync(new URL('../../src/ui/ui.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const face = css.indexOf('.hs-ui .hs-face {');
    const hidden = css.search(/\.hs-ui \.hs-face\[hidden\]\s*\{\s*display:\s*none;?\s*\}/);
    expect(face).toBeGreaterThan(-1);
    expect(hidden).toBeGreaterThan(face);
  });
});

// P3b: the Tower problems section, the cockroach row's truth, and focus after a spend (P3a A1).
describe('Stories: Tower problems', () => {
  /** A lobby with one shaft to floor 4, and offices on 2 and 3; the shaft stops nowhere above 1 but 2. */
  function cutTower(): { world: World; shaftId: number } {
    const world = createWorld(11);
    world.cash = 50_000_000;
    for (const cmd of [...lobbyRun(90, 200), { kind: 'shaft.build', shaft: 'standard', x: 150, floorMin: 1, floorMax: 4 } as Command]) applyCommand(world, cmd);
    for (const f of [2, 3, 4]) applyCommand(world, { kind: 'build', room: 'office', floor: f, x: 100 });
    const shaftId = [...world.shafts.keys()][0] as number;
    applyCommand(world, { kind: 'shaft.setStop', shaftId, floor: 3, stops: false });
    applyCommand(world, { kind: 'shaft.setStop', shaftId, floor: 4, stops: false });
    return { world, shaftId };
  }

  it('is left out with nothing wrong, and lists one row per problem, right after Needs you now', () => {
    expect(mount(createWorld(1)).shownTitles()).not.toContain('Tower problems');
    const { world } = cutTower();
    const s = mount(world);
    expect(s.shownTitles().slice(0, 2)).toEqual(['Needs you now', 'Tower problems']);
    const rows = s.sectionOf('Tower problems').descendants().filter((n) => has(n, 'hs-problem'));
    expect(rows.map((r) => r.children[0]?.textContent)).toEqual(towerProblems(world).map((p) => p.text));
    expect(rows.map((r) => r.children[0]?.textContent)).toEqual([
      'Floor 3: 1 room with no way in from the lobby. Give the floor an elevator stop or stairs.',
      'Floor 4: 1 room with no way in from the lobby. Give the floor an elevator stop or stairs.',
    ]);
  });

  it('a row disappears when it stops being true, and the others keep their nodes and focus', () => {
    const { world, shaftId } = cutTower();
    const s = mount(world);
    const rowFor = (floor: number) => s.root.descendants().find((n) => n.dataset['problem'] === `noWayIn:${floor}`);
    const four = rowFor(4)!;
    const show = s.buttonIn(four, (b) => b.textContent === SHOW_FLOOR)!;
    show.focus();
    applyCommand(world, { kind: 'shaft.setStop', shaftId, floor: 3, stops: true });
    s.body.refresh();
    expect(rowFor(3)).toBeUndefined();
    expect(rowFor(4)).toBe(four);
    expect(dom.activeElement).toBe(show);
    applyCommand(world, { kind: 'shaft.setStop', shaftId, floor: 4, stops: true });
    s.body.refresh();
    expect(s.shownTitles()).not.toContain('Tower problems');
  });

  it('Show the floor centers the camera there; the elevator action centers on the shaft and opens its card', () => {
    const { world, shaftId } = cutTower();
    const selected: unknown[] = [];
    const s = mount(world, { select: (sel) => selected.push(sel) });
    tap(s.buttonIn(s.root.descendants().find((n) => n.dataset['problem'] === 'noWayIn:3'), (b) => b.textContent === SHOW_FLOOR));
    expect(s.centered).toEqual([{ floor: 3, x: 100 + Math.floor(ROOMS.office.width / 2) }]);
    expect(selected).toEqual([]);
    // Nine people waiting on floor 2 for seven minutes.
    const office = [...world.rooms.values()].find((r) => r.kind === 'office' && r.floor === 2)!;
    for (let i = 0; i < 9; i++) {
      world.sims.set(9000 + i, {
        id: 9000 + i, kind: 'shopper', homeRoomId: null, pos: { floor: 2, x: 150 }, inCarId: null, inRoomId: null,
        route: [{ kind: 'ride', shaftId, fromFloor: 2, toFloor: 1 }], state: 'waiting', stress: 0, waitStart: world.time.minute - 7,
        schedule: [{ minuteOfDay: 0, days: ['weekday'], goal: { kind: 'room', roomId: office.id }, stayMinutes: 1 }],
        nextScheduleIndex: 1, stayUntil: null, wallet: 0, leaveReason: null,
      } as never);
    }
    s.body.refresh();
    const wait = s.root.descendants().find((n) => n.dataset['problem'] === 'wait:2')!;
    expect(wait.children[0]?.textContent).toBe('Floor 2: 9 people waiting for an elevator, the longest for 7 minutes.');
    tap(s.buttonIn(wait, (b) => b.textContent === OPEN_ELEVATOR));
    expect(s.centered.at(-1)).toEqual({ floor: 2, x: 150 });
    expect(selected).toEqual([{ shaftId }]);
  });

  it("is a place Stories opens at: aim('problems') lands on the first row's first button", () => {
    const { world } = cutTower();
    const s = mount(world);
    expect(s.body.aim('problems')?.textContent).toBe(SHOW_FLOOR);
    expect(mount(createWorld(1)).body.aim('problems')).toBeNull();
  });
});

describe('Stories: the cockroach row says what will really happen', () => {
  /** Infested singles on 3 and 4 (lobby, shaft 1 to 4), with or without housekeeping on basement 1. */
  function roaches(office: 'none' | 'cut' | 'reach'): World {
    const world = createWorld(12);
    world.cash = 50_000_000;
    world.stars = 3;
    const script: Command[] = [...lobbyRun(90, 200), { kind: 'shaft.build', shaft: 'standard', x: 190, floorMin: 1, floorMax: 4 }];
    for (const f of [2, 3, 4]) script.push({ kind: 'build', room: 'hotelSingle', floor: f, x: 100 });
    if (office !== 'none') script.push({ kind: 'build', room: 'housekeeping', floor: -1, x: 100 });
    if (office === 'reach') script.push({ kind: 'shaft.build', shaft: 'service', x: 60, floorMin: -1, floorMax: 4 });
    for (const cmd of script) expect(applyCommand(world, cmd).ok).toBe(true);
    for (const r of world.rooms.values()) if (r.kind === 'hotelSingle' && r.floor >= 3) r.infested = true;
    return world;
  }

  it('no housekeeping office: build one', () => {
    expect(mount(roaches('none')).lines('Needs you now')).toEqual(['Cockroaches on floors 3 to 4, 2 rooms. There is no housekeeping. Build a housekeeping office to clean them out.']);
  });

  it('housekeeping that cannot get there: which floors', () => {
    expect(mount(roaches('cut')).lines('Needs you now')).toEqual(['Cockroaches on floors 3 to 4, 2 rooms. Housekeeping cannot get to floors 3 and 4. Give it an elevator there to clean them out.']);
  });

  it('housekeeping that can get there: it will clean them out', () => {
    expect(mount(roaches('reach')).lines('Needs you now')).toEqual(['Cockroaches on floors 3 to 4, 2 rooms. Housekeeping will clean them out.']);
  });
});

describe('Stories: focus after a spend (P3a A1)', () => {
  it('after Call a helicopter ends the fire, focus goes to the next row, never out of the page and never to a spend', () => {
    const world = createWorld(1);
    world.cash = 1_000_000;
    const office = room(world, 'office', 12, 100, { onFire: true });
    world.events.push({ kind: 'fire', roomIds: [office.id], startedAt: 0, spreadAt: 30 });
    room(world, 'hotelSingle', 7, 60, { infested: true });
    const settled: (FakeElement | null)[] = [];
    const s = mount(world, { rowsChanged: (node) => settled.push(node as unknown as FakeElement | null) });
    tap(s.buttonIn(s.rowOf('fire'), helicopter));
    expect(s.rowOf('fire')).toBeUndefined();
    expect(settled).toHaveLength(1);
    // The cockroach row took the fire's place: its Show on the tower.
    expect(settled[0]).toBe(s.buttonIn(s.rowOf('roaches'), showOnTower));
  });

  it('with no row left, focus goes to the first safe control in the page; a refused press leaves focus alone', () => {
    const world = createWorld(1);
    world.cash = 1_000_000;
    const shop = room(world, 'shop', 5, 40);
    world.events.push({ kind: 'bomb', roomId: shop.id, ransom: 300_000, detonateAt: 13 * 60, found: false });
    const settled: (FakeElement | null)[] = [];
    const s = mount(world, { rowsChanged: (node) => settled.push(node as unknown as FakeElement | null) });
    tap(s.buttonIn(s.rowOf('bomb'), ransom));
    expect(s.rowOf('bomb')).toBeUndefined();
    // The shop has no lobby: Tower problems is the page's first place with a button.
    expect(settled).toHaveLength(1);
    expect(settled[0]?.textContent).toBe('Show the room');
    expect(settled[0]?.dataset['spend']).not.toBe('true');

    // Refused (short of cash): the row stays, and focus is left where it is.
    world.cash = 0;
    world.events.push({ kind: 'bomb', roomId: shop.id, ransom: 300_000, detonateAt: 13 * 60, found: false });
    s.body.refresh();
    tap(s.buttonIn(s.rowOf('bomb'), ransom));
    expect(s.rowOf('bomb')).toBeDefined();
    expect(settled).toHaveLength(1);
  });
});
