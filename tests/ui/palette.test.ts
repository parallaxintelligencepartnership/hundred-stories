// The palette tiles: their four states from a stub world, the markup a keyboard and a screen
// reader get, and the thumbnails the shell asks the renderer for.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Tool } from '../../src/game/api';
import { ROOMS, SHAFTS } from '../../src/sim/rules';
import { applyRowState, buildPalette, fitRect, footprintText, GROUPS, paintThumbnail, THUMB_H, THUMB_W, toolRowState, type PaletteRow } from '../../src/ui/palette';
import { createUi } from '../../src/ui/ui';
import { FakeDom, type FakeElement } from './fake-dom';

let dom: FakeDom;
let uninstall: () => void;
beforeEach(() => {
  dom = new FakeDom();
  uninstall = dom.install();
});
afterEach(() => uninstall());

const none: Tool = { kind: 'none' };
const shopRow = { star: ROOMS.shop.star, price: ROOMS.shop.cost, tool: { kind: 'room', room: 'shop' } as Tool };

describe('tool row state', () => {
  it('locks a tool above the tower rating, with stars now over stars needed', () => {
    const state = toolRowState(shopRow, { stars: 2, cash: 10_000_000 }, none);
    expect(state.locked).toBe(true);
    expect(state.costText).toBe('Needs 3 stars');
    expect(state.progress).toEqual({ value: 2, max: 3 });
    expect(state.short).toBe(0);
  });

  it('marks an unaffordable tool with how much is short, and still lets it be selected', () => {
    const tool: Tool = { kind: 'room', room: 'shop' };
    const state = toolRowState(shopRow, { stars: 3, cash: 80_000 }, tool);
    expect(state.locked).toBe(false);
    expect(state.selected).toBe(true);
    expect(state.short).toBe(20_000);
    expect(state.costText).toBe('$100,000');
    expect(state.shortText).toBe('Short $20,000');
    expect(state.progress).toBe(null);
  });

  it('shows an affordable tool plainly, and a free tool with no cost', () => {
    const state = toolRowState(shopRow, { stars: 3, cash: 1_000_000 }, none);
    expect([state.locked, state.selected, state.short, state.shortText]).toEqual([false, false, 0, '']);
    const query = toolRowState({ star: 1, price: null, tool: { kind: 'query' } }, { stars: 1, cash: 0 }, none);
    expect([query.costText, query.short]).toEqual(['', 0]);
  });

  it('puts the running cost beside the price for an elevator, a room with upkeep, and a lobby at three stars', () => {
    const world = { stars: 3, cash: 10_000_000 };
    const elevator = toolRowState({ star: 1, price: SHAFTS.standard.shaftCost, tool: { kind: 'shaft', shaft: 'standard' } }, world, none);
    expect(elevator.costText).toBe('$200,000, then $10,000 a quarter');
    const express = toolRowState({ star: 3, price: SHAFTS.express.shaftCost, tool: { kind: 'shaft', shaft: 'express' } }, world, none);
    expect(express.costText).toBe('$400,000, then $20,000 a quarter');
    const security = toolRowState({ star: 2, price: ROOMS.security.cost, tool: { kind: 'room', room: 'security' } }, world, none);
    expect(security.costText).toBe('$100,000, then $20,000 a quarter');
    const lobby = { star: 1 as const, price: ROOMS.lobby.cost, tool: { kind: 'room', room: 'lobby' } as Tool };
    expect(toolRowState(lobby, world, none).costText).toBe('$5,000, then $300 a quarter');
    // No running cost, no second part: an office, and a lobby below three stars.
    expect(toolRowState({ star: 1, price: ROOMS.office.cost, tool: { kind: 'room', room: 'office' } }, world, none).costText).toBe('$40,000');
    expect(toolRowState(lobby, { stars: 2, cash: 10_000_000 }, none).costText).toBe('$5,000');
  });

  it('describes footprints in tiles and floors', () => {
    expect(footprintText('office')).toBe(`${ROOMS.office.width} tiles`);
    expect(footprintText('cinema')).toBe(`${ROOMS.cinema.width} tiles, ${ROOMS.cinema.height} floors`);
    expect(footprintText('lobby')).toBe('1 tile');
    expect(footprintText('standard')).toBe(`${SHAFTS.standard.width} tiles, up to ${SHAFTS.standard.maxSpan} floors`);
  });

  it('fits a thumbnail centred and whole pixel', () => {
    expect(fitRect(144, 72, 72, 36)).toEqual({ x: 0, y: 0, w: 72, h: 36 });
    expect(fitRect(64, 72, 72, 36)).toEqual({ x: 20, y: 0, w: 32, h: 36 });
    expect(fitRect(496, 144, 72, 36)).toEqual({ x: 0, y: 7, w: 72, h: 21 });
  });
});

describe('palette tiles on the page', () => {
  function tiles(): { rows: PaletteRow[]; palette: FakeElement } {
    const palette = dom.createElement('nav');
    const parts = buildPalette(palette as never, () => {}, () => {});
    return { rows: parts.rows, palette };
  }
  const byLabel = (rows: PaletteRow[], label: string): PaletteRow => {
    const row = rows.find((r) => r.label === label);
    if (!row) throw new Error(`no ${label}`);
    return row;
  };
  const cls = (n: FakeElement, c: string): FakeElement | undefined => n.descendants().find((d) => d.className.split(' ').includes(c));

  it('builds the tile markup: thumbnail canvas, name, footprint, cost and a progress bar', () => {
    const { rows } = tiles();
    const office = byLabel(rows, 'Office');
    const node = office.node as unknown as FakeElement;
    expect(node.className).toBe('hs-tool');
    expect(cls(node, 'hs-tool-thumb')?.tagName).toBe('CANVAS');
    expect(cls(node, 'hs-tool-thumb')?.getAttribute('aria-hidden')).toBe('true');
    expect(cls(node, 'hs-tool-name')?.textContent).toBe('Office');
    expect(cls(node, 'hs-tool-footprint')?.textContent).toBe('9 tiles');
    expect(cls(node, 'hs-tool-progress')?.getAttribute('role')).toBe('progressbar');
    // Demolish and query have no art: an icon stands in, with their names beside it.
    expect(cls(byLabel(rows, 'Demolish').node as unknown as FakeElement, 'hs-tool-thumb')?.tagName).toBe('SPAN');
  });

  it('renders locked tiles focusable with aria-disabled, and short tiles with the alert state', () => {
    const { rows } = tiles();
    const world = { stars: 2, cash: 30_000 };
    for (const row of rows) applyRowState(row, toolRowState(row, world, { kind: 'room', room: 'hotelTwin' }));

    const shop = byLabel(rows, 'Shop').node as unknown as FakeElement;
    expect(shop.disabled).toBe(false); // still reachable by Tab
    expect(shop.getAttribute('aria-disabled')).toBe('true');
    expect(cls(shop, 'hs-tool-cost')?.textContent).toBe('Needs 3 stars');
    const bar = cls(shop, 'hs-tool-progress') as FakeElement;
    expect([bar.hidden, bar.getAttribute('aria-valuenow'), bar.getAttribute('aria-valuemax')]).toEqual([false, '2', '3']);
    expect(bar.getAttribute('aria-label')).toBe('Stars 2 of 3');

    const twin = byLabel(rows, 'Twin room').node as unknown as FakeElement;
    expect(twin.getAttribute('aria-pressed')).toBe('true');
    expect(twin.classList.contains('is-short')).toBe(true);
    expect(cls(twin, 'hs-tool-short')?.textContent).toBe('Short $20,000');
    expect(twin.getAttribute('aria-disabled')).toBe('false');

    const lobby = byLabel(rows, 'Lobby').node as unknown as FakeElement;
    expect([lobby.getAttribute('aria-pressed'), lobby.classList.contains('is-short')]).toEqual(['false', false]);
    expect((cls(lobby, 'hs-tool-progress') as FakeElement).hidden).toBe(true);
  });
});

describe('palette in the shell', () => {
  function game(stars: number): { api: never; tools: Tool[] } {
    const tools: Tool[] = [];
    let tool: Tool = { kind: 'none' };
    const world = {
      cash: 1_000_000,
      quarterStartCash: null,
      population: 0,
      dayStartPopulation: null,
      stars,
      time: { minute: 12 * 60 },
      log: [],
      logTotal: 0,
      rooms: new Map(),
      shafts: new Map(),
      sims: new Map(),
      events: [],
      stats: { vipRating: 'none', weddingsHeld: 0 },
    };
    const api = {
      world,
      subscribe: () => () => {},
      getHover: () => null,
      getSpeed: () => 1,
      getTool: () => tool,
      setTool: (t: Tool) => {
        tools.push(t);
        tool = t;
      },
      getPlacement: () => null,
      getPlacementRect: () => null,
      getSelection: () => null,
      setChrome: () => {},
      setReducedMotion: () => {},
    } as never;
    return { api, tools };
  }

  const tool = (root: FakeElement, label: string): FakeElement => {
    const node = root
      .descendants()
      .find((n) => n.className.split(' ').includes('hs-tool') && n.descendants().some((d) => d.className === 'hs-tool-name' && d.textContent === label));
    if (!node) throw new Error(`no ${label}`);
    return node;
  };
  const click = (node: FakeElement): void => (node.listeners.get('click') ?? []).forEach((fn) => fn({}));

  it('does not pick up a locked tool, and does pick up an available one', () => {
    const g = game(1);
    const root = dom.createElement('div');
    createUi(root as never, g.api, {} as never);
    click(tool(root, 'Shop'));
    expect(g.tools).toEqual([]);
    click(tool(root, 'Office'));
    expect(g.tools).toEqual([{ kind: 'room', room: 'office' }]);
  });

  it('asks the renderer for the shown category only, a few per frame, and the next category when it is picked', () => {
    const g = game(1);
    const root = dom.createElement('div');
    const asked: string[] = [];
    const renderer = {
      thumbnail: (kind: string) => {
        asked.push(kind);
        return { width: 144, height: 72 };
      },
    };
    createUi(root as never, g.api, renderer as never);
    expect(asked).toEqual([]); // nothing on the first call stack
    const structure = Object.keys(ROOMS).filter((kind) => ROOMS[kind as keyof typeof ROOMS].group === GROUPS[0]?.group);
    for (let i = 0; i < 20; i += 1) dom.runFrame();
    expect(asked.sort()).toEqual([...structure].sort());

    // The Elevators tab: its tiles are drawn now, the others still wait.
    asked.length = 0;
    const tab = root.descendants().find((n) => n.className === 'hs-build-tab' && n.dataset['group'] === '1') as FakeElement;
    click(tab);
    dom.runFrame();
    expect(asked.length).toBe(Math.min(4, Object.keys(SHAFTS).length));
    for (let i = 0; i < 20; i += 1) dom.runFrame();
    expect(asked.sort()).toEqual(Object.keys(SHAFTS).sort());

    // Back to Structure: already drawn, so nothing is asked again.
    asked.length = 0;
    click(root.descendants().find((n) => n.className === 'hs-build-tab' && n.dataset['group'] === '0') as FakeElement);
    for (let i = 0; i < 5; i += 1) dom.runFrame();
    expect(asked).toEqual([]);
  });

  it('draws a tile picked before its category was drawn at once, so the placing bar has its picture', () => {
    const g = game(1);
    const root = dom.createElement('div');
    const asked: string[] = [];
    const renderer = {
      thumbnail: (kind: string) => {
        asked.push(kind);
        return { width: 144, height: 72 };
      },
    };
    createUi(root as never, g.api, renderer as never);
    // The Elevators tile, picked straight away (a key, a tap on the phone sheet): no frame has run.
    click(tool(root, SHAFTS.standard.label));
    expect(asked).toEqual(['standard']);
    for (let i = 0; i < 20; i += 1) dom.runFrame();
    expect(asked.filter((kind) => kind === 'standard')).toHaveLength(1); // and not drawn a second time
  });

  it('draws each thumbnail 112 by 56 css px, 224 by 112 device px at a pixel ratio of 2', () => {
    expect([THUMB_W, THUMB_H]).toEqual([112, 56]);
    const target = { width: 0, height: 0, getContext: () => ({ clearRect() {}, drawImage() {}, imageSmoothingEnabled: false, imageSmoothingQuality: 'low' }) };
    expect(paintThumbnail(target as never, { width: 496, height: 144 } as never, 2)).toBe(true);
    expect([target.width, target.height]).toEqual([224, 112]);
  });
});
