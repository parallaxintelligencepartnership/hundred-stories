// The top bar at phone width (390 px): one row. The glass pill of cash, people, stars, the clock
// and the weather is the whole bar; the speed pill and Menu sit in the bottom left corner under
// the left thumb, clear of Build, every one a 44 px target, and step aside while the build sheet
// or a panel is open. Views and Share are rows in Settings there, and the star count opens the
// goals. The active view's chip hangs under the bar, out of its flow. The fake DOM has no
// layout, so the placement is read from the shell's DOM order and from the phone block of
// ui.css, which is what puts each group where it is.
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
const fire = (node: FakeElement, type: string): void =>
  (node.listeners.get(type) ?? []).forEach((fn) => fn({ stopPropagation() {}, preventDefault() {} }));
const click = (node: FakeElement): void => fire(node, 'click');
/** A button by its aria-label: the top bar's icon buttons. */
const named = (root: FakeElement, label: string): FakeElement => {
  const node = root.descendants().find((n) => n.tagName === 'BUTTON' && n.getAttribute('aria-label') === label);
  if (!node) throw new Error(`no button named ${label}`);
  return node;
};
/** A button by its words. */
const buttonText = (root: FakeElement, text: string): FakeElement => {
  const node = root.descendants().find((n) => n.tagName === 'BUTTON' && n.textContent === text);
  if (!node) throw new Error(`no ${text} button`);
  return node;
};
/** A Settings row by its words. */
const rowNamed = (root: FakeElement, text: string): FakeElement => {
  const node = root.descendants().find((n) => has(n, 'hs-set-action') && n.textContent === text);
  if (!node) throw new Error(`no ${text} row`);
  return node;
};
/** The title of the sheet on screen. */
const sheetTitle = (root: FakeElement): string => find(find(root, 'hs-sheet'), 'hs-panel-title-text').textContent;

function setWidth(width: number): void {
  (globalThis as { window: { innerWidth?: number } }).window.innerWidth = width;
}

function store(): { getItem(k: string): string | null; setItem(k: string, v: string): void } {
  return (globalThis as unknown as { window: { localStorage: { getItem(k: string): string | null; setItem(k: string, v: string): void } } }).window
    .localStorage;
}

/** A returning player: the intro and the guide are done, so the side card carries the goals. */
function returning(extra: Record<string, string> = {}): void {
  for (const [key, value] of Object.entries({ 'hs.intro.seen': 'true', 'hs.guide.done': 'true', ...extra })) store().setItem(key, value);
}

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
    // The pill is the bar's one row: the controls leave its flow for the bottom left corner, and
    // the chip is placed under the bar, so the bar is one row with or without a view on.
    expect(rule(phoneBlock(), '.hs-status-pill').flex).toBe('1 1 100%');
    expect(has(actions, 'hs-top-actions')).toBe(true);
    expect(rule(phoneBlock(), '.hs-top-actions').position).toBe('fixed');
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
    // Every other use of the readout face is gone: one rule (cash, the clock, panel money), the
    // floor under the cursor (design pass D-21), and the token.
    const uses = css.match(/font-family: var\(--font-readout\)/g) ?? [];
    expect(uses).toHaveLength(2);
    expect(rule(wide(), '.hs-status-hover .hs-readout-value')['font-family']).toBe('var(--font-readout)');
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

  it('puts the speed pill and Menu bottom left at 390 px, clear of Build, with Views and Share out of the bar', () => {
    const root = mount(9 * 60);
    const actions = find(root, 'hs-top-actions');
    // Views and Share stay in the tree for a wide screen; a phone hides them (Settings has them).
    const rounds = actions.children.filter((n) => n.tagName === 'BUTTON' && has(n, 'hs-round') && !n.hidden);
    expect(rounds.map((n) => n.getAttribute('aria-label'))).toEqual(['Views', 'Share', 'Menu']);
    expect(rule(phoneBlock(), '.hs-views-btn').display).toBe('none');
    expect(rule(phoneBlock(), ".hs-round[aria-label='Share']").display).toBe('none');
    const speed = find(actions, 'hs-speed');
    expect(speed.children).toHaveLength(4);
    // Fixed in the bottom left corner, inside the safe area.
    expect(rule(phoneBlock(), '.hs-top-actions')).toMatchObject({
      position: 'fixed',
      top: 'auto',
      left: 'calc(var(--edge) + var(--safe-left))',
      bottom: 'calc(var(--edge) + var(--safe-bottom))',
      margin: '0',
      'min-height': '0',
    });
    // The sizes the css gives them on a phone: every speed button a 44 px target.
    expect(rule(phoneBlock(), '.hs-speed-btn')['min-width']).toBe('var(--touch)');
    expect(rule(wide(), '.hs-icon-btn')['min-height']).toBe('var(--touch)');
    expect(rule(wide(), '.hs-round')['min-width']).toBe('calc(var(--touch) + 8px)');
    expect(rule(phoneBlock(), '.hs-top')['--edge']).toBe('8px');
    const touch = 44;
    const speedW = 4 * touch + 3 * 2 + 2 * 4; // four buttons, 2 px apart, in 4 px padding
    const menuW = touch + 8;
    const cluster = 8 + speedW + 8 + menuW; // the 8 px edge, the pill, the 8 px --gap-float, Menu
    const buildLeft = 390 - 12 - 60; // Build: 60 px round, 12 px in from the right edge
    expect(cluster).toBe(258);
    expect(cluster).toBeLessThan(buildLeft);
    // The night mode label sits over the speed pill, out of the row.
    expect(rule(phoneBlock(), '.hs-speed-mode')).toMatchObject({ position: 'absolute', top: 'auto', bottom: 'calc(100% + 4px)', left: '0', right: 'auto' });
  });

  it('steps the speed pill and Menu aside while the build sheet or a panel owns the bottom', () => {
    for (const selector of ['.hs-ui.is-building .hs-top-actions', '.hs-ui.is-panel-open .hs-top-actions']) {
      expect(rule(phoneBlock(), selector).display).toBe('none');
    }
    returning();
    setWidth(390);
    const root = mount(9 * 60);
    const shell = find(root, 'hs-ui');
    click(find(root, 'hs-build-fab'));
    expect(has(shell, 'is-building')).toBe(true);
    click(find(root, 'hs-build-close'));
    expect(has(shell, 'is-building')).toBe(false);
    click(named(root, 'Menu'));
    expect(has(shell, 'is-panel-open')).toBe(true);
  });

  it('gives focus back to Menu when Settings closes, once the controls are back', () => {
    returning();
    setWidth(390);
    const root = mount(9 * 60);
    const shell = find(root, 'hs-ui');
    const menu = named(root, 'Menu');
    let hiddenWhenFocused: boolean | null = null;
    const focus = menu.focus.bind(menu);
    menu.focus = () => {
      hiddenWhenFocused = has(shell, 'is-panel-open');
      focus();
    };
    focus(); // the player is on Menu
    click(menu);
    expect(has(shell, 'is-panel-open')).toBe(true);
    click(find(find(root, 'hs-settings'), 'hs-panel-close'));
    expect(dom.activeElement).toBe(menu);
    expect(hiddenWhenFocused).toBe(false);
  });

  it('moves Views and Share into Settings on a phone: Views opens the list, Share the share card', () => {
    returning();
    setWidth(390);
    const root = mount(9 * 60);
    click(named(root, 'Menu'));
    const settings = find(root, 'hs-settings');
    const gameRows = (settings.descendants().find((n) => has(n, 'hs-set-list')) as FakeElement).children.map((r) => r.textContent);
    expect(gameRows.slice(-2)).toEqual(['Views', 'Share']);
    click(rowNamed(settings, 'Share'));
    expect(sheetTitle(root)).toBe('Share');

    click(named(root, 'Menu'));
    click(rowNamed(find(root, 'hs-settings'), 'Views'));
    // The menu steps aside so the view picked is not behind it, and the list is open.
    expect(root.descendants().some((n) => has(n, 'hs-settings'))).toBe(false);
    expect(find(root, 'hs-views-menu').hidden).toBe(false);
    expect(named(root, 'Views').getAttribute('aria-expanded')).toBe('true');
    // With the button hidden the list has no anchor, so a phone hangs it under the bar.
    expect(rule(phoneBlock(), '.hs-views-menu').top).toBe('calc(var(--top-actual, calc(var(--top-h) + var(--safe-top))) + var(--gap-float))');
  });

  it('keeps Views and Share out of Settings on a wide screen, where the bar has them', () => {
    returning();
    setWidth(1280);
    const root = mount(9 * 60);
    click(named(root, 'Menu'));
    const rows = find(root, 'hs-settings')
      .descendants()
      .filter((n) => has(n, 'hs-set-action'))
      .map((n) => n.textContent);
    expect(rows).toContain('Stories');
    expect(rows).not.toContain('Views');
    expect(rows).not.toContain('Share');
  });
});

describe('goals at phone width', () => {
  it('opens the goals from the star count, where the folded card is not shown, and Hide folds them away', () => {
    expect(rule(phoneBlock(), '.hs-card.is-collapsed').display).toBe('none');
    returning({ 'hs.goals.collapsed': 'true' });
    setWidth(390);
    const root = mount(9 * 60);
    const card = find(root, 'hs-card');
    expect(has(card, 'is-collapsed')).toBe(true);
    fire(find(root, 'hs-status-stars'), 'click');
    expect(has(card, 'is-collapsed')).toBe(false);
    expect(store().getItem('hs.goals.collapsed')).toBe('false');
    click(buttonText(card, 'Hide'));
    expect(has(card, 'is-collapsed')).toBe(true);
    expect(store().getItem('hs.goals.collapsed')).toBe('true');
  });

  it('leaves the star count to its tooltip on a wide screen', () => {
    returning({ 'hs.goals.collapsed': 'true' });
    setWidth(1280);
    const root = mount(9 * 60);
    const card = find(root, 'hs-card');
    fire(find(root, 'hs-status-stars'), 'click');
    expect(has(card, 'is-collapsed')).toBe(true);
    expect(store().getItem('hs.goals.collapsed')).toBe('true');
  });
});
