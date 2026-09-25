// The build dock and the phone build sheet: the category tabs, the round Build button, the
// sheet's row, full grid and close, the placing bar with Cancel, and the shortcuts that still
// pick tiles. On the fake DOM; the phone is a window 390 px wide.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Placement, Tool } from '../../src/game/api';
import { createWorld } from '../../src/sim/world';
import {
  createBuildDock,
  isPhoneWidth,
  sheetAfterDrag,
  sheetAfterFab,
  sheetForTool,
  type BuildDock,
} from '../../src/ui/build';
import { buildPalette, type PaletteRow } from '../../src/ui/palette';
import { createUi } from '../../src/ui/ui';
import { FakeDom, type FakeElement } from './fake-dom';

let dom: FakeDom;
let uninstall: () => void;
beforeEach(() => {
  dom = new FakeDom();
  uninstall = dom.install();
});
afterEach(() => uninstall());

const css = readFileSync(new URL('../../src/ui/ui.css', import.meta.url), 'utf8');
const has = (n: FakeElement, c: string): boolean => n.className.split(' ').includes(c);
const click = (node: FakeElement): void => (node.listeners.get('click') ?? []).forEach((fn) => fn({ stopPropagation() {}, preventDefault() {} }));
const fire = (node: FakeElement, type: string, event: Record<string, unknown>): void =>
  (node.listeners.get(type) ?? []).forEach((fn) => fn(event));

function setWidth(width: number): void {
  (globalThis as { window: { innerWidth?: number } }).window.innerWidth = width;
}

describe('sheet rules', () => {
  it('calls 720 px and under a phone, and an unknown width not', () => {
    expect([isPhoneWidth(390), isPhoneWidth(720), isPhoneWidth(721), isPhoneWidth(undefined), isPhoneWidth(0)]).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
  });

  it('opens from the Build button, closes from it, and brings the tiles back over the placing bar', () => {
    expect(sheetAfterFab('closed')).toBe('row');
    expect(sheetAfterFab('row')).toBe('closed');
    expect(sheetAfterFab('full')).toBe('closed');
    expect(sheetAfterFab('placing')).toBe('row');
  });

  it('drags up to the full grid, and down a step at a time to closed', () => {
    expect(sheetAfterDrag('row', -60, 0)).toBe('full');
    expect(sheetAfterDrag('full', 60, 0)).toBe('row');
    expect(sheetAfterDrag('row', 120, 0)).toBe('closed');
    expect(sheetAfterDrag('row', 20, 0)).toBe('row'); // too short, too slow
    expect(sheetAfterDrag('row', 20, 1)).toBe('closed'); // a flick
  });

  it('shrinks to the placing bar with a tool in hand, and back to the row when it is put down', () => {
    expect(sheetForTool('row', true, true)).toBe('placing'); // a pick from the open row
    expect(sheetForTool('row', true)).toBe('row'); // the Build button opened the tiles over the tool
    expect(sheetForTool('closed', true)).toBe('placing');
    expect(sheetForTool('placing', false)).toBe('row');
    expect(sheetForTool('closed', false)).toBe('closed');
  });
});

describe('build dock on its own', () => {
  function dock(phone: boolean): { build: BuildDock; nav: FakeElement; rows: PaletteRow[]; cancels: number[]; tabs: FakeElement[] } {
    const nav = dom.createElement('nav');
    let build: BuildDock | null = null;
    const parts = buildPalette(nav as never, () => {}, () => {}, (group) => build?.setCategory(group));
    const cancels: number[] = [];
    build = createBuildDock({ palette: nav as never, parts, isPhone: () => phone, cancel: () => cancels.push(1), changed: () => {} });
    return { build, nav, rows: parts.rows, cancels, tabs: parts.tabs as unknown as FakeElement[] };
  }

  it('shows one category at a time, picked by its tab', () => {
    const { nav, rows, tabs } = dock(false);
    expect(tabs.map((t) => t.getAttribute('aria-label'))).toEqual(['Structure', 'Elevators', 'Homes', 'Hotel', 'Shops and fun', 'Services', 'Tools']);
    expect(tabs.map((t) => t.getAttribute('role'))).toEqual(Array(7).fill('tab'));
    const visible = (): string[] => rows.filter((r) => !has(r.node as unknown as FakeElement, 'is-other')).map((r) => r.label);
    expect(visible()).toContain('Lobby');
    expect(visible()).not.toContain('Office');
    click(tabs[4]!);
    expect(tabs[4]!.getAttribute('aria-selected')).toBe('true');
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('false');
    expect(visible()).toContain('Office');
    expect(visible()).not.toContain('Lobby');
    expect(nav.dataset['category']).toBe('4');
  });

  it('puts a lock and the stars needed on a locked tile, drawn from its attribute', () => {
    const { rows } = dock(false);
    const shop = rows.find((r) => r.label === 'Shop')!.node as unknown as FakeElement;
    const count = shop.descendants().find((n) => has(n, 'hs-tool-lock-count'))!;
    expect(count.dataset['stars']).toBe('3');
    expect(shop.descendants().find((n) => has(n, 'hs-tool-pic'))?.getAttribute('aria-hidden')).toBe('true');
    expect(css).toMatch(/\.hs-tool\.is-locked \.hs-tool-lock \{\s*display: inline-flex;/);
    expect(css).toMatch(/\.hs-tool-lock-count::before \{\s*content: attr\(data-stars\);/);
  });

  it('opens from the round Build button, drags up to the grid, down to the row, and closes', () => {
    const { build, nav } = dock(true);
    const fab = build.fab as unknown as FakeElement;
    expect(has(nav, 'is-sheet-closed')).toBe(true);
    expect(fab.getAttribute('aria-expanded')).toBe('false');
    click(fab);
    expect(build.sheet()).toBe('row');
    expect(has(nav, 'is-sheet-row')).toBe(true);
    expect(fab.getAttribute('aria-expanded')).toBe('true');
    expect(fab.getAttribute('aria-label')).toBe('Close build');
    // Drag up on the sheet: the full grid.
    fire(nav, 'pointerdown', { clientY: 500, timeStamp: 0, pointerId: 1, target: nav });
    fire(nav, 'pointermove', { clientY: 420, timeStamp: 200, pointerId: 1 });
    fire(nav, 'pointerup', { clientY: 420, timeStamp: 400, pointerId: 1 });
    expect(build.sheet()).toBe('full');
    // Swipe down: the row, then closed.
    fire(nav, 'pointerdown', { clientY: 100, timeStamp: 1000, pointerId: 2, target: nav });
    fire(nav, 'pointerup', { clientY: 200, timeStamp: 1400, pointerId: 2 });
    expect(build.sheet()).toBe('row');
    fire(nav, 'pointerdown', { clientY: 100, timeStamp: 2000, pointerId: 3, target: nav });
    fire(nav, 'pointerup', { clientY: 240, timeStamp: 2400, pointerId: 3 });
    expect(build.sheet()).toBe('closed');
    expect(has(nav, 'is-sheet-closed')).toBe(true);
  });

  it('closes on Escape and gives focus back to the Build button', () => {
    const { build } = dock(true);
    const fab = build.fab as unknown as FakeElement;
    click(fab);
    expect(dom.activeElement?.getAttribute('role')).toBe('tab'); // focus went into the sheet
    let prevented = false;
    expect(build.handleKey({ key: 'Escape', preventDefault: () => (prevented = true) })).toBe(true);
    expect([build.sheet(), prevented]).toEqual(['closed', true]);
    expect(dom.activeElement).toBe(fab);
    expect(build.handleKey({ key: 'Escape', preventDefault: () => {} })).toBe(false); // nothing left to close
  });

  it('shrinks to the placing bar with the item, its cost and Cancel', () => {
    const { build, nav, rows, cancels } = dock(true);
    click(build.fab as unknown as FakeElement);
    const office = rows.find((r) => r.label === 'Office')!;
    build.sync(office);
    expect(build.sheet()).toBe('placing');
    expect(has(nav, 'is-sheet-placing')).toBe(true);
    const placing = build.placeBar as unknown as FakeElement;
    expect(placing.descendants().find((n) => has(n, 'hs-build-placing-name'))?.textContent).toBe('Office');
    expect(placing.descendants().find((n) => has(n, 'hs-build-placing-cost'))?.textContent).toBe('$40,000');
    const cancel = placing.descendants().find((n) => n.textContent === 'Cancel')!;
    click(cancel);
    expect(cancels).toEqual([1]);
    build.sync(null);
    expect(build.sheet()).toBe('row');
    // The Build button over a tool in hand opens the tiles, and they stay until a new pick.
    build.sync(office);
    expect(build.sheet()).toBe('placing');
    click(build.fab as unknown as FakeElement);
    build.sync(office);
    expect(build.sheet()).toBe('row');
  });

  it('keeps the dock as it is on a wide screen, tool or none', () => {
    const { build, rows, nav } = dock(false);
    click(build.fab as unknown as FakeElement);
    build.sync(rows[0]!);
    expect(build.sheet()).toBe('closed');
    expect(has(nav, 'is-sheet-placing')).toBe(false);
  });
});

describe('build in the shell', () => {
  function game(stars = 1): { api: never; tools: Tool[]; cancelled: number[] } {
    const tools: Tool[] = [];
    const cancelled: number[] = [];
    let tool: Tool = { kind: 'none' };
    const world = {
      cash: 1_000_000,
      population: 0,
      stars,
      time: { minute: 12 * 60 },
      log: [],
      logTotal: 0,
      rooms: new Map(),
      shafts: new Map(),
      sims: new Map(),
      events: [],
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
      cancelPending: () => cancelled.push(1),
      setChrome: () => {},
      setReducedMotion: () => {},
    } as never;
    return { api, tools, cancelled };
  }

  const find = (root: FakeElement, c: string): FakeElement => [root, ...root.descendants()].find((n) => has(n, c))!;
  const tile = (root: FakeElement, label: string): FakeElement =>
    root.descendants().find((n) => has(n, 'hs-tool') && n.descendants().some((d) => d.className === 'hs-tool-name' && d.textContent === label))!;

  it('on a phone: hidden until Build, a pick shrinks it to the placing bar, Cancel puts the tool down and brings the row back', () => {
    setWidth(390);
    const g = game();
    const root = dom.createElement('div');
    createUi(root as never, g.api, {} as never);
    const nav = find(root, 'hs-palette');
    const fab = find(root, 'hs-build-fab');
    expect(has(nav, 'is-sheet-closed')).toBe(true);
    click(fab);
    expect(has(nav, 'is-sheet-row')).toBe(true);
    click(tile(root, 'Lobby'));
    expect(g.tools).toEqual([{ kind: 'room', room: 'lobby' }]);
    expect(has(nav, 'is-sheet-placing')).toBe(true);
    click(find(root, 'hs-build-placing-cancel'));
    expect(g.tools.at(-1)).toEqual({ kind: 'none' });
    expect(has(nav, 'is-sheet-row')).toBe(true);
  });

  it('on a wide screen: the dock is there from the start, folds to its icons, and a tab opens it on that category', () => {
    setWidth(1280);
    const g = game();
    const root = dom.createElement('div');
    createUi(root as never, g.api, {} as never);
    const nav = find(root, 'hs-palette');
    expect(has(nav, 'is-collapsed')).toBe(false);
    click(find(nav, 'hs-palette-toggle'));
    expect(has(nav, 'is-collapsed')).toBe(true);
    const tabs = nav.descendants().filter((n) => has(n, 'hs-build-tab'));
    click(tabs[2]!);
    expect(has(nav, 'is-collapsed')).toBe(false);
    expect(tabs[2]!.getAttribute('aria-selected')).toBe('true');
  });

  it('keeps the number and letter shortcuts: a number key picks and shows its category', () => {
    setWidth(1280);
    const g = game(3);
    const root = dom.createElement('div');
    createUi(root as never, g.api, {} as never);
    const key = (k: string): void =>
      dom.fireWindow('keydown', { key: k, code: /\d/.test(k) ? `Digit${k}` : `Key${k.toUpperCase()}`, target: dom.body, preventDefault() {} });
    key('3');
    expect(g.tools.at(-1)).toEqual({ kind: 'room', room: 'condo' });
    const tabs = root.descendants().filter((n) => has(n, 'hs-build-tab'));
    expect(tabs[2]!.getAttribute('aria-selected')).toBe('true');
    key('5');
    const five = g.tools.at(-1) as { kind: string; room?: string };
    expect(five.kind).toBe('room');
    expect(tabs[4]!.getAttribute('aria-selected')).toBe('true');
  });

  it('disables Build on a refused spot, with the reason in the chip, and enables it on a good one', () => {
    setWidth(390);
    const listeners = new Set<() => void>();
    const office: Placement = { floor: 2, x: 100, floorMin: 2, floorMax: 2, ok: true, label: 'Office', cost: 40_000, pending: true };
    let placement: Placement = { ...office, ok: false, reason: 'Build a floor below this one first.' };
    const api = {
      world: createWorld(7),
      subscribe(cb: () => void) {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      subscribeEvents: () => () => {},
      getHover: () => null,
      getSpeed: () => 1,
      getTool: (): Tool => ({ kind: 'room', room: 'office' }),
      setTool: () => {},
      getPlacement: () => placement,
      getPlacementRect: () => null,
      getSelection: () => null,
      cancelPending: () => {},
      setChrome: () => {},
      setReducedMotion: () => {},
    } as never;
    const root = dom.createElement('div');
    createUi(root as never, api, {} as never);
    const notify = (): void => listeners.forEach((cb) => cb());
    const buildButton = (): FakeElement => find(root, 'hs-place-bar').descendants().find((n) => has(n, 'is-primary'))!;

    notify();
    expect(has(find(root, 'hs-place-bar'), 'is-hidden')).toBe(false);
    expect(find(root, 'hs-place-chip-text').textContent).toBe('Build a floor below this one first.');
    expect(has(find(root, 'hs-place-chip'), 'is-alert')).toBe(true);
    expect(buildButton().disabled).toBe(true);

    placement = office;
    notify();
    expect(find(root, 'hs-place-chip-text').textContent).toBe('Office · $40,000');
    expect(buildButton().disabled).toBe(false);
  });

  it('keeps every build control a 44 px target in the css', () => {
    expect(css).toMatch(/\.hs-build-tab \{[^}]*min-width: var\(--touch\);[^}]*min-height: var\(--touch\);/);
    expect(css).toMatch(/\.hs-build-fab \{[^}]*width: var\(--fab\);/);
    expect(css).toMatch(/--fab: calc\(60px \* var\(--ui-scale\)\);/);
    expect(css).toMatch(/\.hs-build-placing-cancel \{[^}]*min-height: var\(--touch\);/);
  });
});
