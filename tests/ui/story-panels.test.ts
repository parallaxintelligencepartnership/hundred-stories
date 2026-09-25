// The person card, room occupants and the stories panel, on a fake DOM.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ROOMS } from '../../src/sim/rules';
import { followSim, recordBeat, storyName, STORY_FOLLOWED_CAP } from '../../src/sim/story';
import type { Room, Sim, World } from '../../src/sim/types';
import { addRoom, addSim, allocId, createWorld } from '../../src/sim/world';
import {
  createQueryPanel,
  createSettingsPanel,
  createStoriesPanel,
  FOLLOW_LIMIT_TEXT,
  type PanelContext,
  type Selection,
} from '../../src/ui/panels';
import { FakeDom, type FakeElement } from './fake-dom';

let dom: FakeDom;
let uninstall: () => void;
beforeEach(() => {
  dom = new FakeDom();
  uninstall = dom.install();
});
afterEach(() => uninstall());

function context(): { ctx: PanelContext; notices: string[]; selected: Selection[]; stories: number } {
  const out = { notices: [] as string[], selected: [] as Selection[], stories: 0 };
  const ctx: PanelContext = {
    apply: () => ({ ok: true }) as never,
    notice: (text) => out.notices.push(text),
    close: () => {},
    reducedMotion: false,
    setReducedMotion: () => {},
    select: (sel) => out.selected.push(sel),
    openStories: () => {
      out.stories += 1;
    },
  };
  return { ctx, ...out, get stories() { return out.stories; } } as never;
}

function office(world: World, floor = 12): Room {
  const room: Room = {
    id: allocId(world), kind: 'office', floor, x: 100, width: ROOMS.office.width, height: 1, eval: 1, tenants: [],
    occupancy: 0, builtAtMinute: 0, vacant: false, dirty: false, infested: false, lowEvalSinceMinute: null, onFire: false, rent: 100,
  };
  addRoom(world, room);
  return room;
}

function worker(world: World, home: Room): Sim {
  const sim: Sim = {
    id: allocId(world), kind: 'worker', homeRoomId: home.id, pos: { floor: home.floor, x: 104 }, inCarId: null, inRoomId: home.id,
    route: [], state: 'inRoom', stress: 0, waitStart: null, schedule: [], nextScheduleIndex: 0, stayUntil: null, wallet: 0, leaveReason: null,
  };
  addSim(world, sim);
  home.tenants.push(sim.id);
  return sim;
}

const node = (panel: unknown): FakeElement => panel as FakeElement;
/** The fake DOM's click only records itself; this runs the element's click listeners. */
const press = (el: FakeElement | undefined): void => {
  for (const fn of el?.listeners.get('click') ?? []) fn({});
};
const titles = (panel: unknown): string[] =>
  node(panel).descendants().filter((n) => n.className === 'hs-section-title').map((n) => n.textContent);
const buttonsNamed = (panel: unknown, text: string): FakeElement[] =>
  node(panel).descendants().filter((n) => n.tagName?.toLowerCase() === 'button' && n.textContent === text);

describe('person panel', () => {
  it('shows who, what is on their mind, the recent chapter and what helps, in that order', () => {
    const world = createWorld(8);
    const home = office(world);
    const sim = worker(world, home);
    const { ctx } = context();
    const panel = createQueryPanel({ world } as never, { simId: sim.id }, ctx);
    const got = titles(panel);
    expect(got.slice(0, 4)).toEqual(['Who', 'On their mind', 'Recent chapter', 'What helps']);
    const text = node(panel).textContent;
    expect(text).toContain(storyName(world, sim.id));
    expect(text).toContain('At work on floor 12.');
    expect(text).toContain('Nothing recorded yet.');
    expect(text).toContain('Nothing right now.');
  });

  it('follows and unfollows, and refuses the ninth with the reason', () => {
    const world = createWorld(8);
    const home = office(world);
    const sim = worker(world, home);
    const c = context();
    const panel = createQueryPanel({ world } as never, { simId: sim.id }, c.ctx);
    const [follow] = buttonsNamed(panel, 'Follow');
    press(follow);
    expect(world.story.followed).toEqual([sim.id]);
    expect(buttonsNamed(panel, 'Unfollow')).toHaveLength(1);
    press(buttonsNamed(panel, 'Unfollow')[0]);
    expect(world.story.followed).toEqual([]);

    for (let i = 0; i < STORY_FOLLOWED_CAP; i++) followSim(world.story, 10_000 + i);
    press(buttonsNamed(panel, 'Follow')[0]);
    expect(world.story.followed).not.toContain(sim.id);
    expect(c.notices).toEqual([FOLLOW_LIMIT_TEXT]);
    expect(FOLLOW_LIMIT_TEXT).toBe('You can follow eight people at a time.');
  });

  it('renders the followed thread with its numbers', () => {
    const world = createWorld(8);
    const home = office(world);
    const sim = worker(world, home);
    followSim(world.story, sim.id);
    recordBeat(world.story, { code: 'wait.long', minute: 500, simId: sim.id, roomId: home.id, value: 8 });
    recordBeat(world.story, { code: 'trip.arrived', minute: 900, simId: sim.id, roomId: home.id, value: 2 });
    const panel = createQueryPanel({ world } as never, { simId: sim.id }, context().ctx);
    const items = node(panel).descendants().filter((n) => n.className === 'hs-story-item').map((n) => n.textContent.toLowerCase());
    expect(items).toHaveLength(2);
    expect(items[0]).toContain('eight minutes');
    expect(items[1]).toContain('two minutes');
    expect(node(panel).textContent).toContain('More cars in this elevator, or another elevator for this trip.');
  });
});

describe('room panel occupants', () => {
  it('lists up to eight names with their goal, each a way into that person', () => {
    const world = createWorld(8);
    const home = office(world);
    const sims = Array.from({ length: 6 }, () => worker(world, home));
    const c = context();
    const panel = createQueryPanel({ world } as never, { roomId: home.id }, c.ctx);
    expect(titles(panel)).toContain('Who is here');
    const rows = node(panel).descendants().filter((n) => n.className === 'hs-occupant');
    expect(rows).toHaveLength(6);
    expect(rows[0]?.textContent).toContain(storyName(world, (sims[0] as Sim).id));
    expect(rows[0]?.textContent).toContain('At work on floor 12');
    press(rows[2]);
    expect(c.selected).toEqual([{ simId: (sims[2] as Sim).id }]);
    dom.created = 0;
    (panel as { refresh?: () => void }).refresh?.();
    expect(dom.created).toBe(0);
  });
});

describe('stories', () => {
  it('opens from a Stories button beside the save buttons', () => {
    const c = context();
    const panel = createSettingsPanel({ world: { seed: 1, log: [], logTotal: 0 } } as never, c.ctx);
    const actions = node(panel).descendants().filter((n) => n.className === 'hs-actions');
    const saves = actions.find((row) => row.children.some((b) => b.textContent === 'Save to a file'));
    expect(saves?.children.map((b) => b.textContent)).toEqual(['Save now', 'Go back to last save', 'Save to a file', 'Stories']);
    press(buttonsNamed(panel, 'Stories')[0]);
    expect(c.stories).toBe(1);
  });

  it('lists the followed people with their latest line, and the last tower beats', () => {
    const world = createWorld(8);
    const home = office(world);
    const sim = worker(world, home);
    followSim(world.story, sim.id);
    recordBeat(world.story, { code: 'wait.long', minute: 500, simId: sim.id, roomId: home.id, value: 8 });
    for (let i = 0; i < 20; i++) recordBeat(world.story, { code: 'star.gained', minute: 600 + i, value: 2 });
    const panel = createStoriesPanel({ world } as never, context().ctx);
    const text = node(panel).textContent;
    expect(text).toContain(storyName(world, sim.id));
    expect(text.toLowerCase()).toContain('eight minutes');
    const items = node(panel).descendants().filter((n) => n.className === 'hs-story-item');
    expect(items).toHaveLength(12);
  });
});
