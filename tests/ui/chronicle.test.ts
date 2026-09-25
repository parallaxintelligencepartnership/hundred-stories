// The milestone recap and the tower chronicle: only recorded beats, capped, saved with the
// story, and exported as a PNG without leaving the device.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assembleChronicle, milestoneRecap, NO_STORIES_YET, RECAP_LINE_CAP, unlocksText } from '../../src/sim/chronicle';
import { ROOMS } from '../../src/sim/rules';
import { deserialize, hashWorld, serialize } from '../../src/sim/save';
import { recomputeStars } from '../../src/sim/stars';
import { CHRONICLE_LINE_CAP, followSim, recordBeat, sanitizeStory, storyName, STORY_FOLLOWED_CAP } from '../../src/sim/story';
import type { Room, RoomKind, World } from '../../src/sim/types';
import { allocId, createWorld } from '../../src/sim/world';
import { createChroniclePanel, createRecapPanel, createStoriesPanel, type PanelContext } from '../../src/ui/panels';
import { FakeDom, type FakeElement } from './fake-dom';

let dom: FakeDom;
let uninstall: () => void;
beforeEach(() => {
  dom = new FakeDom();
  uninstall = dom.install();
});
afterEach(() => uninstall());

function room(world: World, kind: RoomKind, floor: number, extra: Partial<Room> = {}): Room {
  const r: Room = {
    id: allocId(world), kind, floor, x: 100, width: ROOMS[kind].width, height: ROOMS[kind].height, eval: 1, tenants: [],
    occupancy: 0, builtAtMinute: 0, vacant: false, dirty: false, infested: false, lowEvalSinceMinute: null, onFire: false, rent: 100,
    ...extra,
  };
  world.rooms.set(r.id, r);
  return r;
}

function context(): { ctx: PanelContext; notices: string[]; opened: string[] } {
  const notices: string[] = [];
  const opened: string[] = [];
  const ctx: PanelContext = {
    apply: () => ({ ok: true }) as never,
    notice: (text) => notices.push(text),
    close: () => {},
    reducedMotion: false,
    setReducedMotion: () => {},
    openRecap: () => opened.push('recap'),
    openChronicle: () => opened.push('chronicle'),
  };
  return { ctx, notices, opened };
}

const node = (panel: unknown): FakeElement => panel as FakeElement;
const press = (el: FakeElement | undefined): void => {
  for (const fn of el?.listeners.get('click') ?? []) fn({});
};
const buttonsNamed = (panel: unknown, text: string): FakeElement[] =>
  node(panel).descendants().filter((n) => n.tagName === 'BUTTON' && n.textContent === text);
const items = (panel: unknown): string[] =>
  node(panel).descendants().filter((n) => n.className === 'hs-story-item').map((n) => n.textContent);

describe('milestone recap', () => {
  it('lists only beats since the star.gained before the last one, newest first, capped at six', () => {
    const world = createWorld(21);
    const shop = room(world, 'shop', 3);
    const office = room(world, 'office', 4);
    const story = world.story;
    // Before the previous star: never in the recap.
    recordBeat(story, { code: 'theft.caught', minute: 10, simId: 900, roomId: shop.id });
    recordBeat(story, { code: 'star.gained', minute: 20, value: 2 });
    // Since: eight recap beats and one the recap ignores.
    for (let i = 0; i < 8; i += 1) recordBeat(story, { code: 'waste.backlog', minute: 30 + i, roomId: office.id });
    recordBeat(story, { code: 'wait.long', minute: 45, simId: 901, value: 20 }); // nobody follows 901
    recordBeat(story, { code: 'star.gained', minute: 50, value: 3 });
    // After the star: never in this milestone's recap.
    recordBeat(story, { code: 'theft.escaped', minute: 60, simId: 902, roomId: shop.id });

    const recap = milestoneRecap(world);
    expect(recap).not.toBeNull();
    expect(recap!.star).toBe(3);
    expect(recap!.unlocks).toBe(unlocksText(3));
    expect(recap!.lines).toHaveLength(RECAP_LINE_CAP);
    expect(recap!.lines.every((line) => line === 'Waste piled up in the office on floor 4 with nobody to collect it.')).toBe(true);
    expect(recap!.lines.join(' ')).not.toMatch(/thief/);
  });

  it("puts a followed person's latest beat beside the tower beats, newest first", () => {
    const world = createWorld(22);
    const office = room(world, 'office', 7);
    followSim(world.story, 500);
    recordBeat(world.story, { code: 'star.gained', minute: 5, value: 2 });
    recordBeat(world.story, { code: 'wait.long', minute: 10, simId: 500, roomId: office.id, value: 9 });
    recordBeat(world.story, { code: 'wait.long', minute: 30, simId: 500, roomId: office.id, value: 12 });
    recordBeat(world.story, { code: 'vip.rated', minute: 20, value: 2 });
    recordBeat(world.story, { code: 'star.gained', minute: 40, value: 3 });
    const recap = milestoneRecap(world)!;
    expect(recap.lines).toHaveLength(2);
    expect(recap.lines[0]).toMatch(new RegExp(`^${storyName(world, 500)}: .*twelve minutes`, "i"));
    expect(recap.lines[1]).toBe('The VIP rated the tower good.');
  });

  it('with no beats since the start shows the unlocks and "No stories yet."', () => {
    const world = createWorld(23);
    recordBeat(world.story, { code: 'star.gained', minute: 100, value: 2 });
    const recap = milestoneRecap(world)!;
    expect(recap.lines).toEqual([]);
    const { ctx } = context();
    const panel = createRecapPanel({ world } as never, ctx);
    const text = node(panel).textContent;
    expect(text).toContain(unlocksText(2));
    expect(text).toContain('Now open:');
    expect(items(panel)).toEqual([NO_STORIES_YET]);
  });

  it('is reopenable from the stories panel once a milestone is on record', () => {
    const world = createWorld(24);
    const { ctx, opened } = context();
    const before = createStoriesPanel({ world } as never, ctx);
    expect(buttonsNamed(before, 'Last milestone')).toHaveLength(0);
    recordBeat(world.story, { code: 'star.gained', minute: 100, value: 2 });
    const after = createStoriesPanel({ world } as never, ctx);
    press(buttonsNamed(after, 'Last milestone')[0]);
    expect(opened).toEqual(['recap']);
    expect(buttonsNamed(after, 'Tower chronicle')).toHaveLength(0);
  });
});

/** A tower one step from Tower status: over 15,000 people, a cathedral, a wedding held. */
function nearlyTower(seed: number): { world: World; shop: Room; office: Room } {
  const world = createWorld(seed);
  world.stars = 5;
  world.time.minute = 1440 * 40 + 600;
  world.stats.weddingsHeld = 1;
  room(world, 'cathedral', 30);
  const shop = room(world, 'shop', 3);
  const office = room(world, 'office', 12);
  for (let i = 0; i < 2500; i += 1) room(world, 'office', 20);
  return { world, shop, office };
}

describe('tower chronicle', () => {
  it('is written at Tower status with the expected lines, in order', () => {
    const { world, shop, office } = nearlyTower(31);
    const story = world.story;
    followSim(story, 700);
    followSim(story, 701);
    recordBeat(story, { code: 'star.gained', minute: 1440 * 3, value: 2 });
    recordBeat(story, { code: 'star.gained', minute: 1440 * 9, value: 3 });
    recordBeat(story, { code: 'wait.long', minute: 1440 * 10, simId: 700, roomId: office.id, value: 11 });
    recordBeat(story, { code: 'room.vacated', minute: 1440 * 11, simId: 701, roomId: office.id, value: 1 });
    recordBeat(story, { code: 'vip.rated', minute: 1440 * 12, value: 1 });
    recordBeat(story, { code: 'theft.caught', minute: 1440 * 13, simId: 702, roomId: shop.id });
    recordBeat(story, { code: 'waste.backlog', minute: 1440 * 14, roomId: office.id });
    expect(story.chronicle).toBeNull();

    recomputeStars(world);
    expect(world.stars).toBe(6);
    const chronicle = story.chronicle!;
    expect(chronicle.minute).toBe(world.time.minute);
    const a = storyName(world, 700);
    const b = storyName(world, 701);
    expect(chronicle.lines[0]).toBe('Day 41 in the tower.');
    expect(chronicle.lines[1]).toBe('Population 15,006.');
    expect(chronicle.lines.slice(2, 6)).toEqual([
      'Reached 2 stars on day 4.',
      'Reached 3 stars on day 10.',
      'Reached 4 stars before the record began.',
      'Reached 5 stars before the record began.',
    ]);
    expect(chronicle.lines[6]).toBe('Reached Tower status on day 41.');
    expect(chronicle.lines[7]).toMatch(new RegExp(`^${a}: .*eleven minutes`, "i"));
    expect(chronicle.lines[8]).toMatch(new RegExp(`^${b}: .*moved out of the office on floor 12`));
    expect(chronicle.lines[9]).toBe('1 tenant moved out.');
    expect(chronicle.lines[10]).toMatch(new RegExp(`^${b}: `));
    expect(chronicle.lines.slice(11)).toEqual([
      'The VIP rated the tower fair.',
      'Thieves: 1 caught, 0 got away.',
      'Times waste piled up: 1, cleaned up: 0.',
      'The cathedral held a wedding.',
    ]);
  });

  it('holds its cap of 40 lines, and an import drops a chronicle past it', () => {
    const { world, office } = nearlyTower(32);
    for (let i = 0; i < STORY_FOLLOWED_CAP; i += 1) followSim(world.story, 800 + i);
    for (let i = 0; i < 200; i += 1) recordBeat(world.story, { code: 'room.vacated', minute: i, simId: 900 + i, roomId: office.id });
    world.story.followed.push(...Array.from({ length: 40 }, (_, i) => 2000 + i)); // more than the game allows
    const chronicle = assembleChronicle(world);
    expect(chronicle.lines.length).toBe(CHRONICLE_LINE_CAP);
    const long = { lines: Array.from({ length: CHRONICLE_LINE_CAP + 1 }, () => 'A line.'), minute: 5 };
    expect(sanitizeStory({ recent: [], followed: [], threads: {}, chronicle: long }).chronicle).toBeNull();
  });

  it('survives serialize and deserialize, and a malformed one imports as null', () => {
    const { world } = nearlyTower(33);
    recomputeStars(world);
    const hashBefore = hashWorld(world);
    const text = serialize(world);
    const loaded = deserialize(text);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.world.story.chronicle).toEqual(world.story.chronicle);
    expect(hashWorld(loaded.world)).toBe(hashBefore);

    for (const bad of [{ lines: ['ok', 7], minute: 1 }, { lines: 'no', minute: 1 }, { lines: ['ok'] }, 'text', [1]]) {
      const parsed = JSON.parse(text) as { story: Record<string, unknown> };
      parsed.story['chronicle'] = bad;
      const again = deserialize(JSON.stringify(parsed));
      expect(again.ok).toBe(true);
      if (again.ok) expect(again.world.story.chronicle).toBeNull();
    }
    const parsed = JSON.parse(text) as { story: Record<string, unknown> };
    delete parsed.story['chronicle'];
    const older = deserialize(JSON.stringify(parsed));
    expect(older.ok && older.world.story.chronicle).toBeNull();
  });

  it('the chronicle leaves the hash alone', () => {
    const { world } = nearlyTower(34);
    recomputeStars(world);
    const hash = hashWorld(world);
    world.story.chronicle = null;
    expect(hashWorld(world)).toBe(hash);
  });
});

describe('chronicle panel and export', () => {
  interface Stub {
    width: number;
    height: number;
    drawn: string[];
    getContext(kind: string): unknown;
    toBlob(cb: (blob: Blob | null) => void, type?: string): void;
  }

  /** The share tests' canvas, stubbed: a context that records text and a toBlob that encodes nothing. */
  function stubCanvas(): Stub[] {
    const made: Stub[] = [];
    const doc = (globalThis as unknown as { document: { createElement(tag: string): unknown } }).document;
    const create = doc.createElement.bind(doc);
    doc.createElement = (tag: string) => {
      if (tag !== 'canvas') return create(tag);
      const drawn: string[] = [];
      const ctx = {
        font: '',
        fillStyle: '',
        textAlign: 'left',
        textBaseline: 'top',
        fillRect: () => {},
        fillText: (text: string) => drawn.push(text),
        measureText: (text: string) => ({ width: text.length * 12 }),
      };
      const canvas: Stub = {
        width: 0,
        height: 0,
        drawn,
        getContext: () => ctx,
        toBlob: (cb, type) => cb(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: type ?? 'image/png' })),
      };
      made.push(canvas);
      return canvas;
    };
    return made;
  }

  it('composes a PNG blob 1200 px wide and hands it to the web download', async () => {
    const made = stubCanvas();
    const { world } = nearlyTower(41);
    recomputeStars(world);
    const { ctx, notices } = context();
    const panel = createChroniclePanel({ world } as never, ctx);
    expect(items(panel)).toEqual(world.story.chronicle!.lines);
    press(buttonsNamed(panel, 'Save as image')[0]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(made).toHaveLength(1);
    const canvas = made[0]!;
    expect(canvas.width).toBe(1200);
    expect(canvas.height).toBeGreaterThan(200);
    expect(canvas.drawn[0]).toBe('Tower chronicle');
    expect(canvas.drawn).toContain('Day 41 in the tower.');
    const link = dom.clicked[dom.clicked.length - 1] as unknown as { download: string; href: string };
    expect(link.download).toBe('hundred-stories-chronicle.png');
    expect(notices).toEqual(['Image saved.']);
  });

  it('composes a PNG blob under the canvas stub', async () => {
    stubCanvas();
    const { canvasToPng, composeListImage } = await import('../../src/share/share');
    const blob = await canvasToPng(composeListImage('Tower chronicle', ['One line.', 'Another line.']));
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBeGreaterThan(0);
  });

  it('is reopenable from the stories panel whenever it exists', () => {
    const { world } = nearlyTower(42);
    recomputeStars(world);
    const { ctx, opened } = context();
    const panel = createStoriesPanel({ world } as never, ctx);
    press(buttonsNamed(panel, 'Tower chronicle')[0]);
    press(buttonsNamed(panel, 'Last milestone')[0]);
    expect(opened).toEqual(['chronicle', 'recap']);
  });
});

describe('star card', () => {
  it('a star.gained beat puts up the card with the unlocks, and Stories so far opens the recap', async () => {
    const { createUi } = await import('../../src/ui/ui');
    const { createStoryState } = await import('../../src/sim/story');
    const subscribers = new Set<() => void>();
    const world = {
      seed: 5, cash: 1_000_000, population: 0, stars: 1, time: { minute: 0 }, log: [], logTotal: 0,
      rooms: new Map(), shafts: new Map(), sims: new Map(), events: [], story: createStoryState(),
    };
    const api = {
      world,
      subscribe(cb: () => void) {
        subscribers.add(cb);
        return () => subscribers.delete(cb);
      },
      getHover: () => null,
      getSpeed: () => 1,
      getTool: () => ({ kind: 'none' }),
      setTool: () => {},
      getPlacement: () => null,
      getPlacementRect: () => null,
      getSelection: () => null,
      select: () => {},
      setChrome: () => {},
      setReducedMotion: () => {},
    };
    const root = dom.createElement('div');
    const ui = createUi(root as never, api as never, {} as never);
    const cards = (): FakeElement[] => root.descendants().filter((n) => n.className.includes('is-star'));
    expect(cards()).toHaveLength(0);

    recordBeat(world.story, { code: 'star.gained', minute: 10, value: 2 });
    world.stars = 2;
    subscribers.forEach((cb) => cb());
    expect(cards()).toHaveLength(1);
    expect(cards()[0]!.textContent).toContain('The tower reached 2 stars.');
    expect(cards()[0]!.textContent).toContain(unlocksText(2));

    press(buttonsNamed(cards()[0], 'Stories so far')[0]);
    expect(cards()).toHaveLength(0);
    const titles = root.descendants().filter((n) => n.className === 'hs-panel-title-text').map((n) => n.textContent);
    expect(titles).toContain('Stories so far');
    ui.destroy();
  });
});
