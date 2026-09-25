// The top bar at phone width (390 px): two rows. The glass pill of cash, people, stars, the
// clock and the weather is the whole first row; the speed pill, Views, Share and Menu sit on the
// right of the second, every one a 44 px target. The active view's chip hangs under the bar,
// out of its flow. The fake DOM has
// no layout, so the placement is read from the shell's DOM order and from the phone block of
// ui.css, which is what puts each group on its row.
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


describe('top bar at phone width', () => {
  const wide = (): string => css.slice(0, css.indexOf('@media (max-width: 720px) {'));

  it('keeps the pill one row, the whole first row: cash, people, stars, then the clock with the weather', () => {
    const root = mount(12 * 60 + 59 + 2 * 1440); // 12:59 PM, the widest time
    const top = find(root, 'hs-top');
    const [pill, actions, chip] = top.children as [FakeElement, FakeElement, FakeElement];
    expect(has(pill, 'hs-status-pill')).toBe(true);
    expect(pill.getAttribute('role')).toBe('group');
    expect(pill.getAttribute('aria-label')).toBe('Your tower');
    expect(pill.children.slice(0, 4).map((n) => n.className.split(' ')[1])).toEqual([
      'hs-status-cash',
      'hs-status-pop',
      'hs-status-stars',
      'hs-status-clock',
    ]);
    expect(rule(wide(), '.hs-status-pill')['flex-wrap']).toBe('nowrap');
    // Row one is the pill alone; the controls are row two, and nothing else is in the flow: the
    // chip is placed under the bar, so the bar is two rows with or without a view on.
    expect(rule(phoneBlock(), '.hs-status-pill').flex).toBe('1 1 100%');
    expect(has(actions, 'hs-top-actions')).toBe(true);
    expect(rule(phoneBlock(), '.hs-top-actions').order).toBe('2');
    expect(has(chip, 'hs-view-chip')).toBe(true);
    expect(rule(wide(), '.hs-view-chip').position).toBe('absolute');
    expect(top.children).toHaveLength(3);
    expect(css).not.toMatch(/hs-top-views/);

    // The day line is hidden on a phone and lives in the tooltip instead.
    const clock = find(pill, 'hs-status-clock');
    const date = clock.descendants().find((n) => has(n, 'hs-readout-meta')) as FakeElement;
    expect(date.textContent).toMatch(/^Weekend, quarter 1, year 1$/);
    expect(clock.getAttribute('title')).toBe(date.textContent);
    expect(rule(phoneBlock(), '.hs-status-clock .hs-readout-meta').display).toBe('none');
    // So is the dial: the time and the weather icon say it.
    expect(rule(phoneBlock(), '.hs-dial').display).toBe('none');

    // The time: the digits in the readout face, AM or PM beside them at the 12 px meta token.
    const value = find(clock, 'hs-readout-value');
    expect(value.textContent).toBe('12:59 PM');
    expect(find(value, 'hs-clock-digits').textContent).toBe('12:59');
    expect(find(value, 'hs-clock-ampm').textContent).toBe(' PM');
    expect(rule(phoneBlock(), '.hs-clock-ampm')['font-size']).toBe('var(--status-meta)');
    // The weather is the last thing in the clock readout: an icon, its word hidden from sight.
    expect(clock.children[clock.children.length - 1]?.className).toBe('hs-weather');
    expect(rule(wide(), '.hs-weather-word').position).toBe('absolute');
  });

  it('moves the changes into the tooltips and the six stars into one star and the count', () => {
    for (const c of ['.hs-status-cash', '.hs-status-pop', '.hs-status-stars', '.hs-status-clock']) {
      expect(rule(phoneBlock(), `${c} .hs-readout-meta`).display).toBe('none');
    }
    expect(rule(phoneBlock(), '.hs-star-row').display).toBe('none');
    expect(rule(phoneBlock(), '.hs-stars-count').display).toBe('flex');
    expect(rule(wide(), '.hs-stars-count').display).toBe('none');

    const root = mount(9 * 60, { cash: 47_522_007, quarterStartCash: 47_000_000, population: 177, dayStartPopulation: 170, stars: 3 });
    const cash = find(root, 'hs-status-cash');
    const pop = find(root, 'hs-status-pop');
    expect(find(cash, 'hs-readout-value').textContent).toBe('$47,522,007');
    expect(find(cash, 'hs-readout-meta').textContent).toBe('+$522,007 this quarter');
    expect(cash.getAttribute('title')).toBe('Open finances. +$522,007 this quarter');
    expect(find(pop, 'hs-readout-value').textContent).toBe('177');
    expect(pop.getAttribute('title')).toBe('Up 7 today');
    expect(find(root, 'hs-stars-count-text').textContent).toBe('3');
  });

  it('keeps the readout face for cash and the clock only, with tabular figures', () => {
    const face = rule(wide(), '.hs-clock-digits');
    expect(face['font-family']).toBe('var(--font-readout)');
    expect(face['font-variant-numeric']).toBe('tabular-nums');
    expect(rule(wide(), '.hs-status-cash .hs-readout-value')['font-family']).toBe('var(--font-readout)');
    // Every other use of the readout face is gone: two selectors in one rule, and the token.
    const uses = css.match(/font-family: var\(--font-readout\)/g) ?? [];
    expect(uses).toHaveLength(1);
    expect(rule(wide(), '.hs-readout-value')['font-family']).toBeUndefined();
  });

  it('at 360 px leaves cash room for a nine digit figure in the one row', () => {
    const narrow = nestedBlock(phoneBlock(), '@media (max-width: 399px)');
    expect(rule(narrow, '.hs-readout-icon').display).toBe('none');
    expect(rule(narrow, '.hs-readout').padding).toBe('2px 4px');
    expect(rule(narrow, '.hs-readout')['column-gap']).toBe('0');
    const root = mount(12 * 60 + 59, { cash: 123_456_789, quarterStartCash: 123_000_000, population: 15_000, stars: 6 });
    const cash = find(root, 'hs-status-cash');
    const value = find(cash, 'hs-readout-value').textContent;
    expect(value).toBe('$123,456,789');
    expect(cash.getAttribute('title')).toBe('Open finances. +$456,789 this quarter');
    // The budget at 360 px: 8 px from each edge and the pill's own 2 px padding leave 340 px;
    // four readouts at 4 px padding a side and three 4 px gaps take 44 of it. Share Tech Mono
    // advances 0.5 em plus the 0.02 em letter spacing at the 16 px value token; the UI font's
    // tabular digits are at most 0.6 em; the star is 16 px, a 4 px gap and one digit; the clock
    // is "12:59" in the readout face, " PM" at 12 px, a 6 px gap and the 20 px weather icon.
    const room = 360 - 2 * 8 - 2 * 2 - 4 * 2 * 4 - 3 * 4;
    expect(room).toBe(296);
    const cashW = value.length * 16 * 0.52;
    const popW = '15,000'.length * 16 * 0.6;
    const starsW = 16 + 4 + 16 * 0.6;
    const clockW = 5 * 16 * 0.52 + 3 * 12 * 0.6 + 6 + 20;
    expect(cashW + popW + starsW + clockW).toBeLessThanOrEqual(room);
  });

  it('keeps Share and Menu round with 44 px targets, the word hidden on a phone and named by aria-label', () => {
    const root = mount(9 * 60);
    const actions = find(root, 'hs-top-actions');
    const buttons = actions.descendants().filter((n) => n.tagName === 'BUTTON');
    const share = buttons.find((n) => n.getAttribute('aria-label') === 'Share') as FakeElement;
    const menu = buttons.find((n) => n.getAttribute('aria-label') === 'Menu') as FakeElement;
    for (const b of [share, menu]) {
      expect(has(b, 'hs-round')).toBe(true);
      expect(b.title.length).toBeGreaterThan(0); // the tooltip, for a long press or a hover
      expect(find(b, 'hs-btn-label').textContent).toBe(b.getAttribute('aria-label'));
    }
    expect(rule(phoneBlock(), '.hs-round .hs-btn-label').display).toBe('none');
    expect(rule(wide(), '.hs-icon-btn')['min-width']).toBe('var(--touch)');
    expect(rule(wide(), '.hs-icon-btn')['min-height']).toBe('var(--touch)');
    expect(css).toMatch(/--touch: calc\(44px \* var\(--ui-scale\)\);/);
    expect(css).toMatch(/:root \{\s*(\/\*[\s\S]*?\*\/\s*)?--ui-scale: 1;/);
  });

  it('fits row two at 390 px: the speed pill, Views, Share and Menu, all 44 px or more', () => {
    const root = mount(9 * 60);
    const actions = find(root, 'hs-top-actions');
    const rounds = actions.children.filter((n) => n.tagName === 'BUTTON' && has(n, 'hs-round') && !n.hidden);
    expect(rounds.map((n) => n.getAttribute('aria-label'))).toEqual(['Views', 'Share', 'Menu']);
    const speed = find(actions, 'hs-speed');
    expect(speed.children).toHaveLength(4);
    // The sizes the css gives them on a phone.
    expect(rule(phoneBlock(), '.hs-speed-btn')['min-width']).toBe('var(--touch)');
    expect(rule(wide(), '.hs-round')['min-width']).toBe('calc(var(--touch) + 8px)');
    expect(rule(phoneBlock(), '.hs-top').gap).toBe('6px');
    const touch = 44;
    const speedW = 4 * touch + 3 * 2 + 2 * 4; // four buttons, 2 px apart, in 4 px padding
    const roundsW = 3 * (touch + 8);
    const gaps = 3 * 6;
    const room = 390 - 2 * 8; // the phone's 8 px edges
    expect(speedW + roundsW + gaps).toBeLessThanOrEqual(room);
    // The night mode label hangs off the speed pill, out of the row.
    expect(rule(phoneBlock(), '.hs-speed-mode').position).toBe('absolute');
  });
});
