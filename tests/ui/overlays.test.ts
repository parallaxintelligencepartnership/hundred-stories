// The Views popover and its chip on the fake DOM: one view at a time, the list opens from the
// Views button (the Popover API, or the fallback box without it), the chip shows the view that
// is on with its legend and an x, and the shell hands the choice to the renderer.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OVERLAY_RAMP, OVERLAY_RAMP_COLOR_BLIND } from '../../src/render/overlays';
import { createViewControl, VIEW_OPTIONS, type ViewChoice } from '../../src/ui/overlays';
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

function itemsOf(root: FakeElement): FakeElement[] {
  return root.descendants().filter((n) => has(n, 'hs-views-item'));
}

function click(node: FakeElement): void {
  for (const fn of node.listeners.get('click') ?? []) fn({});
}

function pressed(root: FakeElement): string[] {
  return itemsOf(root)
    .filter((b) => b.getAttribute('aria-pressed') === 'true')
    .map((b) => b.textContent);
}

function parts(control: ReturnType<typeof createViewControl>) {
  return {
    button: control.button as unknown as FakeElement,
    menu: control.menu as unknown as FakeElement,
    chip: control.chip as unknown as FakeElement,
    legend: control.legend as unknown as FakeElement,
  };
}

describe('views popover', () => {
  it('lists the four views, an icon and a name each, none on, the chip hidden', () => {
    const control = createViewControl(() => {}, { popover: false });
    const { button, menu, chip } = parts(control);
    expect(itemsOf(menu).map((b) => b.textContent)).toEqual(['Stress', 'Noise', 'Vacancy', 'Elevator wait']);
    expect(VIEW_OPTIONS.map((o) => o.kind)).toEqual(['stress', 'noise', 'vacancy', 'wait']);
    for (const item of itemsOf(menu)) expect(item.children[0]?.getAttribute('aria-hidden')).toBe('true'); // the icon
    expect(button.getAttribute('aria-label')).toBe('Views');
    expect(button.getAttribute('aria-controls')).toBe(menu.id);
    expect(pressed(menu)).toEqual([]);
    expect(has(chip, 'is-hidden')).toBe(true);
  });

  it('is a Popover API popover the button opens by itself where the browser has one', () => {
    const control = createViewControl(() => {}, { popover: true });
    const { button, menu } = parts(control);
    expect(menu.getAttribute('popover')).toBe('auto');
    expect(button.getAttribute('popovertarget')).toBe(menu.id);
    // The popover tells the button it opened, and focus goes into the list.
    for (const fn of menu.listeners.get('toggle') ?? []) fn({ newState: 'open' });
    expect(control.isOpen()).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(dom.activeElement).toBe(itemsOf(menu)[0]);
    for (const fn of menu.listeners.get('toggle') ?? []) fn({ newState: 'closed' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('falls back to a box the button shows and hides, and a pick closes it and returns focus', () => {
    const changes: ViewChoice[] = [];
    const control = createViewControl((kind) => changes.push(kind), { popover: false });
    const { button, menu } = parts(control);
    expect(menu.getAttribute('popover')).toBe(null);
    expect(menu.hidden).toBe(true);
    click(button);
    expect([menu.hidden, button.getAttribute('aria-expanded')]).toEqual([false, 'true']);
    click(itemsOf(menu)[1]!); // Noise
    expect(changes).toEqual(['noise']);
    expect([menu.hidden, control.isOpen()]).toEqual([true, false]);
    expect(dom.activeElement).toBe(button);
    // Open again: focus lands on the view that is on.
    click(button);
    expect(dom.activeElement).toBe(itemsOf(menu)[1]);
    // A tap outside closes it.
    dom.fireWindow('pointerdown', { target: dom.body });
    expect(menu.hidden).toBe(true);
  });

  it('keeps one view on at a time, and the row that is on turns it off', () => {
    const changes: ViewChoice[] = [];
    const control = createViewControl((kind) => changes.push(kind), { popover: false });
    const { menu } = parts(control);
    const [stress, noise] = itemsOf(menu);
    click(stress!);
    click(noise!);
    expect(pressed(menu)).toEqual(['Noise']);
    expect(control.get()).toBe('noise');
    click(noise!);
    expect(pressed(menu)).toEqual([]);
    expect(changes).toEqual(['stress', 'noise', null]);
  });

  it('shows the chip with the legend while a view is on, and its x turns it off', () => {
    const changes: ViewChoice[] = [];
    const control = createViewControl((kind) => changes.push(kind), { popover: false });
    const { chip, legend, button } = parts(control);
    control.set('wait');
    expect(has(chip, 'is-hidden')).toBe(false);
    expect(chip.descendants().find((n) => has(n, 'hs-view-chip-title'))?.textContent).toBe('Elevator wait');
    expect(legend.children).toHaveLength(5);
    expect(legend.textContent).toBe('NobodyUnder 5 min5 to 1515 to 3535 min or more');
    const swatches = legend.descendants().filter((n) => has(n, 'hs-legend-swatch'));
    expect(swatches.map((s) => s.style['backgroundColor'])).toEqual(OVERLAY_RAMP.map((c) => `#${c.toString(16).padStart(6, '0')}`));
    expect(has(button, 'is-on')).toBe(true);
    const x = chip.descendants().find((n) => has(n, 'hs-view-chip-close'))!;
    expect(x.getAttribute('aria-label')).toBe('Turn off the elevator wait view');
    click(x);
    expect(has(chip, 'is-hidden')).toBe(true);
    expect(legend.children).toHaveLength(0);
    expect(changes).toEqual(['wait', null]);
    expect(dom.activeElement).toBe(button);
  });

  it('draws the legend in the blue to orange palette with the worst step striped when color-blind is on', () => {
    const control = createViewControl(() => {}, { popover: false });
    const { legend } = parts(control);
    control.set('stress');
    const swatches = (): FakeElement[] => legend.descendants().filter((n) => has(n, 'hs-legend-swatch'));
    expect(swatches().filter((s) => has(s, 'is-striped'))).toHaveLength(0);
    control.setColorBlind(true);
    expect(swatches().map((s) => s.style['backgroundColor'])).toEqual(
      OVERLAY_RAMP_COLOR_BLIND.map((c) => `#${c.toString(16).padStart(6, '0')}`),
    );
    expect(swatches().map((s) => has(s, 'is-striped'))).toEqual([false, false, false, false, true]);
    // The stripes are drawn in css, so meaning never rests on color alone.
    expect(css).toMatch(/\.hs-legend-swatch\.is-striped \{\s*background-image: repeating-linear-gradient/);
  });

  it('places the list against the button with anchor positioning where supported, and under the bar where not', () => {
    expect(css).toMatch(/\.hs-views-btn \{\s*anchor-name: --hs-views;/);
    expect(css).toMatch(/@supports \(anchor-name: --a\) \{\s*\.hs-views-menu \{\s*position-anchor: --hs-views;/);
    expect(css).toMatch(/\.hs-views-menu \{\s*position: fixed;[\s\S]*?top: calc\(var\(--top-actual/);
  });
});

describe('views in the shell', () => {
  function fakeGame() {
    return {
      world: {
        cash: 1_000_000,
        population: 0,
        stars: 1,
        time: { minute: 0 },
        log: [],
        logTotal: 0,
        rooms: new Map(),
        shafts: new Map(),
        sims: new Map(),
        events: [],
      },
      subscribe: () => () => {},
      getHover: () => null,
      getSpeed: () => 1,
      getTool: () => ({ kind: 'none' }),
      setTool: () => {},
      getPlacement: () => null,
      getPlacementRect: () => null,
      getSelection: () => null,
      setChrome: () => {},
      setReducedMotion: () => {},
    } as never;
  }

  it('puts one Views button in the top bar and the chip under it, and hands each choice to the renderer', () => {
    const calls: ViewChoice[] = [];
    const root = dom.createElement('div');
    createUi(root as never, fakeGame(), { setOverlay: (kind: ViewChoice) => calls.push(kind) } as never);
    const top = root.descendants().find((n) => n.className === 'hs-top')!;
    const actions = top.descendants().find((n) => has(n, 'hs-top-actions'))!;
    const viewsButton = actions.children.find((n) => has(n, 'hs-views-btn'))!;
    expect(viewsButton).toBeDefined();
    // Views sits just before Share and Menu, so the round buttons stay together.
    const labels = actions.children.filter((n) => n.tagName === 'BUTTON').map((n) => n.getAttribute('aria-label'));
    expect(labels.slice(-3)).toEqual(['Views', 'Share', 'Menu']);
    expect(top.children.some((n) => has(n, 'hs-view-chip'))).toBe(true);
    const shell = root.children[0]!;
    const menu = shell.children.find((n) => has(n, 'hs-views-menu'))!;
    expect(calls).toEqual([]); // nothing is remembered, so nothing is restored
    const items = itemsOf(menu);
    click(items[0]!);
    expect(has(shell, 'has-view')).toBe(true);
    click(items[3]!);
    click(top.descendants().find((n) => has(n, 'hs-view-chip-close'))!);
    expect(calls).toEqual(['stress', 'wait', null]);
    expect(has(shell, 'has-view')).toBe(false);
  });

  it('closes the list on Escape before the key does anything else', () => {
    const root = dom.createElement('div');
    const tools: unknown[] = [];
    const game = fakeGame() as unknown as Record<string, unknown>;
    game['setTool'] = (t: unknown) => tools.push(t);
    createUi(root as never, game as never, {} as never);
    const shell = root.children[0]!;
    const viewsButton = shell.descendants().find((n) => has(n, 'hs-views-btn'))!;
    click(viewsButton);
    const menu = shell.children.find((n) => has(n, 'hs-views-menu'))!;
    expect(menu.hidden).toBe(false);
    let prevented = false;
    dom.fireWindow('keydown', {
      key: 'Escape',
      code: 'Escape',
      target: dom.body,
      preventDefault: () => (prevented = true),
      stopImmediatePropagation: () => {},
    });
    expect(menu.hidden).toBe(true);
    expect(prevented).toBe(true);
    expect(tools).toEqual([]); // the tool in hand stays: Escape only closed the list
  });
});
