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

function mount(minute: number): FakeElement {
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
});
