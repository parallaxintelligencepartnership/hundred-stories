// The status bar at phone width (390 px): two 56 px rows, cash, population and stars on the
// first; the clock and the controls on the second, with the day in the clock's tooltip. The
// fake DOM has no layout, so the row placement is read from the shell's DOM order and from
// the phone block of ui.css, which is what puts each group on its row.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

/** The body of the first `@media (max-width: 720px)` block, braces balanced. */
function phoneBlock(): string {
  const start = css.indexOf('@media (max-width: 720px) {');
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}' && --depth === 0) return css.slice(css.indexOf('{', start) + 1, i);
  }
  throw new Error('no phone block');
}

/** The body of a block nested in another, e.g. the under-400 px block inside the phone block. */
function nestedBlock(outer: string, head: string): string {
  const start = outer.indexOf(head);
  if (start < 0) throw new Error(`no ${head}`);
  let depth = 0;
  for (let i = outer.indexOf('{', start); i < outer.length; i += 1) {
    if (outer[i] === '{') depth += 1;
    if (outer[i] === '}' && --depth === 0) return outer.slice(outer.indexOf('{', start) + 1, i);
  }
  throw new Error(`unclosed ${head}`);
}

/** Every declaration for an exact selector inside a block, later rules winning. */
function rule(block: string, selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = re.exec(block); m; m = re.exec(block)) {
    const selectors = (m[1] ?? '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split(',')
      .map((s) => s.trim());
    if (!selectors.includes(selector)) continue;
    for (const decl of (m[2] ?? '').split(';')) {
      const [k, ...v] = decl.split(':');
      if (k && v.length) out[k.trim()] = v.join(':').trim();
    }
  }
  return out;
}

const has = (n: FakeElement, c: string): boolean => n.className.split(' ').includes(c);
const find = (root: FakeElement, c: string): FakeElement => {
  const node = [root, ...root.descendants()].find((n) => has(n, c));
  if (!node) throw new Error(`no ${c}`);
  return node;
};

function mount(minute: number, extra: Record<string, unknown> = {}): FakeElement {
  const world = {
    cash: 2_000_000,
    population: 0,
    stars: 1,
    time: { minute },
    log: [],
    logTotal: 0,
    rooms: new Map(),
    shafts: new Map(),
    sims: new Map(),
    events: [],
    ...extra,
  };
  const api = {
    world,
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
  const root = dom.createElement('div');
  createUi(root as never, api, {} as never);
  return root;
}

describe('status bar at phone width', () => {
  it('puts the clock on the second row, the day in its tooltip, and the time whole beside a 32 px dial', () => {
    const root = mount(12 * 60 + 59 + 2 * 1440); // 12:59 PM, the widest time
    const top = find(root, 'hs-top');
    const [readouts, clockGroup, actions] = top.children as [FakeElement, FakeElement, FakeElement];
    // Row one: the readouts take the full width, so everything after them wraps to row two.
    expect(has(readouts, 'hs-readouts')).toBe(true);
    expect(rule(phoneBlock(), '.hs-readouts').flex).toBe('1 1 100%');
    for (const c of ['hs-status-cash', 'hs-status-pop', 'hs-status-stars']) find(readouts, c);
    // Row two: the clock group dissolves into the row, the clock first, the controls after it.
    expect(has(clockGroup, 'hs-clock-group')).toBe(true);
    expect(has(actions, 'hs-top-actions')).toBe(true);
    expect(rule(phoneBlock(), '.hs-clock-group').display).toBe('contents');
    const clock = find(clockGroup, 'hs-status-clock');
    expect(clockGroup.children[0]).toBe(clock);

    // The day line is hidden on a phone and lives in the tooltip instead.
    const date = clock.descendants().find((n) => has(n, 'hs-readout-meta')) as FakeElement;
    expect(date.textContent).toMatch(/^Weekend, quarter 1, year 1$/);
    expect(clock.getAttribute('title')).toBe(date.textContent);
    expect(rule(phoneBlock(), '.hs-status-clock .hs-readout-meta').display).toBe('none');

    // The time: digits at the 20 px value token, AM or PM stacked under them at the 12 px
    // meta token, the dial at 32 px, so "12:59" fits in the 105 px left beside the controls.
    const value = find(clock, 'hs-readout-value');
    expect(value.textContent).toBe('12:59 PM');
    expect(find(value, 'hs-clock-digits').textContent).toBe('12:59');
    expect(find(value, 'hs-clock-ampm').textContent).toBe(' PM');
    const ampm = rule(phoneBlock(), '.hs-clock-ampm');
    expect([ampm.display, ampm['font-size']]).toEqual(['block', 'var(--status-meta)']);
    expect(rule(phoneBlock(), '.hs-status-clock')['--clock-size']).toBe('32px');
  });

  it('at 360 px fits cash, population and the six stars on row one: 16 px values, the changes in the tooltips', () => {
    // At 360 px the cash column is 102 px beside population (104) and the stars (122):
    // $47,522,007 is 119 px at the 20 px value token and 95 px at 16 px, so under 400 px
    // the values drop to 16 px and both change lines move into their readout's tooltip.
    const narrow = nestedBlock(phoneBlock(), '@media (max-width: 399px)');
    for (const c of ['.hs-status-cash', '.hs-status-pop']) {
      expect(rule(narrow, `${c} .hs-readout-value`)['font-size']).toBe('var(--size-16)');
      expect(rule(narrow, `${c} .hs-readout-meta`).display).toBe('none');
    }
    // The clock keeps its 20 px digits; only the first row's values shrink.
    expect(rule(narrow, '.hs-readout-value')).toEqual({});

    const root = mount(9 * 60, { cash: 47_522_007, quarterStartCash: 47_000_000, population: 177, dayStartPopulation: 170 });
    const cash = find(root, 'hs-status-cash');
    const pop = find(root, 'hs-status-pop');
    expect(find(cash, 'hs-readout-value').textContent).toBe('$47,522,007');
    expect(find(cash, 'hs-readout-meta').textContent).toBe('+$522,007 this quarter');
    expect(cash.getAttribute('title')).toBe('Open finances. +$522,007 this quarter');
    expect(find(pop, 'hs-readout-value').textContent).toBe('177');
    expect(pop.getAttribute('title')).toBe('Up 7 today');
  });

  it('at 360 px leaves cash room for a nine digit figure, population narrowed to 72 px', () => {
    const narrow = nestedBlock(phoneBlock(), '@media (max-width: 399px)');
    expect(rule(narrow, '.hs-status-pop').flex).toBe('0 1 72px');
    const root = mount(9 * 60, { cash: 123_456_789, quarterStartCash: 123_000_000 });
    const cash = find(root, 'hs-status-cash');
    const value = find(cash, 'hs-readout-value').textContent;
    expect(value).toBe('$123,456,789');
    expect(cash.getAttribute('title')).toBe('Open finances. +$456,789 this quarter');
    // The budget at 360 px, from the Chrome measure: 8 px padding each side, two 8 px gaps,
    // population 72, stars 122, and the cash column's own 8 px right padding. Share Tech Mono
    // advances 0.5 em plus the 0.04 em letter spacing, 8.64 px a character at 16 px.
    const room = 360 - 2 * 8 - 2 * 8 - 72 - 122 - 8;
    expect(room).toBe(126);
    expect(value.length * 16 * 0.54).toBeLessThanOrEqual(room);
  });
});
